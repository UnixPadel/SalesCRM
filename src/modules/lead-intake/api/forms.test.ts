/**
 * /forms/web API testleri: gerçek Express + PGlite. İmza geçerli / geçersiz / eksik / eski, tekrar → tek lead,
 * honeypot → lead yok, gövde sınırı, yapılandırılmamış uç.
 */
import express from "express";
import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootLeadIntake, type LeadIntakeApp } from "../../../bootstrap/leadIntake";
import { bootSalesPipeline, type SalesPipelineApp } from "../../../bootstrap/salesPipeline";
import { generateKeyBase64, silentLogger } from "../../shared/kernel";
import { WEB_FORM_HEADERS, signWebForm } from "../adapters/web-form";
import { createFormsRouter } from "./forms";

const HERE = dirname(fileURLToPath(import.meta.url));
const fixture = (n: string) =>
  JSON.parse(readFileSync(join(HERE, "..", "adapters", "web-form", "fixtures", n), "utf8")) as Record<string, unknown>;

const SECRET = "web-form-hmac-secret";

let sp: SalesPipelineApp;
let li: LeadIntakeApp;
let server: Server;
let base: string;

beforeAll(async () => {
  sp = await bootSalesPipeline({ logger: silentLogger, memory: true, env: {} });
  li = bootLeadIntake(sp, {
    logger: silentLogger,
    startScheduler: false,
    env: { WEB_FORM_HMAC_KEY: SECRET, INBOX_ENCRYPTION_KEY: generateKeyBase64() },
  });
  const ex = express();
  ex.use("/forms", li.forms);
  ex.use("/forms-off", createFormsRouter({ accept: li.intake.accept, logger: silentLogger, web: null }));
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

const signed = (body: string, over: { secret?: string; ts?: number } = {}) => {
  const ts = over.ts ?? Math.floor(Date.now() / 1000);
  return {
    [WEB_FORM_HEADERS.timestamp]: String(ts),
    [WEB_FORM_HEADERS.signature]: `sha256=${signWebForm(over.secret ?? SECRET, ts, body)}`,
  };
};
const post = (path: string, body: string, headers: Record<string, string> = {}) =>
  fetch(base + path, { method: "POST", body, headers: { "content-type": "application/json", ...headers } });

/** Modüller arası kural: başka modülün api katmanı import edilmez; testin baktığı alanlar yerel tip. */
interface LeadView extends Record<string, unknown> {
  id: string;
  source: string;
  platformLeadId: string | null;
  isTest: boolean;
}
const leads = async () => (await (await fetch(`${base}/api/pipeline/leads?includeTest=1`)).json()) as LeadView[];

describe("POST /forms/web", () => {
  it("geçerli imza → 200 inserted; aynı gönderim tekrar → 200 duplicate; işlenince tek lead, Web kaynaklı, kimlikler kayıtlı", async () => {
    const body = JSON.stringify(fixture("submission-normal.json"));
    const r1 = await post("/forms/web", body, signed(body));
    expect(r1.status).toBe(200);
    expect(await r1.json()).toEqual({ ok: true, status: "inserted" });
    const r2 = await post("/forms/web", body, signed(body));
    expect(await r2.json()).toEqual({ ok: true, status: "duplicate" });

    expect(await li.intake.process.runOnce()).toMatchObject({ claimed: 1, done: 1 });
    const all = await leads();
    const web = all.filter((l) => l.platformLeadId === "7f3a9c2e-4b1d-4e8a-9c6f-0a1b2c3d4e5f");
    expect(web).toHaveLength(1);
    expect(web[0]).toMatchObject({ source: "web_form", isTest: false });
    const attribution = await sp.pipeline.queries.attribution(web[0]!.id);
    expect(attribution).toMatchObject({ gclid: "Cj0KCQjw-web-gclid", fbclid: "IwAR-web-fbclid", utmSource: "google" });
    const consents = await sp.pipeline.queries.consents(web[0]!.id);
    expect(consents.map((c) => [c.type, c.granted, c.textVersion])).toEqual([
      ["kvkk", true, "2026-01"],
      ["marketing", true, "2026-01"],
    ]);
  });

  it("imzasız → 401 missing; yanlış anahtar → 401 mismatch; eski zaman damgası → 401 stale; bozuk → 401 malformed", async () => {
    const body = JSON.stringify(fixture("submission-test.json"));
    const none = await post("/forms/web", body);
    expect(none.status).toBe(401);
    expect(await none.json()).toMatchObject({ reason: "missing" });

    const wrong = await post("/forms/web", body, signed(body, { secret: "baska" }));
    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toMatchObject({ reason: "mismatch" });

    const old = await post("/forms/web", body, signed(body, { ts: Math.floor(Date.now() / 1000) - 3600 }));
    expect(old.status).toBe(401);
    expect(await old.json()).toMatchObject({ reason: "stale" });

    const h = signed(body);
    const bad = await post("/forms/web", body, { ...h, [WEB_FORM_HEADERS.signature]: "sha1=abc" });
    expect(bad.status).toBe(401);
    expect(await bad.json()).toMatchObject({ reason: "malformed" });

    // Hiçbiri inbox'a girmedi: işleyici alacak satır yok, lead de yok.
    expect(await li.intake.process.runOnce()).toMatchObject({ claimed: 0 });
    expect((await leads()).some((l) => l.platformLeadId === "test-0001-aaaa-bbbb")).toBe(false);
  });

  it("test gönderimi geçerli imzayla → lead test işaretli", async () => {
    const body = JSON.stringify(fixture("submission-test.json"));
    expect((await post("/forms/web", body, signed(body))).status).toBe(200);
    await li.intake.process.runOnce();
    const l = (await leads()).find((x) => x.platformLeadId === "test-0001-aaaa-bbbb");
    expect(l).toMatchObject({ source: "web_form", isTest: true });
  });

  it("honeypot dolu → 200 ignored, inbox'a girmez, lead açılmaz", async () => {
    const body = JSON.stringify(fixture("submission-honeypot.json"));
    const r = await post("/forms/web", body, signed(body));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, status: "ignored" });
    expect(await li.intake.process.runOnce()).toMatchObject({ claimed: 0 });
    expect((await leads()).some((l) => l.platformLeadId === "7f3a9c2e-0006-4e8a-9c6f-0a1b2c3d4e5f")).toBe(false);
  });

  it("JSON değil → 400; submission_id yok → 400; 256 KB üstü → 413", async () => {
    const notJson = "merhaba";
    expect((await post("/forms/web", notJson, signed(notJson))).status).toBe(400);
    const noId = JSON.stringify({ fields: { name: "x" } });
    expect((await post("/forms/web", noId, signed(noId))).status).toBe(400);
    const big = JSON.stringify({ submission_id: "big", fields: { notes: "x".repeat(300 * 1024) } });
    expect((await post("/forms/web", big, signed(big))).status).toBe(413);
  });

  it("anahtar tanımsızsa 503", async () => {
    const body = JSON.stringify(fixture("submission-normal.json"));
    expect((await post("/forms-off/web", body, signed(body))).status).toBe(503);
  });
});
