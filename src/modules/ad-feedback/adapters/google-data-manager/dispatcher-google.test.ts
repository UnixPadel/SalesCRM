/**
 * Dağıtıcı senaryoları Google kanalı için (Faz 5 test maddesi): gerçek DispatchOutbox + gerçek Google göndericisi +
 * sahte Data Manager ucu. 200, 400 (tek ve toplu), 429, 500, zaman aşımı; expired ve no_match_key; geri alınan olay
 * gitmiyor; aynı olay iki kez gitmiyor. Meta kodu bu testte yok.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  InMemoryIntegrationSettings,
  IntegrationSettings,
  stageMappingRow,
} from "../../../integration-settings/application";
import { FixedClock, MINUTE, silentLogger } from "../../../shared/kernel";
import type { OutboundStageEvent } from "../../../sales-pipeline/application";
import { createAdFeedback, type AdFeedback, type PlatformSender } from "../../application";
import { InMemoryOutbox, RecordingMailer, sampleContext } from "../../application/fakes";
import { createDataManagerClient, googleDataManagerSender, type FetchLike } from "./index";

const T0 = new Date("2026-03-01T10:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const RETRY = [1, 5, 30, 120, 720];

let outbox: InMemoryOutbox;
let clock: FixedClock;
let contexts: Map<string, OutboundStageEvent>;

const settings = new IntegrationSettings({
  ...new InMemoryIntegrationSettings([], { google: { outbound_enabled: "true" } }, [
    stageMappingRow("google", "QUALIFIED", "111000111", { isOptimizationTarget: true }),
    stageMappingRow("google", "WON", "222000222"),
  ]).repos(),
  clock: { now: () => T0 },
});

const response = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Sırayla verilen yanıtlar; son eleman tekrar eder. `timeout` → AbortSignal ile iptal. */
const scripted = (...plan: (number | "timeout" | "network")[]) => {
  let i = 0;
  const calls: Record<string, unknown>[] = [];
  const f: FetchLike = (_u, init) => {
    const step = plan[Math.min(i, plan.length - 1)]!;
    i += 1;
    calls.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    if (step === "timeout")
      return new Promise((_r, reject) =>
        init?.signal?.addEventListener("abort", () =>
          reject(Object.assign(new Error("aborted"), { name: "TimeoutError" })),
        ),
      );
    if (step === "network") return Promise.reject(new TypeError("fetch failed"));
    if (step === 400)
      return Promise.resolve(response(400, { error: { message: "Invalid gclid", status: "INVALID_ARGUMENT" } }));
    if (step === 429)
      return Promise.resolve(response(429, { error: { message: "Quota", status: "RESOURCE_EXHAUSTED" } }));
    return Promise.resolve(response(step, step === 200 ? { requestId: "r" } : {}));
  };
  return { f, calls };
};

const sender = (f: FetchLike): PlatformSender =>
  googleDataManagerSender({
    client: createDataManagerClient({
      tokens: { accessToken: async () => "tok" },
      logger: silentLogger,
      fetchImpl: f,
      timeoutMs: 100,
    }),
    clock,
    customerId: async () => "1234567890",
    loginCustomerId: async () => "",
    validateOnly: false,
    clickWindowDays: 90,
    userDataWindowDays: 63,
    eventSource: "WEB",
    timeZone: "Europe/Istanbul",
    sendSources: ["google_form", "web_form"],
  });

const build = (s: PlatformSender): AdFeedback =>
  createAdFeedback({
    outbox,
    context: { outboundContext: async (ids) => ids.flatMap((id) => contexts.get(id) ?? []) },
    policy: settings,
    senders: [s],
    clock,
    logger: silentLogger,
    retryMinutes: RETRY,
    consentRequiredType: "kvkk",
    mailer: new RecordingMailer(),
    reportRecipients: [],
  });

const googleCtx = (id: string, over: Partial<OutboundStageEvent> = {}): OutboundStageEvent =>
  sampleContext({
    stageEventId: id,
    stageCode: "QUALIFIED",
    lead: {
      ...sampleContext().lead,
      source: "google_form",
      platformLeadId: `g-${id}`,
      createdAt: new Date(T0.getTime() - DAY),
    },
    attribution: {
      gclid: `gclid-${id}`,
      gbraid: null,
      wbraid: null,
      fbclid: null,
      fbc: null,
      fbp: null,
      utmSource: null,
      utmMedium: null,
      utmCampaign: null,
      utmTerm: null,
      utmContent: null,
      landingUrl: null,
      clickAt: new Date(T0.getTime() - 2 * DAY),
    },
    ...over,
  });

const enqueue = (ctx: OutboundStageEvent) => {
  contexts.set(ctx.stageEventId, ctx);
  return outbox.enqueue(ctx.stageEventId, "google", new Date(T0.getTime() - 1000));
};

beforeEach(() => {
  outbox = new InMemoryOutbox();
  clock = new FixedClock(T0.toISOString());
  contexts = new Map();
});

describe("dağıtıcı + Google göndericisi", () => {
  it("200 → sent; Nitelikli ve Kazanıldı tek istekte iki hedef; ikinci turda yeniden gitmez", async () => {
    const { f, calls } = scripted(200);
    const ad = build(sender(f));
    enqueue(googleCtx("q"));
    enqueue(googleCtx("w", { stageCode: "WON", value: { amount: 10, currency: "EUR" } }));
    expect(await ad.dispatch.runOnce()).toEqual({ claimed: 2, sent: 2, retried: 0, dead: 0, skipped: 0 });
    expect(calls).toHaveLength(1);
    expect((calls[0]!["destinations"] as unknown[]).length).toBe(2);
    expect((calls[0]!["events"] as unknown[]).length).toBe(2);
    expect(await ad.dispatch.runOnce()).toMatchObject({ claimed: 0 });
    clock.advance(10 * MINUTE);
    expect(await ad.dispatch.runOnce()).toMatchObject({ claimed: 0 });
    expect(calls).toHaveLength(1);
  });

  it("400 tek olay → dead; 400 toplu → tek tek yeniden: yalnız hatalı dead", async () => {
    const single = scripted(400);
    enqueue(googleCtx("a"));
    expect(await build(sender(single.f)).dispatch.runOnce()).toMatchObject({ dead: 1, sent: 0 });
    expect(outbox.rows[0]).toMatchObject({
      status: "dead",
      lastResponseCode: 400,
      lastError: "Invalid gclid (INVALID_ARGUMENT)",
    });

    outbox = new InMemoryOutbox();
    contexts = new Map();
    const batch = scripted(400, 200, 400, 200);
    enqueue(googleCtx("a"));
    enqueue(googleCtx("b"));
    enqueue(googleCtx("c"));
    expect(await build(sender(batch.f)).dispatch.runOnce()).toMatchObject({ claimed: 3, sent: 2, dead: 1 });
    expect(batch.calls.map((c) => (c["events"] as unknown[]).length)).toEqual([3, 1, 1, 1]);
    expect(outbox.rows.map((r) => [r.stageEventId, r.status])).toEqual([
      ["a", "sent"],
      ["b", "dead"],
      ["c", "sent"],
    ]);
  });

  it("429 → 500 → zaman aşımı → ağ hatası → 503 → 500: 1, 5, 30, 120, 720 dk sonra yeniden; altıncıda dead", async () => {
    const { f } = scripted(429, 500, "timeout", "network", 503, 500);
    const ad = build(sender(f));
    enqueue(googleCtx("r"));
    for (const delay of RETRY) {
      expect(await ad.dispatch.runOnce()).toMatchObject({ claimed: 1, retried: 1 });
      expect(outbox.rows[0]!.status).toBe("failed");
      expect(outbox.rows[0]!.nextAttemptAt.getTime() - clock.now().getTime()).toBe(delay * MINUTE);
      clock.advance(delay * MINUTE);
    }
    expect(await ad.dispatch.runOnce()).toMatchObject({ claimed: 1, dead: 1 });
    expect(outbox.rows[0]).toMatchObject({ status: "dead", attempts: 6, lastResponseCode: 500 });
  });

  it("expired (91 gün önceki tıklama) ve no_match_key (Meta formu lead'i; anahtarsız lead) skipped; gönderici çağrılmaz", async () => {
    const { f, calls } = scripted(200);
    const ad = build(sender(f));
    enqueue(
      googleCtx("old", {
        attribution: { ...googleCtx("old").attribution!, clickAt: new Date(T0.getTime() - 91 * DAY) },
      }),
    );
    enqueue(googleCtx("meta", { lead: { ...googleCtx("meta").lead, source: "meta_form" } }));
    enqueue(
      googleCtx("nokey", { lead: { ...googleCtx("nokey").lead, email: null, phoneE164: null }, attribution: null }),
    );
    enqueue(
      googleCtx("edge", {
        attribution: { ...googleCtx("edge").attribution!, clickAt: new Date(T0.getTime() - 90 * DAY) },
      }),
    );
    expect(await ad.dispatch.runOnce()).toMatchObject({ claimed: 4, skipped: 3, sent: 1 });
    const reasons = Object.fromEntries(outbox.rows.map((r) => [r.stageEventId, r.skipReason ?? r.status]));
    expect(reasons).toEqual({ old: "expired", meta: "no_match_key", nokey: "no_match_key", edge: "sent" });
    expect(calls).toHaveLength(1);
  });

  it("geri alınan aşamanın olayı Google'a gitmez; eşlemesi olmayan aşama (NEW) mapping_missing", async () => {
    const { f, calls } = scripted(200);
    const ad = build(sender(f));
    enqueue(googleCtx("undone", { undoneAt: T0 }));
    enqueue(googleCtx("new", { stageCode: "NEW" }));
    expect(await ad.dispatch.runOnce()).toMatchObject({ claimed: 2, skipped: 2, sent: 0 });
    expect(outbox.rows.map((r) => r.skipReason)).toEqual(["undone", "mapping_missing"]);
    expect(calls).toHaveLength(0);
  });

  it("kilit süresi içinde ikinci instance aynı satırı alamaz (aynı olay iki kez gönderilmez)", async () => {
    const { f, calls } = scripted(200);
    const ad = build(sender(f));
    enqueue(googleCtx("x"));
    const first = await outbox.claimDue(clock.now(), 10, 5 * MINUTE);
    expect(first).toHaveLength(1);
    expect(await ad.dispatch.runOnce()).toMatchObject({ claimed: 0 });
    expect(calls).toHaveLength(0);
    clock.advance(5 * MINUTE);
    expect(await ad.dispatch.runOnce()).toMatchObject({ claimed: 1, sent: 1 });
    expect(calls).toHaveLength(1);
  });
});
