/** Webhook API testleri: gerçek Express + PGlite + sahte Graph API. İmza ve anahtar: geçerli, geçersiz, eksik. */
import express from "express";
import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { bootLeadIntake, type LeadIntakeApp } from "../../../bootstrap/leadIntake";
import { bootSalesPipeline, type SalesPipelineApp } from "../../../bootstrap/salesPipeline";
import { generateKeyBase64, hmacSha256Hex, silentLogger } from "../../shared/kernel";
import { createRateLimiter } from "./webhooks";

const HERE = dirname(fileURLToPath(import.meta.url));
const metaFixture = (n: string) => readFileSync(join(HERE, "..", "adapters", "meta", "fixtures", n));
const googleFixture = (n: string) =>
  JSON.parse(readFileSync(join(HERE, "..", "adapters", "google", "fixtures", n), "utf8")) as Record<string, unknown>;

const APP_SECRET = "meta-app-secret";
const VERIFY = "verify-token-123";
const GKEY = "google-webhook-key";

let sp: SalesPipelineApp;
let li: LeadIntakeApp;
let server: Server;
let base: string;
const graphCalls: string[] = [];

beforeAll(async () => {
  sp = await bootSalesPipeline({ logger: silentLogger, memory: true, env: {} });
  li = bootLeadIntake(sp, {
    logger: silentLogger,
    startScheduler: false,
    env: {
      META_APP_SECRET: APP_SECRET,
      META_VERIFY_TOKEN: VERIFY,
      META_SYSTEM_USER_TOKEN: "sys-token",
      GOOGLE_LEAD_FORM_KEY: GKEY,
      INBOX_ENCRYPTION_KEY: generateKeyBase64(),
    },
    metaFetch: vi.fn(async (url: string) => {
      graphCalls.push(url);
      return new Response(metaFixture("lead-normal.json"), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  });
  const ex = express();
  ex.use("/webhooks", li.webhooks);
  ex.use(express.json());
  ex.use((req, _res, next) => {
    (req as express.Request & { session?: unknown }).session = { userId: "admin", role: "admin" };
    next();
  });
  ex.use("/api/pipeline", sp.router);
  await new Promise<void>((resolve) => {
    server = ex.listen(0, () => resolve());
  });
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});
afterAll(async () => {
  server.close();
  await sp.close();
});

const post = (path: string, body: Buffer | string, headers: Record<string, string> = {}) =>
  fetch(base + path, { method: "POST", body, headers: { "content-type": "application/json", ...headers } });
const sig = (body: Buffer) => `sha256=${hmacSha256Hex(APP_SECRET, body)}`;
/** Modüller arası kural: başka modülün api katmanı import edilmez; testin baktığı alanlar yerel tip. */
interface LeadView extends Record<string, unknown> {
  id: string;
  platformLeadId: string | null;
}
const leads = async () => (await (await fetch(`${base}/api/pipeline/leads?includeTest=1`)).json()) as LeadView[];

describe("GET /webhooks/meta", () => {
  it("doğru token → challenge düz metin; yanlış token → 403", async () => {
    const ok = await fetch(`${base}/webhooks/meta?hub.mode=subscribe&hub.verify_token=${VERIFY}&hub.challenge=4242`);
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("4242");
    const bad = await fetch(`${base}/webhooks/meta?hub.mode=subscribe&hub.verify_token=x&hub.challenge=1`);
    expect(bad.status).toBe(403);
  });
});

describe("POST /webhooks/meta", () => {
  it("geçerli imza → 200 EVENT_RECEIVED, inbox satırı; aynı bildirim ikinci kez → yine 200, tek satır", async () => {
    const body = metaFixture("webhook-normal.json");
    const r1 = await post("/webhooks/meta", body, { "x-hub-signature-256": sig(body) });
    expect(r1.status).toBe(200);
    expect(await r1.text()).toBe("EVENT_RECEIVED");
    const r2 = await post("/webhooks/meta", body, { "x-hub-signature-256": sig(body) });
    expect(r2.status).toBe(200);
    const rows = await sp.db.query<{ n: string; status: string }>(
      "SELECT count(*)::int AS n, min(status) AS status FROM inbound_webhook_events WHERE provider = 'meta'",
    );
    expect(rows[0]).toMatchObject({ n: 1, status: "pending" });
  });

  it("geçersiz imza → 401; eksik başlık → 401; yanlış şema → 401; hiçbiri inbox'a yazmaz", async () => {
    const body = metaFixture("webhook-duplicate.json");
    expect(
      (await post("/webhooks/meta", body, { "x-hub-signature-256": `sha256=${hmacSha256Hex("baska", body)}` })).status,
    ).toBe(401);
    expect((await post("/webhooks/meta", body)).status).toBe(401);
    expect((await post("/webhooks/meta", body, { "x-hub-signature-256": "sha1=abc" })).status).toBe(401);
    // gövde değiştirilmiş (imza eski gövdeye ait)
    const tampered = Buffer.from(body.toString("utf8").replace("555000001", "555000099"));
    expect((await post("/webhooks/meta", tampered, { "x-hub-signature-256": sig(body) })).status).toBe(401);
    const rows = await sp.db.query<{ n: string }>("SELECT count(*)::int AS n FROM inbound_webhook_events");
    expect(Number(rows[0]?.n)).toBe(1);
  });

  it("imzalı ama JSON olmayan gövde → 400; 1 MB üstü → 413", async () => {
    const junk = Buffer.from("not json");
    expect((await post("/webhooks/meta", junk, { "x-hub-signature-256": sig(junk) })).status).toBe(400);
    const big = Buffer.alloc(1_100_000, 32);
    expect((await post("/webhooks/meta", big, { "x-hub-signature-256": sig(big) })).status).toBe(413);
  });

  it("işleyici koşunca Graph'tan tam lead çekilir ve lead tüm alanlarıyla düşer", async () => {
    const stats = await li.intake.process.runOnce();
    expect(stats).toMatchObject({ done: 1, failed: 0 });
    expect(graphCalls).toHaveLength(1);
    expect(graphCalls[0]).toContain("/555000001?fields=");
    const all = await leads();
    const lead = all.find((l) => l.platformLeadId === "555000001");
    expect(lead).toMatchObject({
      source: "meta_form",
      fullName: "Ayşe Demir",
      email: "ayse.demir@example.com",
      phoneE164: "+905321234567",
      country: "TR",
      city: "İzmir",
      company: "Demir Spor Tesisleri",
      currentStage: "NEW",
      assignedUserId: null, // ülke kuralı boş → havuz
      campaign: { campaignId: "238600001", adName: "Panoramik kort - TR" },
    });
    expect(lead?.extraAnswers).toMatchObject({ "kaç_kort_düşünüyorsunuz?": "2" });
  });
});

describe("POST /webhooks/google", () => {
  it("doğru anahtar → 200 {}, anahtar inbox'ta saklanmaz; test lead'i test işaretli, gclid saklı", async () => {
    const body = googleFixture("lead-test.json");
    body["google_key"] = GKEY;
    const r = await post("/webhooks/google", JSON.stringify(body));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({});
    const row = await li.intake.process.runOnce();
    expect(row).toMatchObject({ done: 1 });
    const lead = (await leads()).find((l) => l.platformLeadId === "TeSter-123-ABCDEF");
    expect(lead).toMatchObject({ source: "google_form", isTest: true, fullName: "FirstName LastName" });
    const attr = await sp.db.query<{ gclid: string }>("SELECT gclid FROM lead_attribution WHERE lead_id = $1", [
      lead?.id,
    ]);
    expect(attr[0]?.gclid).toBe("TeSter-123-gclid");
    // payload şifreli ve anahtar içermiyor
    const stored = await sp.db.query<{ payload_ciphertext: string }>(
      "SELECT payload_ciphertext FROM inbound_webhook_events WHERE dedupe_key = 'google:TeSter-123-ABCDEF'",
    );
    expect(stored[0]?.payload_ciphertext).toMatch(/^v1\./);
    const inboxRow = await li.intake.process["deps"].inbox.findByDedupeKey("google:TeSter-123-ABCDEF");
    expect((inboxRow?.payload as Record<string, unknown>)["google_key"]).toBeUndefined();
  });

  it("yanlış anahtar → 401; anahtar yok → 401; lead_id yok → 400; JSON değil → 400", async () => {
    const body = googleFixture("lead-normal.json");
    expect((await post("/webhooks/google", JSON.stringify({ ...body, google_key: "yanlis" }))).status).toBe(401);
    const { google_key: _k, ...noKey } = body;
    void _k;
    expect((await post("/webhooks/google", JSON.stringify(noKey))).status).toBe(401);
    const noId: Record<string, unknown> = { ...body, google_key: GKEY };
    delete noId["lead_id"];
    expect((await post("/webhooks/google", JSON.stringify(noId))).status).toBe(400);
    expect((await post("/webhooks/google", "{bozuk")).status).toBe(400);
  });

  it("aynı bildirim iki kez → tek lead", async () => {
    const body = { ...googleFixture("lead-normal.json"), google_key: GKEY };
    expect((await post("/webhooks/google", JSON.stringify(body))).status).toBe(200);
    expect((await post("/webhooks/google", JSON.stringify(body))).status).toBe(200);
    await li.intake.process.runOnce();
    expect((await leads()).filter((l) => l.platformLeadId === "CjwKCAiA-lead-0001")).toHaveLength(1);
  });
});

describe("hız sınırı", () => {
  it("pencere içinde max aşılınca reddeder, pencere dolunca sıfırlanır", () => {
    let t = 0;
    const allow = createRateLimiter(1000, 2, () => t);
    expect([allow("a"), allow("a"), allow("a")]).toEqual([true, true, false]);
    expect(allow("b")).toBe(true);
    t = 1001;
    expect(allow("a")).toBe(true);
  });
});
