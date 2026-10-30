import { describe, expect, it, vi } from "vitest";
import {
  InMemoryIntegrationSettings,
  IntegrationSettings,
  stageMappingRow,
} from "../../../integration-settings/application";
import { FixedClock, silentLogger } from "../../../shared/kernel";
import { createAdFeedback, type PreparedEvent } from "../../application";
import { InMemoryOutbox, RecordingMailer, sampleContext } from "../../application/fakes";
import { createCapiClient, metaCapiConfig, metaCapiSender, type FetchLike } from "./index";

const T0 = new Date("2026-03-01T10:00:00Z");

const fakeFetch = (status: number, body: unknown = {}) =>
  vi.fn<FetchLike>(
    async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
  );

const client = (fetchImpl: FetchLike, token = "capi-token") =>
  createCapiClient({ graphVersion: "v26.0", token, logger: silentLogger, fetchImpl, timeoutMs: 200 });

describe("metaCapiConfig", () => {
  it("META_CAPI_TOKEN boşsa sistem kullanıcısı token'ı; sürüm tek değişkenden; test kodu isteğe bağlı", () => {
    const env: Record<string, string> = { META_SYSTEM_USER_TOKEN: "sys", META_DATASET_ID: " 123 " };
    const read = (n: string) => env[n] ?? "";
    expect(metaCapiConfig(read)).toEqual({ token: "sys", graphVersion: "v26.0", datasetId: "123", testEventCode: "" });
    env["META_CAPI_TOKEN"] = "capi";
    env["META_GRAPH_API_VERSION"] = "v27.0";
    env["META_TEST_EVENT_CODE"] = "TEST1";
    expect(metaCapiConfig(read)).toMatchObject({ token: "capi", graphVersion: "v27.0", testEventCode: "TEST1" });
  });
});

describe("CAPI istemcisi: yanıt sınıflandırması", () => {
  it("200 → ok; URL veri seti ile, token yalnız Authorization başlığında, gövde aynen", async () => {
    const f = fakeFetch(200, { events_received: 2, fbtrace_id: "t" });
    const r = await client(f).sendEvents("1234", '{"data":[]}');
    expect(r).toEqual({ kind: "ok", code: 200 });
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe("https://graph.facebook.com/v26.0/1234/events");
    expect(url).not.toContain("capi-token");
    expect(init?.body).toBe('{"data":[]}');
    expect((init?.headers as Record<string, string>)["Authorization"]).toBe("Bearer capi-token");
    expect(init?.method).toBe("POST");
  });

  it("400 → dead (mesaj ve kod); 401/403 → dead", async () => {
    const r = await client(
      fakeFetch(400, { error: { message: "Invalid parameter", code: 100, error_subcode: 2804003 } }),
    ).sendEvents("1", "{}");
    expect(r).toEqual({ kind: "dead", code: 400, error: "Invalid parameter (code 100/2804003)" });
    expect(
      (await client(fakeFetch(401, { error: { message: "bad token", code: 190 } })).sendEvents("1", "{}")).kind,
    ).toBe("dead");
  });

  it("429 / 500 / 503 → retry; Graph geçici kodu (4) 400 ile gelse de retry", async () => {
    expect(await client(fakeFetch(429, { error: { message: "rate", code: 32 } })).sendEvents("1", "{}")).toEqual({
      kind: "retry",
      code: 429,
      error: "rate (code 32)",
    });
    expect((await client(fakeFetch(500, {})).sendEvents("1", "{}")).kind).toBe("retry");
    expect((await client(fakeFetch(503, "not json")).sendEvents("1", "{}")).kind).toBe("retry");
    expect(
      (await client(fakeFetch(400, { error: { message: "transient", code: 4 } })).sendEvents("1", "{}")).kind,
    ).toBe("retry");
  });

  it("zaman aşımı ve ağ hatası → retry; token ya da veri seti yoksa retry (yapılandırma düzelince gider)", async () => {
    const slow: FetchLike = (_u, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(Object.assign(new Error("aborted"), { name: "TimeoutError" })),
        );
      });
    const t = await client(slow).sendEvents("1", "{}");
    expect(t.kind).toBe("retry");
    expect((t as { error: string }).error).toContain("TimeoutError");
    const net: FetchLike = async () => {
      throw new TypeError("fetch failed");
    };
    expect((await client(net).sendEvents("1", "{}")).kind).toBe("retry");
    expect((await client(fakeFetch(200), "").sendEvents("1", "{}")).kind).toBe("retry");
    expect((await client(fakeFetch(200)).sendEvents("", "{}")).kind).toBe("retry");
  });
});

describe("metaCapiSender", () => {
  const sender = (f: FetchLike, testEventCode?: string) =>
    metaCapiSender({ client: client(f), datasetId: async () => "9999", testEventCode });
  const row = {
    id: "ob-1",
    stageEventId: "evt-1",
    provider: "meta",
    status: "pending" as const,
    attempts: 1,
    nextAttemptAt: T0,
    skipReason: null,
    lastResponseCode: null,
    lastError: null,
    sentAt: null,
    createdAt: T0,
  };

  it("prepare: builder payload'ı; eşleştirme anahtarı yoksa no_match_key", () => {
    const s = sender(fakeFetch(200));
    const ready = s.prepare(sampleContext(), "Nitelikli Lead", row);
    expect(ready.kind).toBe("ready");
    if (ready.kind === "ready") {
      expect(ready.event.payload).toMatchObject({
        event_name: "Nitelikli Lead",
        action_source: "system_generated",
        user_data: { lead_id: "555000001" },
      });
    }
    const noKey = sampleContext({
      lead: { ...sampleContext().lead, platformLeadId: "abc", email: null, phoneE164: null },
    });
    expect(s.prepare(noKey, "x", row)).toEqual({ kind: "skip", reason: "no_match_key" });
  });

  it("send: toplu gövde lead_id sayı olarak, test_event_code staging'de; veri seti URL'de", async () => {
    const f = fakeFetch(200, { events_received: 2 });
    const s = sender(f, "TEST42");
    const a = s.prepare(
      sampleContext({ stageEventId: "a", lead: { ...sampleContext().lead, platformLeadId: "18446744073709551615" } }),
      "Yeni Lead",
      row,
    );
    const b = s.prepare(
      sampleContext({ stageEventId: "b", stageCode: "WON", value: { amount: 10, currency: "eur" } }),
      "Kazanıldı",
      row,
    );
    const events = [a, b].map((p) => (p as { event: PreparedEvent }).event);
    expect(await s.send(events)).toEqual({ kind: "ok", code: 200 });
    const body = String(f.mock.calls[0]![1]?.body);
    expect(body).toContain('"lead_id":18446744073709551615,');
    expect(body).toContain('"test_event_code":"TEST42"');
    expect(body).toContain('"value":10,"currency":"EUR"');
    expect(body).toContain('"lead_event_source":"Unixpadel CRM"');
    expect(f.mock.calls[0]![0]).toContain("/9999/events");
    expect(JSON.parse(body).data).toHaveLength(2);
  });

  it("uçtan uca dağıtıcı ile: 200 → sent, hem Meta formu hem web formu olayı tek gövdede", async () => {
    const f = fakeFetch(200, { events_received: 2 });
    const outbox = new InMemoryOutbox();
    const web = sampleContext({
      stageEventId: "evt-web",
      lead: { ...sampleContext().lead, source: "web_form", platformLeadId: "sub-1" },
      attribution: {
        gclid: null,
        gbraid: null,
        wbraid: null,
        fbclid: null,
        fbc: "fb.1.1.X",
        fbp: "fb.1.2.3",
        utmSource: null,
        utmMedium: null,
        utmCampaign: null,
        utmTerm: null,
        utmContent: null,
        landingUrl: "https://www.example.com/x",
        clickAt: null,
      },
      consents: [{ id: "c", leadId: "lead-1", type: "kvkk", granted: true, textVersion: "v1", grantedAt: T0 }],
    });
    const meta = sampleContext({ stageEventId: "evt-meta" });
    const ctx = new Map([
      [web.stageEventId, web],
      [meta.stageEventId, meta],
    ]);
    outbox.enqueue("evt-web", "meta", new Date(T0.getTime() - 1000));
    outbox.enqueue("evt-meta", "meta", new Date(T0.getTime() - 1000));
    const ad = createAdFeedback({
      outbox,
      context: { outboundContext: async (ids) => ids.flatMap((id) => ctx.get(id) ?? []) },
      policy: new IntegrationSettings({
        ...new InMemoryIntegrationSettings([], { meta: { outbound_enabled: "true" } }, [
          stageMappingRow("meta", "QUALIFIED", "Nitelikli Lead"),
        ]).repos(),
        clock: { now: () => T0 },
      }),
      senders: [sender(f)],
      clock: new FixedClock(T0.toISOString()),
      logger: silentLogger,
      retryMinutes: [1],
      consentRequiredType: "kvkk",
      mailer: new RecordingMailer(),
      reportRecipients: [],
    });
    expect(await ad.dispatch.runOnce()).toMatchObject({ claimed: 2, sent: 2 });
    const body = JSON.parse(String(f.mock.calls[0]![1]?.body)) as { data: Record<string, unknown>[] };
    expect(body.data.map((e) => e["action_source"]).sort()).toEqual(["system_generated", "website"]);
    const site = body.data.find((e) => e["action_source"] === "website")!;
    expect(site).toMatchObject({
      event_source_url: "https://www.example.com/x",
      user_data: { fbc: "fb.1.1.X", fbp: "fb.1.2.3" },
    });
    expect(outbox.rows.every((r) => r.status === "sent")).toBe(true);
  });
});
