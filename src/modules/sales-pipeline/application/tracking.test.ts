import { beforeEach, describe, expect, it } from "vitest";
import { unwrap } from "../../shared/kernel";
import { testDeps, type TestHarness } from "./fakes";
import { createSalesPipeline, type SalesPipeline } from "./index";

/** Faz 7g S4–S6: okuma modeli, ortak süzgeç, Bugün, Temas geçmişi, Özet rapor, alan düzenleme. */
const ADMIN = { userId: "admin", isAdmin: true };
const REP = { userId: "rep-1", isAdmin: false };
const REP2 = { userId: "rep-2", isAdmin: false };

let h: TestHarness;
let sp: SalesPipeline;
let n = 0;

const lead = async (over: Record<string, unknown> = {}) =>
  unwrap(
    await sp.createLead.execute({
      source: "manual",
      fullName: `Lead ${++n}`,
      email: `lead${n}@example.com`,
      country: "TR",
      actor: ADMIN,
      assignedUserId: "rep-1",
      ...over,
    }),
  ).lead;

beforeEach(() => {
  h = testDeps();
  sp = createSalesPipeline(h);
  n = 0;
});

describe("ortak süzgeç ve izleme bilgisi", () => {
  it("contact, hot, scope, campaign süzgeçleri; liste öğesi temas özetini taşır", async () => {
    const never = await lead({ installTimeline: "m0_3" });
    const replied = await lead();
    const waiting = await lead({ campaign: { campaignName: "Kış" } });
    const excel = await lead({ extraAnswers: { excel_no: 7 } });
    unwrap(await sp.logContact.execute({ leadId: replied.id, actor: REP, type: "call", outcome: "reply_received" }));
    unwrap(await sp.logContact.execute({ leadId: waiting.id, actor: REP, type: "email", outcome: "awaiting_reply" }));

    const ids = async (f: Record<string, unknown>) =>
      (await sp.queries.list({ actor: ADMIN, ...f })).map((l) => l.id).sort();
    expect(await ids({ contact: "never" })).toEqual([never.id, excel.id].sort());
    expect(await ids({ contact: "replied" })).toEqual([replied.id]);
    expect(await ids({ contact: "no_reply" })).toEqual([waiting.id]);
    expect(await ids({ hot: true })).toEqual([never.id]);
    expect(await ids({ scope: "excel" })).toEqual([excel.id]);
    expect(await ids({ campaign: "Kış" })).toEqual([waiting.id]);

    const item = (await sp.queries.list({ actor: ADMIN })).find((l) => l.id === waiting.id)!;
    expect(item.contact).toMatchObject({ state: "contacted", count: 1, replied: false, lastOutcome: "awaiting_reply" });
    expect(item.contact.channels.email?.count).toBe(1);

    const board = await sp.queries.board({ actor: ADMIN, contact: "never" });
    expect(board.leads).toHaveLength(2);
    expect(board.columns.find((c) => c.stage === "NEW")?.count).toBe(2);
  });

  it("Bugün: hotUncontacted = /leads?hot=1&contact=never; satır son temas bilgisini taşır", async () => {
    const hot = await lead({ installTimeline: "m0_3" });
    await lead({ installTimeline: "m0_3" });
    const contacted = await lead({ installTimeline: "m0_3" });
    unwrap(
      await sp.logContact.execute({
        leadId: contacted.id,
        actor: REP,
        type: "whatsapp",
        outcome: "awaiting_reply",
        next: { type: "whatsapp", dueAt: new Date("2026-03-02T06:00:00Z") },
      }),
    );
    const today = await sp.activities.today(REP);
    const listed = await sp.queries.list({ actor: REP, hot: true, contact: "never" });
    expect(today.hotUncontacted).toBe(listed.length);
    expect(today.hotUncontacted).toBe(2);
    expect(listed.map((l) => l.id)).toContain(hot.id);
    const row = today.upcoming.find((x) => x.lead.id === contacted.id);
    expect(row).toMatchObject({ lastOutcome: "awaiting_reply", lastType: "whatsapp" });
  });

  it("uyarılar izleyene göre süzülür; kontrol edilmiş uyarı warning=1'den düşer", async () => {
    const a = await lead({ phone: "+90 212 000 00 00", country: "DE" });
    const adminItem = (await sp.queries.list({ actor: ADMIN })).find((l) => l.id === a.id)!;
    expect(adminItem.warnings.map((w) => w.code)).toContain("phone_country_mismatch");
    expect((await sp.queries.list({ actor: ADMIN, warning: true })).map((l) => l.id)).toEqual([a.id]);
    const repItem = (await sp.queries.list({ actor: REP })).find((l) => l.id === a.id)!;
    expect(
      repItem.warnings.every((w) => ["phone_country_mismatch", "phone_invalid", "roof_size_missing"].includes(w.code)),
    ).toBe(true);
    for (const w of adminItem.warnings.filter((x) => x.severity === "warn")) {
      unwrap(await sp.checkWarning.execute({ leadId: a.id, code: w.code, checked: true, actor: ADMIN }));
    }
    expect(await sp.queries.list({ actor: ADMIN, warning: true })).toEqual([]);
  });
});

describe("Temas geçmişi", () => {
  it("satışçı kendi + havuz; sayfalama aynı done_at'ta kayıpsız ve tekrarsız; sonraki takip eklenir", async () => {
    const mine = await lead();
    const other = await lead({ assignedUserId: "rep-2" });
    for (let i = 0; i < 7; i++) {
      unwrap(await sp.logContact.execute({ leadId: mine.id, actor: REP, type: "call", outcome: "follow_up" }));
    }
    unwrap(await sp.logContact.execute({ leadId: other.id, actor: REP2, type: "call", outcome: "negative" }));
    unwrap(
      await sp.logContact.execute({
        leadId: mine.id,
        actor: REP,
        type: "email",
        outcome: "awaiting_reply",
        note: "fiyat listesi",
        next: { type: "email", dueAt: new Date("2026-03-04T06:00:00Z") },
      }),
    );
    const seen: string[] = [];
    let before: string | undefined;
    for (let page = 0; page < 5; page++) {
      const r = unwrap(await sp.history.history({ actor: REP, limit: 3, before }));
      seen.push(...r.items.map((x) => x.activity.id));
      if (!r.nextBefore) break;
      before = r.nextBefore;
    }
    expect(seen).toHaveLength(8);
    expect(new Set(seen).size).toBe(8);
    const withNote = unwrap(await sp.history.history({ actor: REP, note: "FİYAT" }));
    expect(withNote.items).toHaveLength(1);
    expect(withNote.items[0]?.next?.type).toBe("email");
    expect(unwrap(await sp.history.history({ actor: ADMIN })).items).toHaveLength(9);
    expect(sp.history.history({ actor: ADMIN, from: "2026-03-05", to: "2026-03-01" })).resolves.toMatchObject({
      ok: false,
    });
  });
});

describe("Özet rapor", () => {
  it("kapsam: satışçı kendi + havuz; scope=excel; ekip dizini satırları; dizin yoksa çalışır", async () => {
    await lead({ extraAnswers: { excel_no: 1 } });
    await lead({ assignedUserId: "rep-2", extraAnswers: { excel_no: 2 } });
    await lead({ assignedUserId: null });
    const rep = unwrap(await sp.reports.tracking({ actor: REP }));
    expect(rep.basics.total).toBe(2);
    expect(rep.scope.repScoped).toBe(true);
    const all = unwrap(await sp.reports.tracking({ actor: ADMIN }));
    expect(all.basics.total).toBe(3);
    expect(all.scope.counts).toEqual({ all: 3, excel: 2 });
    expect(unwrap(await sp.reports.tracking({ actor: ADMIN, scope: "excel" })).basics.total).toBe(2);

    const withTeam = createSalesPipeline({
      ...h,
      team: { activeSalesUserIds: async () => ["rep-1", "rep-2", "rep-3"] },
    });
    const t = unwrap(await withTeam.reports.tracking({ actor: ADMIN }));
    expect(t.byOwner.map((r) => r.ownerId)).toEqual(["rep-1", "rep-2", "rep-3", null]);
    expect(unwrap(await sp.reports.tracking({ actor: ADMIN, from: "2026-04-01" })).basics.total).toBe(0);
  });
});

describe("Alanlar ve oluşturma (S5)", () => {
  it("ürün varken courtCount reddi; satışçıya ürün alanı admin_only, policy açıkken izinli", async () => {
    const a = await lead();
    unwrap(
      await sp.updateLeadFields.execute({
        leadId: a.id,
        fields: { products: { panoramic: 2, roof: { wanted: true, widthM: "20,5", lengthM: 10 } } },
        actor: ADMIN,
      }),
    );
    expect(h.uow.state.leads[0]?.products).toEqual({
      standard: null,
      panoramic: 2,
      fullPanoramic: null,
      roof: { wanted: true, widthM: 20.5, lengthM: 10 },
    });
    const conflict = await sp.updateLeadFields.execute({ leadId: a.id, fields: { courtCount: 3 }, actor: ADMIN });
    expect(!conflict.ok && conflict.error.code).toBe("court_count.derived");
    const repTry = await sp.updateLeadFields.execute({
      leadId: a.id,
      fields: { products: { standard: 1 } },
      actor: REP,
    });
    expect(!repTry.ok && repTry.error.code).toBe("admin_only");
    const open = createSalesPipeline({ ...h, policy: { repsEditProducts: true } });
    expect(
      (await open.updateLeadFields.execute({ leadId: a.id, fields: { products: { standard: 1 } }, actor: REP })).ok,
    ).toBe(true);
  });

  it("açık soru 1 cevabı: satışçı ürünleri yalnız kendi lead'inde girer; havuzda önce üstlenir; başkasınınkine giremez", async () => {
    const sp2 = createSalesPipeline({ ...h, policy: { repsEditProducts: true } });
    const mine = await lead();
    const pool = await lead({ assignedUserId: null });
    const other = await lead({ assignedUserId: "rep-2" });
    const products = { standard: 2, roof: { wanted: true, widthM: 10, lengthM: 20 } };
    expect((await sp2.updateLeadFields.execute({ leadId: mine.id, fields: { products }, actor: REP })).ok).toBe(true);
    const poolTry = await sp2.updateLeadFields.execute({ leadId: pool.id, fields: { products }, actor: REP });
    expect(!poolTry.ok && poolTry.error.code).toBe("lead.products_owner_only");
    const otherTry = await sp2.updateLeadFields.execute({ leadId: other.id, fields: { products }, actor: REP });
    expect(!otherTry.ok && otherTry.error.code).toBe("lead.forbidden");
    // Satışçı yine yalnız notu ve ürünleri değiştirir; form cevapları ve ülke yöneticinin.
    const siteTry = await sp2.updateLeadFields.execute({
      leadId: mine.id,
      fields: { installSite: "rooftop" },
      actor: REP,
    });
    expect(!siteTry.ok && siteTry.error.code).toBe("admin_only");
  });

  it("ülke değişince köken bilgisi ve kontrol işaretleri düşer; geçersiz kod lead.<alan>", async () => {
    const a = await lead({ extraAnswers: { country_source: "phone", country_raw: "Türkiye" } });
    unwrap(await sp.checkWarning.execute({ leadId: a.id, code: "country_from_phone", checked: true, actor: ADMIN }));
    const r = unwrap(await sp.updateLeadFields.execute({ leadId: a.id, fields: { country: "de" }, actor: ADMIN }));
    expect(r.country).toBe("DE");
    expect(r.extraAnswers).toEqual({});
    expect(r.checkedWarnings).toEqual([]);
    const bad = await sp.updateLeadFields.execute({ leadId: a.id, fields: { installSite: "mars" }, actor: ADMIN });
    expect(!bad.ok && bad.error.code).toBe("lead.install_site");
  });

  it("esnek mod ve bozuk telefon; Excel lead'i benimsenir; pasif kural kullanıcısı atlanır", async () => {
    const r = unwrap(
      await sp.createLead.execute({
        source: "manual",
        fullName: "Form",
        email: "form@example.com",
        phone: "12",
        installSite: "mars",
        installTimeline: "m0_3",
        parseMode: "lenient",
        invalidPhone: "drop",
      }),
    );
    expect(r.lead).toMatchObject({ phoneE164: null, installSite: null, installTimeline: "m0_3" });
    expect(r.lead.extraAnswers["phone_raw"]).toBe("12");

    const excel = await lead({ email: "excel@example.com", extraAnswers: { excel_no: 3 } });
    const adopted = unwrap(
      await sp.createLead.execute({
        source: "meta_form",
        platformLeadId: "p-1",
        fullName: "Excel Kişi",
        email: "excel@example.com",
        installSite: "rooftop",
        adoptImportLead: true,
        parseMode: "lenient",
      }),
    );
    expect(adopted).toMatchObject({ created: false, adopted: true });
    expect(adopted.lead.id).toBe(excel.id);
    expect(h.uow.state.leads.find((l) => l.id === excel.id)).toMatchObject({ installSite: "rooftop" });
    expect(h.uow.state.leads.find((l) => l.id === excel.id)?.extraAnswers["platform_lead_id"]).toBe("p-1");
    expect(h.uow.state.leads.find((l) => l.id === excel.id)?.extraAnswers["platform_source"]).toBe("meta_form");

    h.uow.state.territories.push({ countryCode: "TR", assignedUserId: "rep-old", fallbackUserId: "rep-1" });
    const withDir = createSalesPipeline({
      ...h,
      team: { activeSalesUserIds: async () => null, inactiveUserIds: async () => new Set(["rep-old"]) },
    });
    const routed = unwrap(
      await withDir.createLead.execute({ source: "manual", fullName: "TR", email: "tr@example.com", country: "TR" }),
    );
    expect(routed.lead.assignedUserId).toBe("rep-1");
    const failOpen = createSalesPipeline({
      ...h,
      team: { activeSalesUserIds: async () => null, inactiveUserIds: async () => null },
    });
    const routed2 = unwrap(
      await failOpen.createLead.execute({ source: "manual", fullName: "TR2", email: "tr2@example.com", country: "TR" }),
    );
    expect(routed2.lead.assignedUserId).toBe("rep-old");
  });
});
