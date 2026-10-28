import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  InMemoryIntegrationSettings,
  IntegrationSettings,
  mappingRow,
} from "../../../integration-settings/application";
import { createSalesPipeline } from "../../../sales-pipeline/application";
import { testDeps } from "../../../sales-pipeline/application/fakes";
import { hmacSha256Hex, SequentialIdGenerator, silentLogger } from "../../../shared/kernel";
import { createLeadIntake, type AdapterContext } from "../../application";
import { InMemoryInbox } from "../../application/fakes";
import {
  changePayload,
  createGraphClient,
  extractLeadgenChanges,
  graphLeadToDto,
  isMetaTestLead,
  leadPayload,
  metaBackfillSource,
  metaConfig,
  metaSourceAdapter,
  verifyChallenge,
  verifySignature,
  type GraphClient,
  type GraphLead,
} from "./index";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const fixture = <T = unknown>(name: string): T => JSON.parse(readFileSync(join(FIX, name), "utf8")) as T;
const rawFixture = (name: string): Buffer => readFileSync(join(FIX, name));

/** Seed (0004) ile aynı Meta eşlemeleri. */
const SEED = [
  ["full_name", "full_name"],
  ["first_name", "first_name"],
  ["last_name", "last_name"],
  ["email", "email"],
  ["work_email", "email"],
  ["phone_number", "phone"],
  ["work_phone_number", "phone"],
  ["country", "country"],
  ["city", "city"],
  ["company_name", "company"],
  ["job_title", "extra"],
] as const;
const settings = new IntegrationSettings({
  ...new InMemoryIntegrationSettings(SEED.map(([f, t]) => mappingRow("meta", f, t))).repos(),
  clock: { now: () => new Date(0) },
});
const ctx: AdapterContext = { mappingsFor: (formId) => settings.mappingsFor("meta", formId), defaultCountry: "TR" };

const SECRET = "app-secret-for-tests";

describe("webhook doğrulama", () => {
  it("GET: doğru token ve subscribe modu → challenge; aksi halde null", () => {
    const q = { "hub.mode": "subscribe", "hub.verify_token": "tok", "hub.challenge": "12345" };
    expect(verifyChallenge(q, "tok")).toBe("12345");
    expect(verifyChallenge({ ...q, "hub.verify_token": "yanlis" }, "tok")).toBeNull();
    expect(verifyChallenge({ ...q, "hub.mode": "unsubscribe" }, "tok")).toBeNull();
    expect(verifyChallenge({ ...q, "hub.challenge": "" }, "tok")).toBeNull();
    expect(verifyChallenge(q, "")).toBeNull();
  });

  it("POST: imza ham gövde üzerinden; geçerli / geçersiz / eksik başlık / bozuk biçim / secret yok", () => {
    const body = rawFixture("webhook-normal.json");
    const good = `sha256=${hmacSha256Hex(SECRET, body)}`;
    expect(verifySignature(body, good, SECRET)).toBe(true);
    expect(verifySignature(body, good.toUpperCase(), SECRET)).toBe(true);
    expect(verifySignature(Buffer.concat([body, Buffer.from(" ")]), good, SECRET)).toBe(false);
    expect(verifySignature(body, `sha256=${hmacSha256Hex("baska", body)}`, SECRET)).toBe(false);
    expect(verifySignature(body, undefined, SECRET)).toBe(false);
    expect(verifySignature(body, "sha1=abc", SECRET)).toBe(false);
    expect(verifySignature(body, "sha256=", SECRET)).toBe(false);
    expect(verifySignature(body, good, "")).toBe(false);
  });

  it("gövdeden leadgen değişiklikleri çıkar; diğer alanlar ve bozuk gövde yok sayılır", () => {
    expect(extractLeadgenChanges(fixture("webhook-normal.json"))).toEqual([
      {
        leadgenId: "555000001",
        formId: "901000001",
        pageId: "100200300",
        adId: "238800001",
        adgroupId: "238800001",
        createdTime: 1772359140,
      },
    ]);
    const dup = extractLeadgenChanges(fixture("webhook-duplicate.json"));
    expect(dup.map((c) => c.leadgenId)).toEqual(["555000001", "555000001"]);
    expect(extractLeadgenChanges({ object: "user", entry: [] })).toEqual([]);
    expect(extractLeadgenChanges(null)).toEqual([]);
    expect(extractLeadgenChanges({ object: "page", entry: [{ changes: [{ field: "leadgen", value: {} }] }] })).toEqual(
      [],
    );
  });
});

describe("field_data → InboundLeadDto", () => {
  it("normal lead: tüm alanlar, ülke adı → kod, özel soru ek yanıt, kampanya bilgisi", async () => {
    const dto = await graphLeadToDto(fixture<GraphLead>("lead-normal.json"), ctx);
    expect(dto).toMatchObject({
      source: "meta_form",
      provider: "meta",
      platformLeadId: "555000001",
      formId: "901000001",
      fullName: "Ayşe Demir",
      email: "Ayse.Demir@Example.com",
      phone: "+905321234567",
      country: "TR",
      city: "İzmir",
      company: "Demir Spor Tesisleri",
      isTest: false,
      campaign: {
        campaignId: "238600001",
        campaignName: "Lead - Türkiye - Mart",
        adsetId: "238700001",
        adsetName: "Tesis sahipleri",
        adId: "238800001",
        adName: "Panoramik kort - TR",
      },
      submittedAt: new Date("2026-03-01T09:59:00Z"),
    });
    expect(dto.extraAnswers).toEqual({ "kaç_kort_düşünüyorsunuz?": "2", is_organic: false, platform: "fb" });
  });

  it("test lead'i (Testing Tool) test işaretli; ülke metni çözülemeyince telefondan", async () => {
    const lead = fixture<GraphLead>("lead-test.json");
    expect(isMetaTestLead(lead)).toBe(true);
    const dto = await graphLeadToDto(lead, ctx);
    expect(dto).toMatchObject({ isTest: true, country: "US", platformLeadId: "555000002" });
    expect(dto.extraAnswers["country_raw"]).toBe("test lead: dummy data for country");
  });

  it("eksik alanlar: ad + soyad birleşir, yerel telefon varsayılan ülkeyle, e-posta null", async () => {
    const dto = await graphLeadToDto(fixture<GraphLead>("lead-missing-fields.json"), ctx);
    expect(dto).toMatchObject({ fullName: "Mehmet Kaya", email: null, phone: "05419876543", country: "TR", city: "" });
  });

  it("bilinmeyen alanlar hata değil, ek yanıt; çoklu seçim liste kalır; work_email → e-posta", async () => {
    const dto = await graphLeadToDto(fixture<GraphLead>("lead-unknown-fields.json"), ctx);
    expect(dto).toMatchObject({
      fullName: "Hans Müller",
      email: "hans@mueller.de",
      country: "DE",
      formId: "901000002",
    });
    expect(dto.extraAnswers).toEqual({
      budget_range: "50-100k",
      preferred_surface: ["Cam", "Panoramik"],
      job_title: "Geschäftsführer",
    });
    expect(dto.campaign.campaignId).toBe("238600002");
  });

  it("form bazlı eşleme varsayılanı ezer", async () => {
    const custom = new IntegrationSettings({
      ...new InMemoryIntegrationSettings([
        ...SEED.map(([f, t]) => mappingRow("meta", f, t)),
        mappingRow("meta", "budget_range", "product_interest", "901000002"),
      ]).repos(),
      clock: { now: () => new Date(0) },
    });
    const dto = await graphLeadToDto(fixture<GraphLead>("lead-unknown-fields.json"), {
      ...ctx,
      mappingsFor: (f) => custom.mappingsFor("meta", f),
    });
    expect(dto.productInterest).toBe("50-100k");
    expect(dto.extraAnswers["budget_range"]).toBeUndefined();
  });

  it("kimliksiz lead kalıcı hata", async () => {
    await expect(graphLeadToDto({ id: "" }, ctx)).rejects.toMatchObject({
      code: "meta.lead_without_id",
      kind: "permanent",
    });
  });
});

describe("kaynak adaptörü ve yedek senkron", () => {
  const graph = (): GraphClient & { getLead: ReturnType<typeof vi.fn> } => ({
    getLead: vi.fn(async (id: string) => ({ ...fixture<GraphLead>("lead-normal.json"), id })),
    getFormLeads: vi.fn(async () => []),
    subscribePage: vi.fn(async () => ({ success: true })),
    getSubscribedApps: vi.fn(async () => ({})),
  });

  it("change payload'ı Graph'tan çeker; lead payload'ı çağrı yapmaz; tanınmayan payload kalıcı hata", async () => {
    const g = graph();
    const adapter = metaSourceAdapter(g);
    const change = extractLeadgenChanges(fixture("webhook-normal.json"))[0]!;
    const dto = await adapter.toInboundLead(changePayload(change), ctx);
    expect(g.getLead).toHaveBeenCalledWith("555000001");
    expect(dto.fullName).toBe("Ayşe Demir");
    const dto2 = await adapter.toInboundLead(leadPayload(fixture<GraphLead>("lead-test.json")), ctx);
    expect(g.getLead).toHaveBeenCalledTimes(1);
    expect(dto2.isTest).toBe(true);
    await expect(adapter.toInboundLead({ foo: 1 }, ctx)).rejects.toMatchObject({ code: "meta.payload_unknown" });
  });

  it("yedek senkron: her aktif form için son 2 saat; dedupe anahtarı meta:<id>; form_id doldurulur", async () => {
    const g = graph();
    g.getFormLeads = vi.fn(async (formId: string) =>
      formId === "f-1" ? fixture<{ data: GraphLead[] }>("form-leads-page1.json").data : [],
    );
    const src = metaBackfillSource(g, async () => ["f-1", "f-2"]);
    const since = new Date("2026-03-01T08:00:00Z");
    const items = await src.fetchSince(since);
    expect(g.getFormLeads).toHaveBeenCalledTimes(2);
    expect(g.getFormLeads).toHaveBeenCalledWith("f-1", since);
    expect(items.map((i) => i.dedupeKey)).toEqual(["meta:555000001", "meta:555000009"]);
    expect(items[0]?.payload).toMatchObject({ kind: "lead", lead: { id: "555000001", form_id: "f-1" } });
  });

  it("uçtan uca: webhook → inbox → lead; aynı bildirim iki kez → tek lead; webhook kapalıyken kaçan lead yedek senkronla gelir", async () => {
    const sp = testDeps();
    const inbox = new InMemoryInbox();
    const g = graph();
    g.getFormLeads = vi.fn(async () => fixture<{ data: GraphLead[] }>("form-leads-page1.json").data);
    const intake = createLeadIntake({
      inbox,
      adapters: [metaSourceAdapter(g)],
      backfillSources: [metaBackfillSource(g, async () => ["901000001"])],
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
    for (const c of extractLeadgenChanges(fixture("webhook-duplicate.json"))) {
      await intake.accept.execute({
        provider: "meta",
        kind: "webhook",
        platformLeadId: c.leadgenId,
        payload: changePayload(c),
      });
    }
    expect(inbox.rows).toHaveLength(1);
    expect(await intake.process.runOnce()).toMatchObject({ done: 1 });
    expect(sp.uow.state.leads).toHaveLength(1);
    expect(sp.uow.state.leads[0]).toMatchObject({
      platformLeadId: "555000001",
      email: "ayse.demir@example.com",
      country: "TR",
    });

    // webhook kapalıyken 555000009 düştü; saatlik senkron getirir, 555000001 zaten var
    expect(await intake.backfill.runOnce()).toEqual({ meta: { fetched: 2, inserted: 1 } });
    expect(await intake.process.runOnce()).toMatchObject({ done: 1 });
    expect(sp.uow.state.leads.map((l) => l.platformLeadId).sort()).toEqual(["555000001", "555000009"]);
    expect(g.getLead).toHaveBeenCalledTimes(1); // senkron lead'i yeniden çekilmedi

    // iletişimsiz lead: kalıcı hata, failed
    await intake.accept.execute({
      provider: "meta",
      kind: "backfill",
      platformLeadId: "555000005",
      payload: leadPayload(fixture<GraphLead>("lead-no-contact.json")),
    });
    expect(await intake.process.runOnce()).toMatchObject({ failed: 1 });
    expect((await inbox.findByDedupeKey("meta:555000005"))?.lastErrorCode).toBe("intake.invalid_lead");
  });
});

describe("Graph API istemcisi", () => {
  const json = (status: number, body: unknown): Response =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const client = (impl: (url: string, init?: RequestInit) => Promise<Response>, token = "tok") =>
    createGraphClient({ version: "v26.0", token, logger: silentLogger, fetchImpl: impl, maxPages: 5 });

  it("getLead: sürüm, alanlar ve Bearer başlığı; token URL'de yok", async () => {
    const fetchImpl = vi.fn(async () => json(200, fixture("lead-normal.json")));
    const lead = await client(fetchImpl).getLead("555000001");
    expect(lead.id).toBe("555000001");
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url.startsWith("https://graph.facebook.com/v26.0/555000001?fields=")).toBe(true);
    expect(url).not.toContain("tok");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer tok");
    expect(init.method).toBe("GET");
  });

  it("hata sınıflandırması: 5xx/429/oran sınırı geçici; 190 token; 100 kalıcı; ağ hatası geçici; token yok kalıcı", async () => {
    const code = (status: number, c?: number) =>
      client(async () => json(status, { error: { message: "m", code: c } })).getLead("1");
    await expect(code(500)).rejects.toMatchObject({ kind: "transient", code: "meta.unavailable" });
    await expect(code(429)).rejects.toMatchObject({ kind: "transient" });
    await expect(code(400, 4)).rejects.toMatchObject({ kind: "transient" });
    await expect(code(400, 190)).rejects.toMatchObject({ kind: "permanent", code: "meta.token_invalid" });
    await expect(code(403, 10)).rejects.toMatchObject({ kind: "permanent", code: "meta.permission" });
    await expect(code(400, 100)).rejects.toMatchObject({ kind: "permanent", code: "meta.bad_request" });
    await expect(
      client(async () => {
        throw new Error("ECONNRESET");
      }).getLead("1"),
    ).rejects.toMatchObject({ kind: "transient", code: "meta.network" });
    await expect(client(async () => json(200, {}), "").getLead("1")).rejects.toMatchObject({
      code: "meta.token_missing",
    });
  });

  it("getFormLeads: time_created filtresi, sayfalama (after) ve birleştirme", async () => {
    const calls: string[] = [];
    const fetchImpl = async (url: string) => {
      calls.push(url);
      return json(200, fixture(url.includes("after=a1") ? "form-leads-page2.json" : "form-leads-page1.json"));
    };
    const leads = await client(fetchImpl).getFormLeads("901000001", new Date("2026-03-01T08:00:00Z"));
    expect(leads.map((l) => l.id)).toEqual(["555000001", "555000009", "555000010"]);
    expect(calls).toHaveLength(2);
    const u = new URL(calls[0]!);
    expect(u.pathname).toBe("/v26.0/901000001/leads");
    expect(JSON.parse(u.searchParams.get("filtering")!)).toEqual([
      { field: "time_created", operator: "GREATER_THAN", value: 1772352000 },
    ]);
    expect(new URL(calls[1]!).searchParams.get("after")).toBe("a1");
  });

  it("subscribePage: POST subscribed_apps?subscribed_fields=leadgen", async () => {
    const fetchImpl = vi.fn(async () => json(200, { success: true }));
    expect(await client(fetchImpl).subscribePage("100200300")).toEqual({ success: true });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://graph.facebook.com/v26.0/100200300/subscribed_apps?subscribed_fields=leadgen");
    expect(init.method).toBe("POST");
  });
});

describe("config", () => {
  it("secret adları sabit; sürüm varsayılanı; form listesi", () => {
    const env: Record<string, string> = {
      META_APP_SECRET: "s",
      META_VERIFY_TOKEN: "v",
      META_SYSTEM_USER_TOKEN: "t",
      META_FORM_IDS: " a, b ,,",
    };
    const c = metaConfig((n) => env[n] ?? "");
    expect(c).toEqual({
      appSecret: "s",
      verifyToken: "v",
      systemUserToken: "t",
      graphVersion: "v26.0",
      formIds: ["a", "b"],
      pageId: "",
    });
  });
});
