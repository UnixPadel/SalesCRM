import { beforeEach, describe, expect, it } from "vitest";
import { MINUTE, unwrap } from "../../shared/kernel";
import { createSalesPipeline, type SalesPipeline } from "./index";
import { testDeps, type TestHarness } from "./fakes";

const ADMIN = { userId: "admin", isAdmin: true };
const REP = { userId: "rep-1", isAdmin: false };
const REP2 = { userId: "rep-2", isAdmin: false };
const YES = { budget_approved: true, site_known: true, install_within_12m: true };

let h: TestHarness;
let sp: SalesPipeline;

const manual = (over: Record<string, unknown> = {}) =>
  sp.createLead.execute({
    source: "manual",
    fullName: "Ayşe Demir",
    email: "Ayse@Example.com",
    phone: "0532 123 45 67",
    country: "tr",
    actor: REP,
    ...over,
  });

beforeEach(() => {
  h = testDeps({ providers: ["fakeA", "fakeB"] });
  sp = createSalesPipeline(h);
});

describe("CreateLead", () => {
  it("manuel lead: kişi açılır, NEW olayı sistem kaynaklı, outbox platform başına, atama elle açana", async () => {
    const r = unwrap(await manual());
    expect(r.created).toBe(true);
    expect(r.personMatched).toBe(false);
    expect(r.lead).toMatchObject({
      source: "manual",
      email: "ayse@example.com",
      phoneE164: "+905321234567",
      country: "TR",
      currentStage: "NEW",
      assignedUserId: "rep-1",
    });
    const s = h.uow.state;
    expect(s.persons).toHaveLength(1);
    expect(s.events).toHaveLength(1);
    expect(s.events[0]).toMatchObject({ stageCode: "NEW", origin: "system", sequence: 1, actorUserId: "rep-1" });
    expect(s.outbox.map((o) => o.provider)).toEqual(["fakeA", "fakeB"]);
    expect(s.outbox[0]?.nextAttemptAt.toISOString()).toBe("2026-03-01T10:10:00.000Z");
    expect(h.events.published.map((e) => e.type)).toEqual(["LeadCreated", "LeadAssigned"]);
  });

  it("doğrulama: ad, iletişim, ülke, e-posta, telefon", async () => {
    const code = async (over: Record<string, unknown>) => {
      const r = await manual(over);
      return r.ok ? "ok" : r.error.code;
    };
    expect(await code({ fullName: "  " })).toBe("lead.name_required");
    expect(await code({ email: "", phone: "" })).toBe("lead.contact_required");
    expect(await code({ country: "Türkiye" })).toBe("lead.country_invalid");
    expect(await code({ email: "bozuk" })).toBe("email.invalid");
    expect(await code({ phone: "123", country: "" })).toBe("phone.invalid");
    expect(await code({ source: "meta_form" })).toBe("lead.platform_id_required");
    expect(h.uow.state.leads).toHaveLength(0);
  });

  it("mükerrer kişi: aynı e-posta ya da telefon → aynı kişi, yeni lead", async () => {
    const a = unwrap(await manual());
    const b = unwrap(await manual({ fullName: "Ayse D.", email: "", phone: "+90 532 123 45 67" }));
    const c = unwrap(await manual({ fullName: "A. Demir", email: "ayse@example.com", phone: "" }));
    expect(b.personMatched).toBe(true);
    expect(c.personMatched).toBe(true);
    expect(new Set([a.lead.personId, b.lead.personId, c.lead.personId]).size).toBe(1);
    expect(h.uow.state.leads).toHaveLength(3);
    expect(h.uow.state.persons).toHaveLength(1);
  });

  it("aynı kaynak + platform kimliği ikinci kez gelirse yeni kayıt açılmaz", async () => {
    const first = unwrap(await manual({ source: "meta_form", platformLeadId: "12345678901234567", actor: null }));
    const second = unwrap(await manual({ source: "meta_form", platformLeadId: "12345678901234567", actor: null }));
    expect(second.created).toBe(false);
    expect(second.lead.id).toBe(first.lead.id);
    expect(h.uow.state.leads).toHaveLength(1);
    expect(h.events.published.filter((e) => e.type === "LeadCreated")).toHaveLength(1);
  });

  it("atama önceliği: açık atama > satışçı > ülke kuralı > havuz", async () => {
    h.uow.state.territories.push({ countryCode: "DE", assignedUserId: "rep-de", fallbackUserId: null });
    expect(unwrap(await manual({ assignedUserId: "rep-9" })).lead.assignedUserId).toBe("rep-9");
    expect(unwrap(await manual({ assignedUserId: null, email: "x1@a.com", phone: "" })).lead.assignedUserId).toBeNull();
    expect(
      unwrap(await manual({ actor: ADMIN, country: "DE", email: "x2@a.com", phone: "" })).lead.assignedUserId,
    ).toBe("rep-de");
    expect(
      unwrap(await manual({ actor: ADMIN, country: "FR", email: "x3@a.com", phone: "" })).lead.assignedUserId,
    ).toBeNull();
    expect(unwrap(await manual({ actor: null, country: "DE", email: "x4@a.com", phone: "" })).lead.assignedUserId).toBe(
      "rep-de",
    );
  });

  it("attribution: tıklama kimliği verilirse lead ile birlikte saklanır; hepsi boşsa satır yok", async () => {
    const withId = unwrap(
      await manual({
        source: "google_form",
        platformLeadId: "g-1",
        attribution: { gclid: "Cj0KCQ", utmSource: "ads" },
      }),
    ).lead;
    expect(h.uow.state.attributions[withId.id]).toMatchObject({ gclid: "Cj0KCQ", utmSource: "ads", fbclid: null });
    const without = unwrap(await manual({ email: "b@a.com", phone: "", attribution: { gclid: "" } })).lead;
    expect(h.uow.state.attributions[without.id]).toBeUndefined();
  });

  it("test lead'i outbox'a girmez", async () => {
    unwrap(await manual({ isTest: true }));
    expect(h.uow.state.outbox).toHaveLength(0);
  });

  it("onaylar: lead ile birlikte lead_consents'e yazılır; zaman verilmezse oluşturulma anı", async () => {
    const at = new Date("2026-02-28T09:00:00Z");
    const r = unwrap(
      await manual({
        consents: [
          { type: "kvkk", granted: true, textVersion: "2026-01", grantedAt: at },
          { type: "marketing", granted: false },
        ],
      }),
    );
    const rows = await sp.queries.consents(r.lead.id);
    expect(rows.map((c) => [c.type, c.granted, c.textVersion, c.grantedAt.toISOString()])).toEqual([
      ["kvkk", true, "2026-01", at.toISOString()],
      ["marketing", false, "", h.clock.now().toISOString()],
    ]);
    const none = unwrap(await manual({ email: "c@a.com", phone: "", consents: [] })).lead;
    expect(await sp.queries.consents(none.id)).toEqual([]);
  });

  it("outboundContext: olay + lead + attribution + onaylar tek DTO'da; bilinmeyen kimlik atlanır", async () => {
    const r = unwrap(
      await manual({
        source: "web_form",
        platformLeadId: "sub-9",
        actor: null,
        attribution: { fbclid: "F9", fbc: "fb.1.1.F9" },
        consents: [{ type: "kvkk", granted: true, textVersion: "2026-01" }],
      }),
    );
    const eventId = h.uow.state.events.find((e) => e.leadId === r.lead.id)!.id;
    const ctx = await sp.queries.outboundContext([eventId, "yok-boyle-olay"]);
    expect(ctx).toHaveLength(1);
    expect(ctx[0]).toMatchObject({
      stageEventId: eventId,
      leadId: r.lead.id,
      stageCode: "NEW",
      undoneAt: null,
      origin: "system",
      value: null,
      lead: {
        source: "web_form",
        platformLeadId: "sub-9",
        email: "ayse@example.com",
        phoneE164: "+905321234567",
        isTest: false,
        country: "TR",
      },
      attribution: { fbclid: "F9", fbc: "fb.1.1.F9", gclid: null },
    });
    expect(ctx[0]!.consents.map((c) => [c.type, c.granted])).toEqual([["kvkk", true]]);
    expect(await sp.queries.outboundContext([])).toEqual([]);
  });

  it("onay türü geçersizse lead açılmaz (consent.type_invalid)", async () => {
    const r = await manual({ consents: [{ type: "KVKK onayı", granted: true }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("consent.type_invalid");
    expect(h.uow.state.leads).toHaveLength(0);
  });
});

describe("ChangeLeadStage", () => {
  let leadId: string;
  beforeEach(async () => {
    leadId = unwrap(await manual()).lead.id;
    h.events.published = [];
  });

  it("ileri geçiş: olay + outbox + current_stage birlikte; dağıtım 10 dk sonra", async () => {
    h.clock.advance(5 * MINUTE);
    const r = unwrap(await sp.changeLeadStage.execute({ leadId, target: "CONTACTED", actor: REP }));
    expect(r.lead.currentStage).toBe("CONTACTED");
    expect(r.events.map((e) => [e.stageCode, e.origin, e.sequence])).toEqual([["CONTACTED", "manual", 2]]);
    const s = h.uow.state;
    expect(s.leads[0]?.currentStage).toBe("CONTACTED");
    expect(s.outbox.filter((o) => o.stageEventId === r.events[0]?.id).map((o) => o.provider)).toEqual([
      "fakeA",
      "fakeB",
    ]);
    expect(s.outbox.at(-1)?.nextAttemptAt.toISOString()).toBe("2026-03-01T10:15:00.000Z");
    expect(h.events.published).toEqual([
      expect.objectContaining({ type: "LeadStageChanged", from: "NEW", to: "CONTACTED", changeId: r.changeId }),
    ]);
  });

  it("atlanan aşamalar auto_fill, aynı changeId ve zaman damgası, sıra korunur", async () => {
    const r = unwrap(await sp.changeLeadStage.execute({ leadId, target: "PROPOSAL", actor: REP }));
    expect(r.events.map((e) => [e.stageCode, e.origin, e.sequence])).toEqual([
      ["CONTACTED", "auto_fill", 2],
      ["QUALIFIED", "auto_fill", 3],
      ["PROPOSAL", "manual", 4],
    ]);
    expect(new Set(r.events.map((e) => e.changeId)).size).toBe(1);
    expect(new Set(r.events.map((e) => e.occurredAt.toISOString())).size).toBe(1);
    expect(h.uow.state.outbox).toHaveLength(2 + 3 * 2);
  });

  it("WON tutar ister, LOST neden ister, QUALIFIED üç evet ister", async () => {
    const code = async (input: Record<string, unknown>) => {
      const r = await sp.changeLeadStage.execute({ leadId, actor: REP, ...(input as { target: "WON" }) });
      return r.ok ? "ok" : r.error.code;
    };
    expect(await code({ target: "WON" })).toBe("stage.value_required");
    expect(await code({ target: "LOST" })).toBe("stage.reason_required");
    expect(await code({ target: "LOST", lostReasonCode: "mars" })).toBe("stage.reason_unknown");
    expect(await code({ target: "QUALIFIED", qualificationAnswers: { ...YES, site_known: false } })).toBe(
      "stage.not_qualified",
    );
    expect(h.uow.state.events).toHaveLength(1);
    expect(await code({ target: "QUALIFIED", qualificationAnswers: YES })).toBe("ok");
    expect(await code({ target: "WON", value: { amount: 85000, currency: "EUR" } })).toBe("ok");
    expect(h.uow.state.leads[0]?.currentStage).toBe("WON");
    expect(h.uow.state.events.at(-1)?.value).toEqual({ amount: 85000, currency: "EUR" });
    expect(await code({ target: "LOST", lostReasonCode: "competitor" })).toBe("stage.terminal");
  });

  it("geriye gidiş reddedilir, hiçbir şey yazılmaz", async () => {
    unwrap(await sp.changeLeadStage.execute({ leadId, target: "PROPOSAL", actor: REP }));
    const before = structuredClone(h.uow.state);
    const r = await sp.changeLeadStage.execute({ leadId, target: "CONTACTED", actor: REP });
    expect(!r.ok && r.error.code).toBe("stage.backward");
    expect(h.uow.state).toEqual(before);
  });

  it("yetki: başkasının lead'i değiştirilemez; havuzdaki lead'i değiştiren satışçı üstlenir; admin her şeyi", async () => {
    const other = await sp.changeLeadStage.execute({ leadId, target: "CONTACTED", actor: REP2 });
    expect(!other.ok && other.error.code).toBe("lead.forbidden");
    const pool = unwrap(await manual({ assignedUserId: null, email: "pool@a.com", phone: "" })).lead;
    const taken = unwrap(await sp.changeLeadStage.execute({ leadId: pool.id, target: "CONTACTED", actor: REP2 }));
    expect(taken.assignedTo).toBe("rep-2");
    expect(h.uow.state.leads.find((l) => l.id === pool.id)?.assignedUserId).toBe("rep-2");
    expect(h.events.published.at(-1)).toMatchObject({ type: "LeadAssigned", to: "rep-2" });
    expect((await sp.changeLeadStage.execute({ leadId, target: "CONTACTED", actor: ADMIN })).ok).toBe(true);
    const missing = await sp.changeLeadStage.execute({ leadId: "yok", target: "CONTACTED", actor: ADMIN });
    expect(!missing.ok && missing.error.code).toBe("not_found");
  });

  it("transaction: yazma sırasında hata olursa olay, outbox ve aşama hiçbiri kalmaz", async () => {
    // Üçüncü olay (PROPOSAL) eklenirken veritabanı hatası: önceki iki olay ve outbox satırları da kalmamalı.
    h.uow.state.poisonStage = "PROPOSAL";
    const snapshot = structuredClone(h.uow.state);
    await expect(sp.changeLeadStage.execute({ leadId, target: "PROPOSAL", actor: REP })).rejects.toThrow("poison");
    expect(h.uow.state).toEqual(snapshot);
    expect(h.uow.state.leads[0]?.currentStage).toBe("NEW");
    expect(h.uow.state.events).toHaveLength(1);
    expect(h.uow.state.outbox).toHaveLength(2);
    expect(h.events.published).toHaveLength(0);
  });
});

describe("UndoStageChange", () => {
  let leadId: string;
  beforeEach(async () => {
    leadId = unwrap(await manual()).lead.id;
    unwrap(await sp.changeLeadStage.execute({ leadId, target: "PROPOSAL", actor: REP }));
    h.events.published = [];
  });

  it("10 dk içinde: olaylar undone_at alır, outbox skipped, aşama geri döner; olay silinmez", async () => {
    h.clock.advance(9 * MINUTE);
    const r = unwrap(await sp.undoStageChange.execute({ leadId, actor: REP }));
    expect(r.revertedTo).toBe("NEW");
    const s = h.uow.state;
    expect(s.leads[0]?.currentStage).toBe("NEW");
    expect(s.events).toHaveLength(4);
    expect(s.events.filter((e) => e.undoneAt).map((e) => e.stageCode)).toEqual(["CONTACTED", "QUALIFIED", "PROPOSAL"]);
    expect(s.outbox.filter((o) => o.status === "skipped")).toHaveLength(6);
    expect(s.outbox.filter((o) => o.status === "pending")).toHaveLength(2);
    expect(h.events.published).toEqual([expect.objectContaining({ type: "LeadStageChangeUndone", revertedTo: "NEW" })]);
  });

  it("süre dolunca ve ikinci kez geri al reddedilir", async () => {
    h.clock.advance(11 * MINUTE);
    const late = await sp.undoStageChange.execute({ leadId, actor: REP });
    expect(!late.ok && late.error.code).toBe("undo.expired");
    h.clock.set("2026-03-01T10:01:00Z");
    unwrap(await sp.undoStageChange.execute({ leadId, actor: REP }));
    const again = await sp.undoStageChange.execute({ leadId, actor: REP });
    expect(!again.ok && again.error.code).toBe("undo.nothing");
  });

  it("geri aldıktan sonra yeniden ileri gidilebilir, sıra devam eder", async () => {
    unwrap(await sp.undoStageChange.execute({ leadId, actor: REP }));
    const r = unwrap(await sp.changeLeadStage.execute({ leadId, target: "CONTACTED", actor: REP }));
    expect(r.events[0]?.sequence).toBe(5);
    const detail = unwrap(await sp.queries.get(leadId, REP));
    expect(detail.lead.currentStage).toBe("CONTACTED");
  });
});

describe("AssignLead", () => {
  it("satışçı üstlenir ve bırakır ama devredemez; admin her şeyi yapar", async () => {
    const pool = unwrap(await manual({ assignedUserId: null })).lead;
    const taken = unwrap(await sp.assignLead.execute({ leadId: pool.id, toUserId: "rep-1", actor: REP }));
    expect(taken.assignedUserId).toBe("rep-1");
    const handover = await sp.assignLead.execute({ leadId: pool.id, toUserId: "rep-2", actor: REP });
    expect(!handover.ok && handover.error.code).toBe("assign.forbidden");
    expect(
      unwrap(await sp.assignLead.execute({ leadId: pool.id, toUserId: null, actor: REP })).assignedUserId,
    ).toBeNull();
    expect(
      unwrap(await sp.assignLead.execute({ leadId: pool.id, toUserId: "rep-2", actor: ADMIN })).assignedUserId,
    ).toBe("rep-2");
    const notMine = await sp.assignLead.execute({ leadId: pool.id, toUserId: null, actor: REP });
    expect(!notMine.ok && notMine.error.code).toBe("lead.forbidden");
    expect(
      h.events.published.filter((e) => e.type === "LeadAssigned").map((e) => (e as { to: string | null }).to),
    ).toEqual(["rep-1", null, "rep-2"]);
  });
});

describe("LeadQueries", () => {
  it("görünürlük: kendi + bölgesindeki havuz; admin hepsi; detay izinli geçişleri ve geri al durumunu verir", async () => {
    h.uow.state.territories.push({ countryCode: "GB", assignedUserId: "rep-2", fallbackUserId: null });
    const mine = unwrap(await manual()).lead;
    const poolTr = unwrap(await manual({ assignedUserId: null, email: "p1@a.com", phone: "", country: "TR" })).lead;
    const poolGb = unwrap(await manual({ assignedUserId: null, email: "p2@a.com", phone: "", country: "GB" })).lead;
    const theirs = unwrap(await manual({ assignedUserId: "rep-2", email: "p3@a.com", phone: "" })).lead;
    unwrap(await manual({ isTest: true, email: "t@a.com", phone: "" }));

    const rep1 = (await sp.queries.list({ actor: REP })).map((l) => l.id);
    expect(rep1).toEqual(expect.arrayContaining([mine.id, poolTr.id, poolGb.id]));
    expect(rep1).not.toContain(theirs.id);
    const rep2 = (await sp.queries.list({ actor: REP2 })).map((l) => l.id);
    expect(rep2).toEqual(expect.arrayContaining([theirs.id, poolGb.id]));
    expect(rep2).not.toContain(poolTr.id);
    expect(await sp.queries.list({ actor: ADMIN })).toHaveLength(4);
    expect(await sp.queries.list({ actor: ADMIN, includeTest: true })).toHaveLength(5);
    expect((await sp.queries.list({ actor: ADMIN, search: "p3@" })).map((l) => l.id)).toEqual([theirs.id]);

    const d = unwrap(await sp.queries.get(mine.id, REP));
    expect(d.allowedTransitions).toEqual(["CONTACTED", "QUALIFIED", "PROPOSAL", "WON", "LOST"]);
    expect(d.undo).toEqual({ available: false, reason: "undo.nothing" });
    unwrap(await sp.changeLeadStage.execute({ leadId: mine.id, target: "CONTACTED", actor: REP }));
    const d2 = unwrap(await sp.queries.get(mine.id, REP));
    expect(d2.undo).toEqual({ available: true, untilIso: "2026-03-01T10:10:00.000Z" });
    const hidden = await sp.queries.get(theirs.id, REP);
    expect(!hidden.ok && hidden.error.code).toBe("not_found");
  });
});
