/**
 * Entegrasyon testleri: gerçek Postgres motoru (PGlite, bellekte) + gerçek migration'lar.
 * Kabul kriteri: aşama değişikliği → olay + outbox satırı aynı transaction'da; hata olunca hiçbiri yazılmıyor.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPgliteDb, migrate, MIGRATIONS_DIR, readMigrations, type Db } from "../../shared/db";
import { FixedClock, MINUTE, silentLogger, unwrap, uuidGenerator } from "../../shared/kernel";
import { createSalesPipeline, type SalesPipeline } from "../application";
import { RecordingPublisher, StaticPlatforms } from "../application/fakes";
import { readLostReasons, readStageDefinitions } from "./referenceData";
import { PgUnitOfWork } from "./unitOfWork";

const REP = { userId: "rep-1", isAdmin: false };
const ADMIN = { userId: "admin", isAdmin: true };
const YES = { budget_approved: true, site_known: true, install_within_12m: true };

let db: Db;
let clock: FixedClock;
let publisher: RecordingPublisher;
let sp: SalesPipeline;

const count = async (table: string, where = "true") =>
  Number((await db.query<{ n: string }>(`SELECT count(*)::int AS n FROM ${table} WHERE ${where}`))[0]?.n ?? 0);

beforeAll(async () => {
  db = await createPgliteDb();
  await migrate(db, readMigrations(MIGRATIONS_DIR));
});
afterAll(() => db.close());

beforeEach(async () => {
  await db.exec(
    "TRUNCATE user_notifications, inbound_webhook_events, outbound_conversion_events, lead_stage_events, lead_consents, lead_attribution, leads, persons, territory_rules",
  );
  clock = new FixedClock("2026-03-01T10:00:00Z");
  publisher = new RecordingPublisher();
  sp = createSalesPipeline({
    uow: new PgUnitOfWork(db, uuidGenerator),
    clock,
    ids: uuidGenerator,
    platforms: new StaticPlatforms(["fakeA", "fakeB"]),
    events: publisher,
    logger: silentLogger,
    undoWindowMs: 10 * MINUTE,
  });
});

const manual = (over: Record<string, unknown> = {}) =>
  sp.createLead.execute({
    source: "manual",
    fullName: "Ayşe Demir",
    email: "ayse@example.com",
    phone: "+90 532 123 45 67",
    country: "TR",
    actor: REP,
    ...over,
  });

describe("Postgres repository'leri + transaction", () => {
  it("manuel lead: persons, leads, NEW olayı ve outbox satırları yazılır; yeniden okunan lead aynı", async () => {
    const r = unwrap(await manual({ city: "İzmir", notes: "fuar", extraAnswers: { court_count: "2" } }));
    expect(await count("persons")).toBe(1);
    expect(await count("leads")).toBe(1);
    expect(await count("lead_stage_events")).toBe(1);
    expect(await count("outbound_conversion_events")).toBe(2);
    const detail = unwrap(await sp.queries.get(r.lead.id, REP));
    expect(detail.lead).toEqual(r.lead);
    expect(detail.events[0]).toMatchObject({
      stageCode: "NEW",
      origin: "system",
      sequence: 1,
      actorUserId: "rep-1",
      undoneAt: null,
    });
    expect(detail.allowedTransitions).toEqual(["CONTACTED", "QUALIFIED", "PROPOSAL", "WON", "LOST"]);
  });

  it("mükerrer kişi e-posta/telefonla eşleşir; platform kimliği UNIQUE", async () => {
    const a = unwrap(await manual());
    const b = unwrap(await manual({ email: "", phone: "0532 123 45 67", fullName: "A. Demir" }));
    expect(b.personMatched).toBe(true);
    expect(b.lead.personId).toBe(a.lead.personId);
    const m1 = unwrap(
      await manual({
        source: "meta_form",
        platformLeadId: "12345678901234567",
        email: "m@x.com",
        phone: "",
        actor: null,
      }),
    );
    const m2 = unwrap(
      await manual({
        source: "meta_form",
        platformLeadId: "12345678901234567",
        email: "m@x.com",
        phone: "",
        actor: null,
      }),
    );
    expect(m2.created).toBe(false);
    expect(m2.lead.id).toBe(m1.lead.id);
    expect(await count("leads")).toBe(3);
  });

  it("aşama değişikliği: olaylar, outbox ve current_stage tek transaction'da; dağıtım 10 dk sonra", async () => {
    const lead = unwrap(await manual()).lead;
    clock.advance(3 * MINUTE);
    const r = unwrap(await sp.changeLeadStage.execute({ leadId: lead.id, target: "PROPOSAL", actor: REP }));
    expect(r.events.map((e) => [e.stageCode, e.origin, e.sequence])).toEqual([
      ["CONTACTED", "auto_fill", 2],
      ["QUALIFIED", "auto_fill", 3],
      ["PROPOSAL", "manual", 4],
    ]);
    expect(
      (await db.query<{ current_stage: string }>("SELECT current_stage FROM leads WHERE id = $1", [lead.id]))[0]
        ?.current_stage,
    ).toBe("PROPOSAL");
    expect(await count("lead_stage_events", `lead_id = '${lead.id}'`)).toBe(4);
    const outbox = await db.query<{ status: string; next_attempt_at: Date }>(
      "SELECT status, next_attempt_at FROM outbound_conversion_events ORDER BY created_at",
    );
    expect(outbox).toHaveLength(8);
    expect(outbox.every((o) => o.status === "pending")).toBe(true);
    expect(new Date(outbox[7]!.next_attempt_at).toISOString()).toBe("2026-03-01T10:13:00.000Z");
  });

  it("hata olunca hiçbiri yazılmaz: üçüncü olay yazılırken DB hatası → önceki olaylar, outbox ve aşama geri alınır", async () => {
    const lead = unwrap(await manual()).lead;
    // Gerçek veritabanı hatası: PROPOSAL olayı eklenirken trigger fırlatır. CONTACTED ve QUALIFIED
    // (auto_fill) olayları ile outbox satırları o ana kadar aynı transaction'da yazılmış olur.
    await db.exec(`
      CREATE FUNCTION test_fail_on_proposal() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'test: PROPOSAL yazılamadı'; END $$ LANGUAGE plpgsql;
      CREATE TRIGGER test_fail BEFORE INSERT ON lead_stage_events FOR EACH ROW
        WHEN (NEW.stage_code = 'PROPOSAL') EXECUTE FUNCTION test_fail_on_proposal();`);
    const eventsBefore = await count("lead_stage_events");
    const outboxBefore = await count("outbound_conversion_events");
    try {
      await expect(sp.changeLeadStage.execute({ leadId: lead.id, target: "PROPOSAL", actor: REP })).rejects.toThrow(
        /PROPOSAL yazılamadı/,
      );
    } finally {
      await db.exec("DROP TRIGGER test_fail ON lead_stage_events; DROP FUNCTION test_fail_on_proposal();");
    }
    expect(await count("lead_stage_events")).toBe(eventsBefore);
    expect(await count("outbound_conversion_events")).toBe(outboxBefore);
    expect(
      (await db.query<{ current_stage: string }>("SELECT current_stage FROM leads WHERE id = $1", [lead.id]))[0]
        ?.current_stage,
    ).toBe("NEW");
    expect(publisher.published.filter((e) => e.type === "LeadStageChanged")).toHaveLength(0);
  });

  it("geri al: olaylar undone_at alır (silinmez), outbox skipped, aşama geri döner; sonra ileri devam", async () => {
    const lead = unwrap(await manual()).lead;
    unwrap(
      await sp.changeLeadStage.execute({ leadId: lead.id, target: "QUALIFIED", actor: REP, qualificationAnswers: YES }),
    );
    clock.advance(9 * MINUTE);
    const u = unwrap(await sp.undoStageChange.execute({ leadId: lead.id, actor: REP }));
    expect(u.revertedTo).toBe("NEW");
    expect(await count("lead_stage_events")).toBe(3);
    expect(await count("lead_stage_events", "undone_at IS NOT NULL")).toBe(2);
    expect(await count("outbound_conversion_events", "status = 'skipped' AND skip_reason = 'undone'")).toBe(4);
    expect(await count("outbound_conversion_events", "status = 'pending'")).toBe(2);
    const again = await sp.undoStageChange.execute({ leadId: lead.id, actor: REP });
    expect(!again.ok && again.error.code).toBe("undo.nothing");
    const r = unwrap(
      await sp.changeLeadStage.execute({
        leadId: lead.id,
        target: "WON",
        actor: REP,
        value: { amount: 120000.5, currency: "EUR" },
      }),
    );
    expect(r.events.map((e) => e.sequence)).toEqual([4, 5, 6, 7]);
    const detail = unwrap(await sp.queries.get(lead.id, REP));
    expect(detail.lead.currentStage).toBe("WON");
    expect(detail.events.at(-1)?.value).toEqual({ amount: 120000.5, currency: "EUR" });
    expect(detail.allowedTransitions).toEqual([]);
  });

  it("LOST neden listeden okunur; kayıt lost_reason_code taşır", async () => {
    const lead = unwrap(await manual()).lead;
    const bad = await sp.changeLeadStage.execute({
      leadId: lead.id,
      target: "LOST",
      actor: REP,
      lostReasonCode: "mars",
    });
    expect(!bad.ok && bad.error.code).toBe("stage.reason_unknown");
    unwrap(
      await sp.changeLeadStage.execute({ leadId: lead.id, target: "LOST", actor: REP, lostReasonCode: "competitor" }),
    );
    const detail = unwrap(await sp.queries.get(lead.id, REP));
    expect(detail.events.at(-1)).toMatchObject({ stageCode: "LOST", lostReasonCode: "competitor" });
    expect(detail.events).toHaveLength(2);
  });

  it("liste ve görünürlük: ülke kuralı, havuz, arama, test lead'i", async () => {
    await db.query("INSERT INTO territory_rules (country_code, assigned_user_id) VALUES ('GB', 'rep-2')");
    const mine = unwrap(await manual()).lead;
    const poolTr = unwrap(await manual({ assignedUserId: null, email: "p1@a.com", phone: "", country: "TR" })).lead;
    const poolGb = unwrap(await manual({ assignedUserId: null, email: "p2@a.com", phone: "", country: "GB" })).lead;
    const theirs = unwrap(await manual({ assignedUserId: "rep-2", email: "p3@a.com", phone: "" })).lead;
    unwrap(await manual({ isTest: true, email: "t@a.com", phone: "" }));

    const ids = async (actor: typeof REP, extra: Record<string, unknown> = {}) =>
      (await sp.queries.list({ actor, ...extra })).map((l) => l.id).sort();
    expect(await ids(REP)).toEqual([mine.id, poolGb.id, poolTr.id].sort());
    expect(await ids({ userId: "rep-2", isAdmin: false })).toEqual([poolGb.id, theirs.id].sort());
    expect(await ids(ADMIN)).toHaveLength(4);
    expect(await ids(ADMIN, { includeTest: true })).toHaveLength(5);
    expect(await ids(ADMIN, { search: "P3@" })).toEqual([theirs.id]);
    expect(await ids(ADMIN, { stage: "NEW", limit: 2 })).toHaveLength(2);
    const hidden = await sp.queries.get(theirs.id, REP);
    expect(!hidden.ok && hidden.error.code).toBe("not_found");
    const auto = unwrap(await manual({ actor: null, country: "GB", email: "auto@a.com", phone: "" })).lead;
    expect(auto.assignedUserId).toBe("rep-2");
  });

  it("attribution: lead_attribution satırı lead ile aynı transaction'da; yeniden okunur", async () => {
    const lead = unwrap(
      await manual({
        source: "google_form",
        platformLeadId: "g-77",
        attribution: { gclid: "Cj0KCQ-test", clickAt: new Date("2026-02-28T09:00:00Z") },
      }),
    ).lead;
    expect(await count("lead_attribution", `lead_id = '${lead.id}'`)).toBe(1);
    const read = await sp.queries.attribution(lead.id);
    expect(read).toMatchObject({ gclid: "Cj0KCQ-test", fbclid: null, clickAt: new Date("2026-02-28T09:00:00Z") });
    const plain = unwrap(await manual({ email: "noattr@a.com", phone: "" })).lead;
    expect(await count("lead_attribution", `lead_id = '${plain.id}'`)).toBe(0);
  });

  it("referans veri: aşama sözlüğü ve kayıp nedenleri TR/EN", async () => {
    const stages = await readStageDefinitions(db);
    expect(stages.map((s) => s.code)).toEqual(["NEW", "CONTACTED", "QUALIFIED", "PROPOSAL", "WON", "LOST"]);
    expect(stages[4]).toMatchObject({ nameTr: "Kazanıldı", nameEn: "Won", isTerminal: true, requiresValue: true });
    const reasons = await readLostReasons(db);
    expect(reasons.map((r) => r.code)).toContain("unqualified");
  });
});
