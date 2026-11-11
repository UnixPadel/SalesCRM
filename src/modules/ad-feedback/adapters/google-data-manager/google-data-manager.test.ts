import { createVerify, generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { FixedClock, silentLogger } from "../../../shared/kernel";
import type { PreparedEvent } from "../../application";
import { sampleContext } from "../../application/fakes";
import {
  createDataManagerClient,
  createServiceAccountTokenProvider,
  googleDataManagerConfig,
  googleDataManagerSender,
  parseServiceAccountKey,
  signServiceAccountJwt,
  translateRequestStatus,
  type FetchLike,
  type TokenProvider,
} from "./index";

const T0 = new Date("2026-03-01T10:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const KEY = {
  client_email: "crm@test-project.iam.gserviceaccount.com",
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  token_uri: "https://oauth2.googleapis.com/token",
};

const jsonResponse = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const staticTokens: TokenProvider = { accessToken: async () => "tok-1" };

describe("googleDataManagerConfig", () => {
  it("varsayılanlar ve ortam değişkenleri; müşteri kimliği tiresiz; kaynak listesi", () => {
    const env: Record<string, string> = {};
    const read = (n: string) => env[n] ?? "";
    expect(googleDataManagerConfig(read)).toEqual({
      serviceAccountKey: "",
      customerId: "",
      loginCustomerId: "",
      validateOnly: false,
      clickWindowDays: 90,
      userDataWindowDays: 63,
      eventSource: "WEB",
      timeZone: "Europe/Istanbul",
      sendSources: ["google_form", "web_form"],
    });
    Object.assign(env, {
      GOOGLE_DM_SERVICE_ACCOUNT_KEY: "{}",
      GOOGLE_ADS_CUSTOMER_ID: "123-456-7890",
      GOOGLE_DM_VALIDATE_ONLY: "1",
      GOOGLE_CLICK_WINDOW_DAYS: "30",
      GOOGLE_EVENT_SOURCE: "other",
      GOOGLE_SEND_SOURCES: "google_form, web_form, meta_form",
    });
    expect(googleDataManagerConfig(read)).toMatchObject({
      customerId: "1234567890",
      validateOnly: true,
      clickWindowDays: 30,
      eventSource: "OTHER",
      sendSources: ["google_form", "web_form", "meta_form"],
    });
  });
});

describe("servis hesabı token'ı", () => {
  it("anahtar JSON ya da base64; eksik alan hata", () => {
    const parsed = parseServiceAccountKey(JSON.stringify(KEY));
    expect(parsed.client_email).toBe(KEY.client_email);
    expect(parseServiceAccountKey(Buffer.from(JSON.stringify(KEY)).toString("base64")).client_email).toBe(
      KEY.client_email,
    );
    expect(() => parseServiceAccountKey("bozuk")).toThrow(/JSON/);
    expect(() => parseServiceAccountKey(JSON.stringify({ client_email: "x" }))).toThrow(/private_key/);
  });

  it("RS256 JWT: başlık, iddialar (iss, scope, aud, iat, exp) ve imza doğrulanır", () => {
    const jwt = signServiceAccountJwt(KEY, 1_772_359_200);
    const [h, p, s] = jwt.split(".") as [string, string, string];
    const dec = (x: string) => JSON.parse(Buffer.from(x, "base64url").toString("utf8")) as Record<string, unknown>;
    expect(dec(h)).toEqual({ alg: "RS256", typ: "JWT" });
    expect(dec(p)).toEqual({
      iss: KEY.client_email,
      scope: "https://www.googleapis.com/auth/datamanager",
      aud: KEY.token_uri,
      iat: 1_772_359_200,
      exp: 1_772_362_800,
    });
    const verifier = createVerify("RSA-SHA256");
    verifier.update(`${h}.${p}`);
    expect(verifier.verify(publicKey, Buffer.from(s, "base64url"))).toBe(true);
  });

  it("token uç noktasına jwt-bearer isteği; önbellek süresi dolana kadar yeniden istemez; hata fırlatır", async () => {
    let now = T0.getTime();
    let calls = 0;
    const f = vi.fn<FetchLike>(async (_u, init) => {
      calls += 1;
      const body = new URLSearchParams(String(init?.body));
      expect(body.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
      expect(body.get("assertion")?.split(".")).toHaveLength(3);
      return jsonResponse(200, { access_token: `tok-${calls}`, expires_in: 3600 });
    });
    const tokens = createServiceAccountTokenProvider({ key: KEY, logger: silentLogger, fetchImpl: f, now: () => now });
    expect(await tokens.accessToken()).toBe("tok-1");
    expect(await tokens.accessToken()).toBe("tok-1");
    expect(f).toHaveBeenCalledTimes(1);
    expect(String(f.mock.calls[0]![0])).toBe(KEY.token_uri);
    now += 3600 * 1000;
    expect(await tokens.accessToken()).toBe("tok-2");

    const bad = createServiceAccountTokenProvider({
      key: KEY,
      logger: silentLogger,
      fetchImpl: async () => jsonResponse(401, { error: "invalid_grant" }),
    });
    await expect(bad.accessToken()).rejects.toThrow(/401, invalid_grant/);
  });
});

describe("Data Manager istemcisi: yanıt sınıflandırması", () => {
  const request = { destinations: [], encoding: "HEX" as const, events: [] };
  const client = (f: FetchLike, tokens: TokenProvider = staticTokens) =>
    createDataManagerClient({ tokens, logger: silentLogger, fetchImpl: f, timeoutMs: 200 });

  it("200 → ok; URL events:ingest, token yalnız Authorization başlığında, gövde JSON", async () => {
    const f = vi.fn<FetchLike>(async () => jsonResponse(200, { requestId: "req-1" }));
    expect(await client(f).ingest(request)).toEqual({ kind: "ok", code: 200, requestId: "req-1" });
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe("https://datamanager.googleapis.com/v1/events:ingest");
    expect((init?.headers as Record<string, string>)["Authorization"]).toBe("Bearer tok-1");
    expect(String(init?.body)).not.toContain("tok-1");
    expect(JSON.parse(String(init?.body))).toEqual(request);
  });

  it("Faz 7c: requestStatus:retrieve GET ile sorulur; yanıt sağlayıcıdan bağımsız biçime çevrilir", async () => {
    const f = vi.fn<FetchLike>(async () =>
      jsonResponse(200, {
        requestStatusPerDestination: [
          { requestStatus: "SUCCESS", eventsIngestionStatus: { recordCount: "3" } },
          {
            requestStatus: "PARTIAL_SUCCESS",
            eventsIngestionStatus: { recordCount: "3" },
            errorInfo: { errorCounts: [{ recordCount: "1", reason: "PROCESSING_ERROR_REASON_EVENT_TOO_OLD" }] },
            warningInfo: { warningCounts: [{ recordCount: "2" }, { recordCount: "1" }] },
          },
        ],
      }),
    );
    const status = await client(f).retrieveStatus("req 1/ü");
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe("https://datamanager.googleapis.com/v1/requestStatus:retrieve?requestId=req%201%2F%C3%BC");
    expect(init?.method).toBe("GET");
    expect(init?.body).toBeUndefined();
    expect((init?.headers as Record<string, string>)["Authorization"]).toBe("Bearer tok-1");
    expect(status).toEqual({
      requestId: "req 1/ü",
      state: "partial",
      destinations: [
        { state: "success", recordCount: 3, errorCount: 0, warningCount: 0 },
        { state: "partial", recordCount: 3, errorCount: 1, warningCount: 3 },
      ],
    });
    expect(translateRequestStatus("r", { requestStatusPerDestination: [{ requestStatus: "PROCESSING" }] }).state).toBe(
      "processing",
    );
    expect(translateRequestStatus("r", { requestStatusPerDestination: [{ requestStatus: "FAILED" }] }).state).toBe(
      "failure",
    );
    expect(translateRequestStatus("r", { requestStatusPerDestination: [{ requestStatus: "YENI_DEGER" }] }).state).toBe(
      "unknown",
    );
    expect(translateRequestStatus("r", null)).toEqual({ requestId: "r", state: "unknown", destinations: [] });
    await expect(
      client(async () => jsonResponse(404, { error: { message: "Not found", status: "NOT_FOUND" } })).retrieveStatus(
        "x",
      ),
    ).rejects.toThrow("Not found (NOT_FOUND)");
  });

  it("400 INVALID_ARGUMENT / 401 / 403 / 404 → dead; 429 RESOURCE_EXHAUSTED / 500 / 503 → retry", async () => {
    const dead = await client(async () =>
      jsonResponse(400, { error: { code: 400, message: "Invalid gclid", status: "INVALID_ARGUMENT" } }),
    ).ingest(request);
    expect(dead).toEqual({ kind: "dead", code: 400, error: "Invalid gclid (INVALID_ARGUMENT)" });
    for (const s of [401, 403, 404])
      expect((await client(async () => jsonResponse(s, {})).ingest(request)).kind).toBe("dead");
    const rate = await client(async () =>
      jsonResponse(429, { error: { message: "Quota", status: "RESOURCE_EXHAUSTED" } }),
    ).ingest(request);
    expect(rate).toEqual({ kind: "retry", code: 429, error: "Quota (RESOURCE_EXHAUSTED)" });
    for (const s of [500, 503])
      expect((await client(async () => jsonResponse(s, "x")).ingest(request)).kind).toBe("retry");
  });

  it("zaman aşımı, ağ hatası ve token alınamaması → retry", async () => {
    const slow: FetchLike = (_u, init) =>
      new Promise((_r, reject) =>
        init?.signal?.addEventListener("abort", () =>
          reject(Object.assign(new Error("aborted"), { name: "TimeoutError" })),
        ),
      );
    expect((await client(slow).ingest(request)).kind).toBe("retry");
    const net: FetchLike = async () => {
      throw new TypeError("fetch failed");
    };
    expect((await client(net).ingest(request)).kind).toBe("retry");
    const noToken: TokenProvider = {
      accessToken: async () => {
        throw new Error("token yok");
      },
    };
    expect(await client(async () => jsonResponse(200), noToken).ingest(request)).toEqual({
      kind: "retry",
      code: null,
      error: "token yok",
    });
  });
});

describe("googleDataManagerSender", () => {
  const row = {
    id: "ob-1",
    stageEventId: "evt-1",
    provider: "google",
    status: "pending" as const,
    attempts: 1,
    nextAttemptAt: T0,
    skipReason: null,
    lastResponseCode: null,
    lastError: null,
    sentAt: null,
    createdAt: T0,
  };
  const attribution = (over: Partial<NonNullable<ReturnType<typeof sampleContext>["attribution"]>> = {}) => ({
    gclid: null,
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
    clickAt: null,
    ...over,
  });
  const googleLead = (over: Partial<ReturnType<typeof sampleContext>> = {}) =>
    sampleContext({
      lead: { ...sampleContext().lead, source: "google_form", platformLeadId: "g-1" },
      attribution: attribution({ gclid: "Cj0-test", clickAt: new Date(T0.getTime() - 5 * DAY) }),
      ...over,
    });
  const make = (f: FetchLike, over: Partial<Parameters<typeof googleDataManagerSender>[0]> = {}) =>
    googleDataManagerSender({
      client: createDataManagerClient({ tokens: staticTokens, logger: silentLogger, fetchImpl: f }),
      clock: new FixedClock(T0.toISOString()),
      customerId: async () => "1234567890",
      loginCustomerId: async () => "",
      validateOnly: false,
      clickWindowDays: 90,
      userDataWindowDays: 63,
      eventSource: "WEB",
      timeZone: "Europe/Istanbul",
      sendSources: ["google_form", "web_form"],
      ...over,
    });

  it("prepare: google_form lead'i hazır; Meta formu lead'i ve anahtarsız lead no_match_key; penceresi geçen expired", () => {
    const s = make(async () => jsonResponse(200));
    const ready = s.prepare(googleLead(), "111", row);
    expect(ready.kind).toBe("ready");
    if (ready.kind === "ready")
      expect(ready.event.payload).toMatchObject({
        destinationReferences: ["111"],
        adIdentifiers: { gclid: "Cj0-test" },
      });

    expect(s.prepare(sampleContext(), "111", row)).toEqual({ kind: "skip", reason: "no_match_key" }); // meta_form
    const noKey = googleLead({
      lead: { ...googleLead().lead, email: null, phoneE164: null },
      attribution: attribution(),
    });
    expect(s.prepare(noKey, "111", row)).toEqual({ kind: "skip", reason: "no_match_key" });

    const oldClick = googleLead({
      attribution: attribution({ gclid: "Cj0-old", clickAt: new Date(T0.getTime() - 91 * DAY) }),
    });
    expect(s.prepare(oldClick, "111", row)).toEqual({ kind: "skip", reason: "expired" });
    const edgeClick = googleLead({
      attribution: attribution({ gclid: "Cj0-edge", clickAt: new Date(T0.getTime() - 90 * DAY) }),
    });
    expect(s.prepare(edgeClick, "111", row).kind).toBe("ready");
    // Yalnız e-posta/telefon: 63 gün, taban lead oluşturma.
    const emailOnlyOld = googleLead({
      attribution: attribution(),
      lead: { ...googleLead().lead, createdAt: new Date(T0.getTime() - 64 * DAY) },
    });
    expect(s.prepare(emailOnlyOld, "111", row)).toEqual({ kind: "skip", reason: "expired" });
    const emailOnlyOk = googleLead({
      attribution: attribution(),
      lead: { ...googleLead().lead, createdAt: new Date(T0.getTime() - 63 * DAY) },
    });
    expect(s.prepare(emailOnlyOk, "111", row).kind).toBe("ready");
  });

  it("send: hedefler dönüşüm işlemi başına, HEX, validateOnly staging'de; müşteri kimliği yoksa retry", async () => {
    const f = vi.fn<FetchLike>(async () => jsonResponse(200, { requestId: "r" }));
    const s = make(f, { validateOnly: true, loginCustomerId: async () => "999" });
    const q = s.prepare(googleLead({ stageEventId: "q" }), "111", row) as { event: PreparedEvent };
    const w = s.prepare(
      googleLead({ stageEventId: "w", stageCode: "WON", value: { amount: 10, currency: "eur" } }),
      "222",
      row,
    ) as { event: PreparedEvent };
    expect(await s.send([q.event, w.event])).toMatchObject({ kind: "ok", code: 200 });
    const body = JSON.parse(String(f.mock.calls[0]![1]?.body)) as Record<string, unknown>;
    expect(body["encoding"]).toBe("HEX");
    expect(body["validateOnly"]).toBe(true);
    expect((body["destinations"] as unknown[]).length).toBe(2);
    expect(body["destinations"]).toContainEqual({
      reference: "222",
      operatingAccount: { accountType: "GOOGLE_ADS", accountId: "1234567890" },
      loginAccount: { accountType: "GOOGLE_ADS", accountId: "999" },
      productDestinationId: "222",
    });
    const events = body["events"] as Record<string, unknown>[];
    expect(events.find((e) => e["transactionId"] === "w")).toMatchObject({
      conversionValue: 10,
      currency: "EUR",
      destinationReferences: ["222"],
    });
    expect(String(events[0]!["eventTimestamp"])).toMatch(/\+03:00$/);

    const noCustomer = make(f, { customerId: async () => "" });
    expect((await noCustomer.send([q.event])).kind).toBe("retry");
  });
});
