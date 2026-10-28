import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryIntegrationSettings, IntegrationSettings, mappingRow } from "../../integration-settings/application";
import { createSalesPipeline } from "../../sales-pipeline/application";
import { testDeps, type TestHarness } from "../../sales-pipeline/application/fakes";
import { HOUR, MINUTE, PermanentError, SequentialIdGenerator, TransientError, silentLogger } from "../../shared/kernel";
import { buildInboundLead } from "./buildLead";
import { countryCodeFrom, resolveCountry } from "./country";
import { FakeAdapter, FakeBackfill, InMemoryInbox, sampleDto } from "./fakes";
import { createLeadIntake, type LeadIntake } from "./index";

let sp: TestHarness;
let inbox: InMemoryInbox;
let adapter: FakeAdapter;
let backfill: FakeBackfill;
let intake: LeadIntake;

const settings = new IntegrationSettings({
  ...new InMemoryIntegrationSettings([mappingRow("fake", "full_name", "full_name")]).repos(),
  clock: { now: () => new Date(0) },
});

const build = (adapters: FakeAdapter[], sources: FakeBackfill[] = []) =>
  createLeadIntake({
    inbox,
    adapters,
    backfillSources: sources,
    mappings: settings,
    leads: createSalesPipeline(sp).createLead,
    ids: new SequentialIdGenerator("in"),
    clock: sp.clock,
    logger: silentLogger,
    retryMinutes: [1, 5],
    defaultCountry: "TR",
    backfillLookbackHours: 2,
    retentionDays: 30,
  });

beforeEach(() => {
  sp = testDeps({ providers: ["fakeA"] });
  sp.uow.state.territories.push({ countryCode: "TR", assignedUserId: "rep-tr", fallbackUserId: null });
  inbox = new InMemoryInbox();
  adapter = new FakeAdapter("fake", async (payload) => sampleDto(payload as Partial<typeof sampleDto> as never));
  backfill = new FakeBackfill("fake", async () => []);
  intake = build([adapter], [backfill]);
});

const accept = (
  platformLeadId: string,
  payload: unknown = { platformLeadId },
  kind: "webhook" | "backfill" = "webhook",
) => intake.accept.execute({ provider: "fake", kind, platformLeadId, payload });

describe("AcceptInboundEvent", () => {
  it("yazar ve döner; aynı bildirim ikinci kez → duplicate, tek satır", async () => {
    const a = await accept("L-1");
    expect(a).toMatchObject({ status: "inserted", dedupeKey: "fake:L-1" });
    const b = await accept("L-1");
    expect(b.status).toBe("duplicate");
    expect(inbox.rows).toHaveLength(1);
    expect(inbox.rows[0]).toMatchObject({ status: "pending", attempts: 0, kind: "webhook" });
  });
});

describe("ProcessInbox", () => {
  it("sırası gelen satır: adaptör → CreateLead; ülke kuralıyla atanır; satır done ve lead_id dolu", async () => {
    await accept("L-1");
    const stats = await intake.process.runOnce();
    expect(stats).toEqual({ claimed: 1, done: 1, retried: 0, failed: 0 });
    const row = await inbox.findByDedupeKey("fake:L-1");
    expect(row).toMatchObject({ status: "done", attempts: 1, leadId: sp.uow.state.leads[0]?.id });
    const lead = sp.uow.state.leads[0];
    expect(lead).toMatchObject({
      source: "meta_form",
      platformLeadId: "L-1",
      formId: "F-1",
      fullName: "Ayşe Demir",
      email: "ayse@example.com",
      phoneE164: "+905321234567",
      country: "TR",
      assignedUserId: "rep-tr",
      campaign: { campaignId: "c1" },
    });
    expect(sp.uow.state.events[0]).toMatchObject({ stageCode: "NEW", origin: "system", actorUserId: null });
    expect(sp.events.published.map((e) => e.type)).toEqual(["LeadCreated", "LeadAssigned"]);
    // ikinci koşuda alınacak satır yok
    expect(await intake.process.runOnce()).toEqual({ claimed: 0, done: 0, retried: 0, failed: 0 });
  });

  it("aynı platform kimliği iki farklı inbox satırından gelse de tek lead", async () => {
    await accept("L-1");
    await intake.process.runOnce();
    // yedek senkron aynı kimliği getirir: inbox zaten reddeder
    expect((await accept("L-1", { platformLeadId: "L-1" }, "backfill")).status).toBe("duplicate");
    // adaptör aynı platform kimliğini başka dedupe anahtarıyla döndürse CreateLead mevcut lead'i verir
    await intake.accept.execute({
      provider: "fake",
      kind: "webhook",
      platformLeadId: "L-1-again",
      payload: { platformLeadId: "L-1" },
    });
    const stats = await intake.process.runOnce();
    expect(stats.done).toBe(1);
    expect(sp.uow.state.leads).toHaveLength(1);
    expect((await inbox.findByDedupeKey("fake:L-1-again"))?.leadId).toBe(sp.uow.state.leads[0]?.id);
  });

  it("geçici hata: 1 dk, 5 dk sonra yeniden; sonra retries_exhausted ile failed", async () => {
    const flaky = new FakeAdapter("fake", async () => {
      throw new TransientError("platform.unavailable", "503");
    });
    intake = build([flaky]);
    await accept("L-2");
    expect(await intake.process.runOnce()).toMatchObject({ retried: 1 });
    let row = await inbox.findByDedupeKey("fake:L-2");
    expect(row).toMatchObject({ status: "pending", attempts: 1, lastErrorCode: "platform.unavailable" });
    expect(row?.nextAttemptAt).toEqual(new Date(sp.clock.now().getTime() + 1 * MINUTE));
    expect(await intake.process.runOnce()).toMatchObject({ claimed: 0 }); // henüz sırası gelmedi
    sp.clock.advance(1 * MINUTE);
    expect(await intake.process.runOnce()).toMatchObject({ retried: 1 });
    row = await inbox.findByDedupeKey("fake:L-2");
    expect(row?.attempts).toBe(2);
    expect(row?.nextAttemptAt).toEqual(new Date(sp.clock.now().getTime() + 5 * MINUTE));
    sp.clock.advance(5 * MINUTE);
    expect(await intake.process.runOnce()).toMatchObject({ failed: 1 });
    row = await inbox.findByDedupeKey("fake:L-2");
    expect(row).toMatchObject({ status: "failed", attempts: 3, lastErrorCode: "intake.retries_exhausted" });
    expect(flaky.calls).toBe(3);
  });

  it("kalıcı hata ve iş kuralı hatası: hemen failed, yeniden denenmez", async () => {
    const bad = new FakeAdapter("fake", async (payload) => {
      const p = payload as { mode: string };
      if (p.mode === "permanent") throw new PermanentError("platform.bad_request", "400");
      if (p.mode === "crash") throw new TypeError("undefined is not a function");
      return sampleDto({ platformLeadId: "L-nocontact", email: null, phone: null });
    });
    intake = build([bad]);
    await accept("P", { mode: "permanent" });
    await accept("C", { mode: "crash" });
    await accept("R", { mode: "rule" });
    expect(await intake.process.runOnce()).toEqual({ claimed: 3, done: 0, retried: 0, failed: 3 });
    expect((await inbox.findByDedupeKey("fake:P"))?.lastErrorCode).toBe("platform.bad_request");
    expect((await inbox.findByDedupeKey("fake:C"))?.lastErrorCode).toBe("intake.unexpected");
    expect(await inbox.findByDedupeKey("fake:R")).toMatchObject({
      status: "failed",
      lastErrorCode: "intake.invalid_lead",
      lastError: expect.stringContaining("E-posta ya da telefon"),
    });
    expect(sp.uow.state.leads).toHaveLength(0);
  });

  it("bilinmeyen sağlayıcı ve silinmiş payload failed olur", async () => {
    await intake.accept.execute({ provider: "yok", kind: "webhook", platformLeadId: "X", payload: {} });
    await accept("L-purged");
    const row = inbox.rows.find((r) => r.dedupeKey === "fake:L-purged");
    if (row) row.payload = null;
    expect(await intake.process.runOnce()).toMatchObject({ failed: 2 });
    expect((await inbox.findByDedupeKey("yok:X"))?.lastErrorCode).toBe("intake.unknown_provider");
    expect((await inbox.findByDedupeKey("fake:L-purged"))?.lastErrorCode).toBe("intake.payload_purged");
  });

  it("işlenirken çöken satır kilit süresi dolunca yeniden alınır", async () => {
    await accept("L-3");
    await inbox.claimDue(sp.clock.now(), 10, 10 * MINUTE); // başka bir instance aldı, bitiremedi
    expect(await intake.process.runOnce()).toMatchObject({ claimed: 0 });
    sp.clock.advance(10 * MINUTE);
    expect(await intake.process.runOnce()).toMatchObject({ claimed: 1, done: 1 });
    expect((await inbox.findByDedupeKey("fake:L-3"))?.attempts).toBe(2);
  });

  it("adaptöre eşleme bağlamı ve varsayılan ülke verilir", async () => {
    const spy = new FakeAdapter("fake", async (_p, ctx) => {
      expect(ctx.defaultCountry).toBe("TR");
      expect((await ctx.mappingsFor(null)).get("full_name")).toBe("full_name");
      return sampleDto({ platformLeadId: "L-ctx" });
    });
    intake = build([spy]);
    await accept("L-ctx");
    expect(await intake.process.runOnce()).toMatchObject({ done: 1 });
  });
});

describe("RunBackfill", () => {
  it("her kaynaktan son 2 saat; inbox'a backfill türüyle yazar; mevcut olanı atlar; kaynak hatası diğerini durdurmaz", async () => {
    await accept("L-1");
    const ok = new FakeBackfill("fake", async () => [
      { dedupeKey: "fake:L-1", payload: { platformLeadId: "L-1" } },
      { dedupeKey: "fake:L-9", payload: { platformLeadId: "L-9" } },
    ]);
    const broken = new FakeBackfill("other", async () => {
      throw new TransientError("platform.unavailable", "timeout");
    });
    intake = build([adapter], [broken, ok]);
    const out = await intake.backfill.runOnce();
    expect(out).toEqual({
      other: { fetched: 0, inserted: 0, error: "platform.unavailable" },
      fake: { fetched: 2, inserted: 1 },
    });
    expect(ok.calls[0]).toEqual(new Date(sp.clock.now().getTime() - 2 * HOUR));
    expect(inbox.rows.find((r) => r.dedupeKey === "fake:L-9")).toMatchObject({ kind: "backfill", status: "pending" });
    // webhook kapalıyken kaçan lead işleyiciden geçer
    expect(await intake.process.runOnce()).toMatchObject({ done: 2 });
    expect(sp.uow.state.leads.map((l) => l.platformLeadId).sort()).toEqual(["L-1", "L-9"]);
  });
});

describe("PurgeInboxPayloads", () => {
  it("30 günden eski payload silinir, satır ve durum kalır", async () => {
    await accept("old");
    sp.clock.advance(31 * 24 * HOUR);
    await accept("new");
    expect(await intake.purge.runOnce()).toBe(1);
    expect((await inbox.findByDedupeKey("fake:old"))?.payload).toBeNull();
    expect((await inbox.findByDedupeKey("fake:new"))?.payload).toEqual({ platformLeadId: "new" });
    expect(await intake.purge.runOnce()).toBe(0);
  });
});

describe("ülke çözümü ve DTO kurulumu", () => {
  it("kod, TR/EN ad, bilinmeyen ad", () => {
    expect(countryCodeFrom("tr")).toBe("TR");
    expect(countryCodeFrom("Türkiye")).toBe("TR");
    expect(countryCodeFrom("Turkey")).toBe("TR");
    expect(countryCodeFrom("Birleşik Krallık")).toBe("GB");
    expect(countryCodeFrom("United Arab Emirates")).toBe("AE");
    expect(countryCodeFrom("Atlantis")).toBeNull();
    expect(countryCodeFrom("")).toBeNull();
  });
  it("ülke alanı yoksa telefonun ülkesi; o da yoksa null", () => {
    expect(resolveCountry(null, "+49 30 901820", "TR")).toBe("DE");
    expect(resolveCountry("Atlantis", "0532 123 45 67", "TR")).toBe("TR");
    expect(resolveCountry(null, "abc", "TR")).toBeNull();
    expect(resolveCountry(null, null, "TR")).toBeNull();
  });
  it("buildInboundLead: çözülemeyen ülke metni ek yanıta düşer, boş alanlar null", () => {
    const dto = buildInboundLead({
      source: "google_form",
      provider: "g",
      platformLeadId: "1",
      formId: null,
      mapped: {
        fullName: "A",
        firstName: "",
        lastName: "",
        email: "",
        phone: "",
        country: "Atlantis",
        city: "",
        company: "",
        productInterest: "",
        notes: "",
        extra: { q: "x" },
        unmapped: [],
      },
      isTest: true,
      submittedAt: null,
      defaultCountry: "TR",
      extra: { raw: 1 },
    });
    expect(dto).toMatchObject({ email: null, phone: null, country: null, isTest: true, campaign: {}, attribution: {} });
    expect(dto.extraAnswers).toEqual({ q: "x", raw: 1, country_raw: "Atlantis" });
  });
});
