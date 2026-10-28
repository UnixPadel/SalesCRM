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
import { googleLeadId, googleSourceAdapter, stripGoogleKey, verifyGoogleKey, type GoogleLeadPayload } from "./index";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const fixture = (name: string): GoogleLeadPayload =>
  JSON.parse(readFileSync(join(FIX, name), "utf8")) as GoogleLeadPayload;

/** Seed (0004) ile aynı Google eşlemeleri. */
const SEED = [
  ["FULL_NAME", "full_name"],
  ["FIRST_NAME", "first_name"],
  ["LAST_NAME", "last_name"],
  ["EMAIL", "email"],
  ["WORK_EMAIL", "email"],
  ["PHONE_NUMBER", "phone"],
  ["COUNTRY", "country"],
  ["CITY", "city"],
  ["COMPANY_NAME", "company"],
  ["JOB_TITLE", "extra"],
] as const;
const settings = new IntegrationSettings({
  ...new InMemoryIntegrationSettings(SEED.map(([f, t]) => mappingRow("google", f, t))).repos(),
  clock: { now: () => new Date(0) },
});
const ctx: AdapterContext = { mappingsFor: (f) => settings.mappingsFor("google", f), defaultCountry: "TR" };
const KEY = "test-webhook-key";
const adapter = googleSourceAdapter();

describe("google_key", () => {
  it("geçerli / geçersiz / eksik / beklenen anahtar tanımsız", () => {
    expect(verifyGoogleKey(fixture("lead-normal.json"), KEY)).toBe(true);
    expect(verifyGoogleKey({ ...fixture("lead-normal.json"), google_key: "yanlis" }, KEY)).toBe(false);
    expect(verifyGoogleKey({ lead_id: "x" }, KEY)).toBe(false);
    expect(verifyGoogleKey({ google_key: 123 }, KEY)).toBe(false);
    expect(verifyGoogleKey(null, KEY)).toBe(false);
    expect(verifyGoogleKey(fixture("lead-normal.json"), "")).toBe(false);
  });
  it("inbox'a yazılmadan anahtar gövdeden çıkarılır; lead_id metin", () => {
    const stripped = stripGoogleKey(fixture("lead-normal.json"));
    expect(stripped.google_key).toBeUndefined();
    expect(stripped.lead_id).toBe("CjwKCAiA-lead-0001");
    expect(googleLeadId(stripped)).toBe("CjwKCAiA-lead-0001");
    expect(googleLeadId({ lead_id: 42 })).toBe("42");
    expect(googleLeadId({})).toBeNull();
  });
});

describe("user_column_data → InboundLeadDto", () => {
  it("normal: column_id eşlemesi, gcl_id → attribution, kampanya/adgroup/creative, test değil", async () => {
    const dto = await adapter.toInboundLead(stripGoogleKey(fixture("lead-normal.json")), ctx);
    expect(dto).toMatchObject({
      source: "google_form",
      provider: "google",
      platformLeadId: "CjwKCAiA-lead-0001",
      formId: "7001",
      fullName: "Ayşe Demir",
      email: "ayse.demir@example.com",
      phone: "+905321234567",
      country: "TR",
      city: "İzmir",
      company: "Demir Spor",
      campaign: { campaignId: "8001", adsetId: "9001", adId: "9501" },
      attribution: { gclid: "Cj0KCQjw-gclid-normal" },
      isTest: false,
    });
    expect(dto.extraAnswers).toEqual({ "Job Title": "Tesis Müdürü" });
  });

  it("test verisi gönder: is_test → test işaretli, gclid saklanır", async () => {
    const dto = await adapter.toInboundLead(stripGoogleKey(fixture("lead-test.json")), ctx);
    expect(dto).toMatchObject({
      isTest: true,
      platformLeadId: "TeSter-123-ABCDEF",
      attribution: { gclid: "TeSter-123-gclid" },
      country: "US",
    });
    expect((await adapter.toInboundLead({ ...fixture("lead-test.json"), is_test: "true" }, ctx)).isTest).toBe(true);
  });

  it("eksik alanlar: ad + soyad, yerel telefon varsayılan ülkeyle; e-posta ve gclid yok", async () => {
    const dto = await adapter.toInboundLead(stripGoogleKey(fixture("lead-missing-fields.json")), ctx);
    expect(dto).toMatchObject({ fullName: "Mehmet Kaya", email: null, phone: "0541 987 65 43", country: "TR" });
    expect(dto.attribution).toEqual({ gclid: null });
    expect(dto.campaign).toEqual({ campaignId: null, adsetId: null, adId: null });
  });

  it("tanınmayan sütunlar yok sayılır (yalnız adları ek yanıtta listelenir); column_id'siz satır atlanır", async () => {
    const dto = await adapter.toInboundLead(stripGoogleKey(fixture("lead-unknown-fields.json")), ctx);
    expect(dto).toMatchObject({ fullName: "Hans Müller", email: "hans@mueller.de", country: "DE", formId: "7002" });
    expect(dto.extraAnswers).toEqual({ ignored_columns: ["custom_question_1", "custom_question_2"] });
    expect(dto.extraAnswers["Kaç kort?"]).toBeUndefined();
  });

  it("form bazlı eşleme özel soruyu ürün ilgisine bağlar", async () => {
    const custom = new IntegrationSettings({
      ...new InMemoryIntegrationSettings([
        ...SEED.map(([f, t]) => mappingRow("google", f, t)),
        mappingRow("google", "custom_question_1", "product_interest", "7002"),
      ]).repos(),
      clock: { now: () => new Date(0) },
    });
    const dto = await adapter.toInboundLead(stripGoogleKey(fixture("lead-unknown-fields.json")), {
      ...ctx,
      mappingsFor: (f) => custom.mappingsFor("google", f),
    });
    expect(dto.productInterest).toBe("3");
    expect(dto.extraAnswers).toEqual({ ignored_columns: ["custom_question_2"] });
  });

  it("lead_id yoksa kalıcı hata", async () => {
    await expect(adapter.toInboundLead({ user_column_data: [] }, ctx)).rejects.toMatchObject({
      code: "google.lead_without_id",
      kind: "permanent",
    });
  });
});

describe("uçtan uca", () => {
  it("aynı bildirim iki kez → tek lead; gclid lead_attribution'da; test lead'i test işaretli; iletişimsiz → failed", async () => {
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
      const body = stripGoogleKey(fixture(name));
      return intake.accept.execute({
        provider: "google",
        kind: "webhook",
        platformLeadId: googleLeadId(body)!,
        payload: body,
      });
    };
    expect((await accept("lead-normal.json")).status).toBe("inserted");
    expect((await accept("lead-normal.json")).status).toBe("duplicate");
    await accept("lead-test.json");
    await accept("lead-no-contact.json");
    expect(await intake.process.runOnce()).toEqual({ claimed: 3, done: 2, retried: 0, failed: 1 });
    const leads = sp.uow.state.leads;
    expect(leads).toHaveLength(2);
    const normal = leads.find((l) => l.platformLeadId === "CjwKCAiA-lead-0001")!;
    expect(normal).toMatchObject({ source: "google_form", isTest: false, email: "ayse.demir@example.com" });
    expect(sp.uow.state.attributions[normal.id]).toMatchObject({ gclid: "Cj0KCQjw-gclid-normal" });
    const test = leads.find((l) => l.platformLeadId === "TeSter-123-ABCDEF")!;
    expect(test.isTest).toBe(true);
    expect(sp.uow.state.attributions[test.id]?.gclid).toBe("TeSter-123-gclid");
    expect((await inbox.findByDedupeKey("google:CjwKCAiA-lead-0005"))?.lastErrorCode).toBe("intake.invalid_lead");
  });
});
