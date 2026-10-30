import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  InMemoryIntegrationSettings,
  IntegrationSettings,
  mappingRow,
} from "../../../integration-settings/application";
import { createSalesPipeline } from "../../../sales-pipeline/application";
import { testDeps } from "../../../sales-pipeline/application/fakes";
import { SequentialIdGenerator, silentLogger } from "../../../shared/kernel";
import { createLeadIntake, type AdapterContext } from "../../application";
import { InMemoryInbox } from "../../application/fakes";
import {
  isHoneypotFilled,
  signWebForm,
  verifyWebFormSignature,
  webFormIsTest,
  webFormSourceAdapter,
  webFormSubmissionId,
  type WebFormPayload,
} from "./index";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const fixture = (name: string): WebFormPayload => JSON.parse(readFileSync(join(FIX, name), "utf8")) as WebFormPayload;

/** Seed (0005) ile aynı web eşlemeleri. */
const SEED = [
  ["full_name", "full_name"],
  ["name", "full_name"],
  ["first_name", "first_name"],
  ["last_name", "last_name"],
  ["email", "email"],
  ["phone", "phone"],
  ["country", "country"],
  ["city", "city"],
  ["company", "company"],
  ["product_interest", "product_interest"],
  ["interest", "product_interest"],
  ["message", "notes"],
  ["notes", "notes"],
  ["page_language", "extra"],
] as const;
const settings = new IntegrationSettings({
  ...new InMemoryIntegrationSettings(SEED.map(([f, t]) => mappingRow("web", f, t))).repos(),
  clock: { now: () => new Date(0) },
});
const ctx: AdapterContext = { mappingsFor: (f) => settings.mappingsFor("web", f), defaultCountry: "TR" };
const adapter = webFormSourceAdapter();

const SECRET = "web-form-test-secret";
const NOW = Date.parse("2026-03-01T10:00:00Z");
const TS = Math.floor(NOW / 1000);

describe("imza ve zaman damgası", () => {
  const body = JSON.stringify(fixture("submission-normal.json"));
  const headersFor = (secret = SECRET, ts = TS, raw = body) => ({
    signature: `sha256=${signWebForm(secret, ts, raw)}`,
    timestamp: String(ts),
  });

  it("geçerli imza; şema büyük harfle de kabul; gövde Buffer ya da string", () => {
    expect(verifyWebFormSignature(body, headersFor(), SECRET, NOW)).toEqual({ ok: true });
    expect(verifyWebFormSignature(Buffer.from(body, "utf8"), headersFor(), SECRET, NOW)).toEqual({ ok: true });
    const h = headersFor();
    expect(verifyWebFormSignature(body, { ...h, signature: h.signature.toUpperCase() }, SECRET, NOW).ok).toBe(true);
  });

  it("eksik başlık / tanımsız anahtar → missing", () => {
    expect(verifyWebFormSignature(body, { signature: undefined, timestamp: String(TS) }, SECRET, NOW)).toEqual({
      ok: false,
      reason: "missing",
    });
    expect(verifyWebFormSignature(body, { ...headersFor(), timestamp: undefined }, SECRET, NOW)).toEqual({
      ok: false,
      reason: "missing",
    });
    expect(verifyWebFormSignature(body, headersFor(), "", NOW)).toEqual({ ok: false, reason: "missing" });
  });

  it("bozuk başlık → malformed", () => {
    expect(verifyWebFormSignature(body, { ...headersFor(), signature: "md5=abc" }, SECRET, NOW)).toEqual({
      ok: false,
      reason: "malformed",
    });
    expect(verifyWebFormSignature(body, { ...headersFor(), signature: "sha256=zz" }, SECRET, NOW)).toEqual({
      ok: false,
      reason: "malformed",
    });
    expect(verifyWebFormSignature(body, { ...headersFor(), timestamp: "dün" }, SECRET, NOW)).toEqual({
      ok: false,
      reason: "malformed",
    });
  });

  it("5 dakikadan eski ya da ileri zaman damgası → stale (imza doğru olsa bile)", () => {
    expect(verifyWebFormSignature(body, headersFor(SECRET, TS - 301), SECRET, NOW)).toEqual({
      ok: false,
      reason: "stale",
    });
    expect(verifyWebFormSignature(body, headersFor(SECRET, TS + 301), SECRET, NOW)).toEqual({
      ok: false,
      reason: "stale",
    });
    expect(verifyWebFormSignature(body, headersFor(SECRET, TS - 299), SECRET, NOW)).toEqual({ ok: true });
  });

  it("yanlış anahtar, değişmiş gövde ya da başka zaman damgası → mismatch", () => {
    expect(verifyWebFormSignature(body, headersFor("baska"), SECRET, NOW)).toEqual({ ok: false, reason: "mismatch" });
    expect(verifyWebFormSignature(body + " ", headersFor(), SECRET, NOW)).toEqual({ ok: false, reason: "mismatch" });
    const h = headersFor();
    expect(verifyWebFormSignature(body, { ...h, timestamp: String(TS + 1) }, SECRET, NOW)).toEqual({
      ok: false,
      reason: "mismatch",
    });
  });
});

describe("gövde yardımcıları", () => {
  it("submission_id metin; honeypot dolu/boş; is_test çeşitleri", () => {
    expect(webFormSubmissionId(fixture("submission-normal.json"))).toBe("7f3a9c2e-4b1d-4e8a-9c6f-0a1b2c3d4e5f");
    expect(webFormSubmissionId({ submission_id: 42 })).toBe("42");
    expect(webFormSubmissionId({ submission_id: { a: 1 } })).toBeNull();
    expect(webFormSubmissionId(null)).toBeNull();
    expect(isHoneypotFilled(fixture("submission-honeypot.json"))).toBe(true);
    expect(isHoneypotFilled(fixture("submission-normal.json"))).toBe(false);
    expect(isHoneypotFilled({ honeypot: "   " })).toBe(false);
    expect(isHoneypotFilled({ honeypot: true })).toBe(true);
    expect(isHoneypotFilled({})).toBe(false);
    expect(webFormIsTest({ is_test: "1" })).toBe(true);
    expect(webFormIsTest({ is_test: "false" })).toBe(false);
    expect(webFormIsTest({})).toBe(false);
  });
});

describe("fields → InboundLeadDto", () => {
  it("normal: alan eşlemesi, ülke adı → ISO, tüm tıklama kimlikleri ve UTM, onaylar, ek yanıtlar", async () => {
    const dto = await adapter.toInboundLead(fixture("submission-normal.json"), ctx);
    expect(dto).toMatchObject({
      source: "web_form",
      provider: "web",
      platformLeadId: "7f3a9c2e-4b1d-4e8a-9c6f-0a1b2c3d4e5f",
      formId: "contact",
      fullName: "Ayşe Demir",
      email: "ayse.demir@example.com",
      phone: "+90 532 123 45 67",
      country: "TR",
      city: "İzmir",
      company: "Demir Spor",
      productInterest: "Panoramik kort",
      notes: "2 kort için teklif istiyoruz.",
      isTest: false,
      submittedAt: new Date("2026-03-01T09:58:30Z"),
    });
    expect(dto.attribution).toEqual({
      gclid: "Cj0KCQjw-web-gclid",
      gbraid: null,
      wbraid: null,
      fbclid: "IwAR-web-fbclid",
      fbc: "fb.1.1709280000000.IwAR-web-fbclid",
      fbp: "fb.1.1709270000000.1234567890",
      utmSource: "google",
      utmMedium: "cpc",
      utmCampaign: "padel-tr-2026",
      utmTerm: "padel kort",
      utmContent: "ad-a",
      landingUrl: "https://www.example.com/?gclid=Cj0KCQjw-web-gclid&utm_source=google",
      clickAt: new Date("2026-03-01T09:40:00Z"),
    });
    expect(dto.consents).toEqual([
      { type: "kvkk", granted: true, textVersion: "2026-01", grantedAt: new Date("2026-03-01T09:58:30Z") },
      { type: "marketing", granted: true, textVersion: "2026-01", grantedAt: null },
    ]);
    expect(dto.extraAnswers).toEqual({
      page_language: "tr",
      page_url: "https://www.example.com/iletisim?gclid=Cj0KCQjw-web-gclid&fbclid=IwAR-web-fbclid",
    });
    expect(dto.campaign).toEqual({});
  });

  it("test gönderimi: is_test, onay türü koda indirgenir, telefondan ülke", async () => {
    const dto = await adapter.toInboundLead(fixture("submission-test.json"), ctx);
    expect(dto).toMatchObject({ isTest: true, platformLeadId: "test-0001-aaaa-bbbb", country: "US" });
    expect(dto.attribution.gclid).toBe("TeSter-web-gclid");
    expect(dto.attribution.landingUrl).toBe("https://www.example.com/iletisim");
    expect(dto.consents).toEqual([{ type: "kvkk_onay", granted: true, textVersion: "2026-01", grantedAt: null }]);
  });

  it("eksik alanlar: ad + soyad birleşir, yerel telefon varsayılan ülkeyle; boş kimlikler null; onay yok", async () => {
    const dto = await adapter.toInboundLead(fixture("submission-missing-fields.json"), ctx);
    expect(dto).toMatchObject({ fullName: "Mehmet Kaya", email: null, phone: "0541 987 65 43", country: "TR" });
    expect(dto.formId).toBeNull();
    expect(dto.submittedAt).toBeNull();
    expect(Object.values(dto.attribution).every((v) => v === null)).toBe(true);
    expect(dto.consents).toEqual([]);
    expect(dto.extraAnswers).toEqual({});
  });

  it("tanınmayan alanlar ek yanıt olur (dizi korunur, nesne JSON); honeypot alanı sızmaz; bozuk tarih null", async () => {
    const dto = await adapter.toInboundLead(fixture("submission-unknown-fields.json"), ctx);
    expect(dto).toMatchObject({ fullName: "Hans Müller", email: "hans@mueller.de", country: "DE", formId: "quote" });
    expect(dto.extraAnswers).toEqual({
      court_count: "3",
      roof: ["panoramic", "covered"],
      address: '{"street":"Hauptstr. 1","zip":"10115"}',
      page_url: "https://www.example.com/de/angebot",
    });
    expect(dto.attribution).toMatchObject({
      fbclid: "IwAR-de-fbclid",
      utmSource: "facebook",
      utmMedium: "paid_social",
      clickAt: null,
      landingUrl: "https://www.example.com/de/angebot",
    });
    expect(dto.consents).toEqual([]);
  });

  it("form bazlı eşleme özel alanı ürün ilgisine bağlar", async () => {
    const custom = new IntegrationSettings({
      ...new InMemoryIntegrationSettings([
        ...SEED.map(([f, t]) => mappingRow("web", f, t)),
        mappingRow("web", "court_count", "product_interest", "quote"),
      ]).repos(),
      clock: { now: () => new Date(0) },
    });
    const dto = await adapter.toInboundLead(fixture("submission-unknown-fields.json"), {
      ...ctx,
      mappingsFor: (f) => custom.mappingsFor("web", f),
    });
    expect(dto.productInterest).toBe("3");
    expect(dto.extraAnswers["court_count"]).toBeUndefined();
  });

  it("submission_id yoksa kalıcı hata", async () => {
    await expect(adapter.toInboundLead({ fields: { name: "x" } }, ctx)).rejects.toMatchObject({
      code: "web.submission_without_id",
      kind: "permanent",
    });
  });
});

describe("uçtan uca", () => {
  it("aynı gönderim iki kez → tek lead; gclid+fbclid lead_attribution'da; onaylar lead_consents'te; iletişimsiz → failed", async () => {
    const sp = testDeps();
    const inbox = new InMemoryInbox();
    const intake = createLeadIntake({
      inbox,
      adapters: [adapter],
      backfillSources: [],
      mappings: settings,
      leads: createSalesPipeline(sp).createLead,
      ids: new SequentialIdGenerator("in"),
      clock: sp.clock,
      logger: silentLogger,
      retryMinutes: [1],
      defaultCountry: "TR",
      backfillLookbackHours: 2,
      retentionDays: 30,
    });
    const accept = (name: string) => {
      const body = fixture(name);
      return intake.accept.execute({
        provider: "web",
        kind: "webhook",
        platformLeadId: webFormSubmissionId(body)!,
        payload: body,
      });
    };
    expect((await accept("submission-normal.json")).status).toBe("inserted");
    expect((await accept("submission-normal.json")).status).toBe("duplicate");
    await accept("submission-test.json");
    await accept("submission-no-contact.json");
    expect(await intake.process.runOnce()).toEqual({ claimed: 3, done: 2, retried: 0, failed: 1 });

    const leads = sp.uow.state.leads;
    expect(leads).toHaveLength(2);
    const normal = leads.find((l) => l.platformLeadId === "7f3a9c2e-4b1d-4e8a-9c6f-0a1b2c3d4e5f")!;
    expect(normal).toMatchObject({ source: "web_form", isTest: false, email: "ayse.demir@example.com", country: "TR" });
    expect(sp.uow.state.attributions[normal.id]).toMatchObject({
      gclid: "Cj0KCQjw-web-gclid",
      fbclid: "IwAR-web-fbclid",
      fbc: "fb.1.1709280000000.IwAR-web-fbclid",
      utmCampaign: "padel-tr-2026",
    });
    expect(sp.uow.state.consents.filter((c) => c.leadId === normal.id).map((c) => [c.type, c.granted])).toEqual([
      ["kvkk", true],
      ["marketing", true],
    ]);
    const test = leads.find((l) => l.platformLeadId === "test-0001-aaaa-bbbb")!;
    expect(test.isTest).toBe(true);
    expect((await inbox.findByDedupeKey("web:7f3a9c2e-0005-4e8a-9c6f-0a1b2c3d4e5f"))?.lastErrorCode).toBe(
      "intake.invalid_lead",
    );
  });
});
