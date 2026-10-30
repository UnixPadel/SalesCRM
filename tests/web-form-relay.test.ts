/**
 * Site tarafı aktarıcısı (integrations/web-form-relay) ile CRM'in gerçek /forms/web ucu birlikte.
 * Kabul kriterleri: reklam URL'sinden gelen gclid/fbclid kayıtlı; CRM kesintisinde gönderim kaybolmuyor;
 * honeypot dolu gönderim lead oluşturmuyor; imzasız istek 401.
 */
import express from "express";
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo, Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildSubmission, parseCookies } from "../integrations/web-form-relay/lib.mjs";
import { createRelay, type Relay } from "../integrations/web-form-relay/server.mjs";
import { bootLeadIntake, type LeadIntakeApp } from "../src/bootstrap/leadIntake";
import { bootSalesPipeline, type SalesPipelineApp } from "../src/bootstrap/salesPipeline";
import { generateKeyBase64, silentLogger } from "../src/modules/shared/kernel";

const SECRET = "relay-and-crm-shared-secret";

const listen = (s: Server, port = 0) =>
  new Promise<number>((resolve) => s.listen(port, "127.0.0.1", () => resolve((s.address() as AddressInfo).port)));
const close = (s: Server) => new Promise<void>((resolve) => s.close(() => resolve()));
const freePort = async () => {
  const s = express().listen(0, "127.0.0.1");
  await new Promise<void>((r) => s.once("listening", () => r()));
  const port = (s.address() as AddressInfo).port;
  await close(s);
  return port;
};

let sp: SalesPipelineApp;
let li: LeadIntakeApp;
let crmPort: number;
let crm: Server | null = null;
let relay: Relay;
let relayBase: string;
let queueDir: string;

const startCrm = async () => {
  const ex = express();
  ex.use("/forms", li.forms);
  crm = ex.listen(crmPort, "127.0.0.1");
  await new Promise<void>((r) => crm!.once("listening", () => r()));
};
const stopCrm = async () => {
  if (crm) await close(crm);
  crm = null;
};

beforeAll(async () => {
  sp = await bootSalesPipeline({ logger: silentLogger, memory: true, env: {} });
  li = bootLeadIntake(sp, {
    logger: silentLogger,
    startScheduler: false,
    env: { WEB_FORM_HMAC_KEY: SECRET, INBOX_ENCRYPTION_KEY: generateKeyBase64() },
  });
  crmPort = await freePort();
  queueDir = mkdtempSync(join(tmpdir(), "relay-queue-"));
  relay = createRelay({
    crmUrl: `http://127.0.0.1:${crmPort}/forms/web`,
    secret: SECRET,
    queueDir,
    formId: "contact",
    consentTextVersion: "2026-01",
    thanksUrl: "https://www.example.com/tesekkurler",
  });
  const port = await listen(relay.server);
  relayBase = `http://127.0.0.1:${port}`;
});
afterAll(async () => {
  await stopCrm();
  await close(relay.server);
  await sp.close();
  rmSync(queueDir, { recursive: true, force: true });
});

const submit = (form: Record<string, string>, headers: Record<string, string> = {}) =>
  fetch(`${relayBase}/submit`, {
    method: "POST",
    body: new URLSearchParams(form).toString(),
    headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
    redirect: "manual",
  });

const leadByPlatformId = async (id: string) => {
  const all = await sp.pipeline.queries.list({ actor: { userId: "admin", isAdmin: true }, includeTest: true });
  return all.find((l) => l.platformLeadId === id);
};

describe("buildSubmission", () => {
  it("gizli alanlar, çerezler (_gcl_aw/_fbc/_fbp), onay kutuları ve honeypot CRM gövdesine çevrilir", () => {
    const p = buildSubmission(
      {
        name: "Ayşe Demir",
        email: "ayse@example.com",
        phone: "0532 123 45 67",
        message: "Teklif",
        gclid: "Cj0-from-hidden-field",
        utm_source: "google",
        consent_kvkk: "on",
        consent_marketing: "",
        website: "",
        is_test: "1",
      },
      {
        now: new Date("2026-03-01T10:00:00Z"),
        id: "fixed-id",
        pageUrl: "https://www.example.com/iletisim?gclid=Cj0-from-hidden-field",
        cookies: parseCookies(
          "_gcl_aw=GCL.1709280000.Cj0-from-cookie; _fbc=fb.1.1709280000000.IwAR-x; _fbp=fb.1.1.2; other=1",
        ),
        formId: "contact",
        consentTextVersion: "2026-01",
      },
    );
    expect(p).toEqual({
      submission_id: "fixed-id",
      form_id: "contact",
      submitted_at: "2026-03-01T10:00:00.000Z",
      page_url: "https://www.example.com/iletisim?gclid=Cj0-from-hidden-field",
      fields: { name: "Ayşe Demir", email: "ayse@example.com", phone: "0532 123 45 67", message: "Teklif" },
      attribution: {
        gclid: "Cj0-from-hidden-field",
        utm_source: "google",
        fbc: "fb.1.1709280000000.IwAR-x",
        fbp: "fb.1.1.2",
        landing_url: "https://www.example.com/iletisim?gclid=Cj0-from-hidden-field",
      },
      consents: [
        { type: "kvkk", granted: true, text_version: "2026-01" },
        { type: "marketing", granted: false, text_version: "2026-01" },
      ],
      honeypot: "",
      is_test: true,
    });
    expect(buildSubmission({ website: "http://spam" }, { now: new Date() }).honeypot).toBe("http://spam");
  });
});

describe("aktarıcı + CRM", () => {
  it("reklam tıklamasıyla gelen form: gclid ve fbclid lead_attribution'da, Web kaynaklı, onaylar kayıtlı", async () => {
    await startCrm();
    const r = await submit(
      {
        name: "Ayşe Demir",
        email: "ayse.demir@example.com",
        phone: "+90 532 123 45 67",
        country: "Türkiye",
        gclid: "Cj0KCQjw-relay-gclid",
        fbclid: "IwAR-relay-fbclid",
        utm_source: "google",
        utm_campaign: "padel-2026",
        consent_kvkk: "on",
        website: "",
      },
      {
        referer: "https://www.example.com/iletisim?gclid=Cj0KCQjw-relay-gclid&fbclid=IwAR-relay-fbclid",
        accept: "text/html",
      },
    );
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toBe("https://www.example.com/tesekkurler");
    expect(relay.queue.size()).toBe(0);

    expect(await li.intake.process.runOnce()).toMatchObject({ claimed: 1, done: 1 });
    const inbox = await sp.db.query<{ dedupe_key: string }>(
      "SELECT dedupe_key FROM inbound_webhook_events WHERE provider = 'web' AND status = 'done'",
    );
    expect(inbox).toHaveLength(1);
    const submissionId = inbox[0]!.dedupe_key.slice("web:".length);
    const lead = await leadByPlatformId(submissionId);
    expect(lead).toMatchObject({ source: "web_form", email: "ayse.demir@example.com", country: "TR", isTest: false });
    expect(await sp.pipeline.queries.attribution(lead!.id)).toMatchObject({
      gclid: "Cj0KCQjw-relay-gclid",
      fbclid: "IwAR-relay-fbclid",
      utmSource: "google",
      utmCampaign: "padel-2026",
      landingUrl: "https://www.example.com/iletisim?gclid=Cj0KCQjw-relay-gclid&fbclid=IwAR-relay-fbclid",
    });
    expect((await sp.pipeline.queries.consents(lead!.id)).map((c) => [c.type, c.granted, c.textVersion])).toEqual([
      ["kvkk", true, "2026-01"],
    ]);
  });

  it("CRM kapalıyken gönderilen form kaybolmaz: kuyruğa yazılır, CRM açılınca flush ile düşer; tekrar flush mükerrer açmaz", async () => {
    await stopCrm();
    const r = await submit({ name: "Mehmet Kaya", phone: "0541 987 65 43", consent_kvkk: "on" });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
    expect(relay.queue.size()).toBe(1);
    const entry = relay.queue.read(relay.queue.list()[0]!);
    expect(entry.attempts).toBe(1);
    expect(entry.lastError).toMatch(/ECONNREFUSED|fetch failed/);

    // CRM hâlâ kapalı: flush dosyayı tutar.
    expect(await relay.flush()).toMatchObject({ delivered: 0, pending: 1 });
    expect(relay.queue.size()).toBe(1);

    await startCrm();
    expect(await relay.flush()).toMatchObject({ delivered: 1, failed: 0 });
    expect(relay.queue.size()).toBe(0);
    expect(await li.intake.process.runOnce()).toMatchObject({ claimed: 1, done: 1 });
    const lead = await leadByPlatformId(entry.payload.submission_id);
    expect(lead).toMatchObject({ source: "web_form", fullName: "Mehmet Kaya", phoneE164: "+905419876543" });

    // Yeniden gönderim (ör. onay kaybolmuş gibi): CRM "duplicate" der, aktarıcı başarılı sayar, lead tek.
    relay.queue.put(entry.payload);
    expect(await relay.flush()).toMatchObject({ delivered: 1 });
    await li.intake.process.runOnce();
    const all = await sp.pipeline.queries.list({ actor: { userId: "admin", isAdmin: true }, includeTest: true });
    expect(all.filter((l) => l.platformLeadId === entry.payload.submission_id)).toHaveLength(1);
  });

  it("honeypot dolu gönderim: 200 ama kuyruğa ve CRM'e gitmez", async () => {
    const before = await sp.db.query("SELECT id FROM inbound_webhook_events");
    const r = await submit({ name: "Bot", email: "bot@example.com", website: "http://spam.example" });
    expect(r.status).toBe(200);
    expect(relay.queue.size()).toBe(0);
    expect(await sp.db.query("SELECT id FROM inbound_webhook_events")).toHaveLength(before.length);
  });

  it("yanlış anahtarla çalışan aktarıcı: CRM 401 → dosya failed/ klasörüne, kuyruk tıkanmaz", async () => {
    const dir = mkdtempSync(join(tmpdir(), "relay-bad-"));
    const bad = createRelay({ crmUrl: `http://127.0.0.1:${crmPort}/forms/web`, secret: "yanlis", queueDir: dir });
    const port = await listen(bad.server);
    const r = await fetch(`http://127.0.0.1:${port}/submit`, {
      method: "POST",
      body: JSON.stringify({ name: "X", email: "x@example.com" }),
      headers: { "content-type": "application/json" },
    });
    expect(r.status).toBe(200);
    expect(bad.queue.size()).toBe(0);
    const { readdirSync } = await import("node:fs");
    expect(readdirSync(bad.queue.failedDir)).toHaveLength(1);
    const health = await (await fetch(`http://127.0.0.1:${port}/health`)).json();
    expect(health).toEqual({ ok: true, queued: 0 });
    await close(bad.server);
    rmSync(dir, { recursive: true, force: true });
  });

  it("imzasız doğrudan istek CRM'de 401", async () => {
    const r = await fetch(`http://127.0.0.1:${crmPort}/forms/web`, {
      method: "POST",
      body: JSON.stringify({ submission_id: "x", fields: {} }),
      headers: { "content-type": "application/json" },
    });
    expect(r.status).toBe(401);
  });
});
