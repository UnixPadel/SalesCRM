/**
 * Faz 7g (S3–S5) Postgres yolu (PGlite): temas kaydı → geri al uçtan uca, temas toplamı SQL = domain
 * (`aggregateContacts`), Temas geçmişi anahtar kümesi, yeni lead süzgeçleri, ürün alanlarının yazılması. Sentetik veri.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPgliteDb, migrate, MIGRATIONS_DIR, readMigrations, type Db } from "../../shared/db";
import { FixedClock, silentLogger, unwrap, uuidGenerator } from "../../shared/kernel";
import { createSalesPipeline, type SalesPipeline } from "../application";
import { aggregateContacts } from "../domain";
import { PgUnitOfWork } from "./unitOfWork";

const ADMIN = { userId: "admin", isAdmin: true };
const REP = { userId: "rep-1", isAdmin: false };

let db: Db;
let uow: PgUnitOfWork;
let clock: FixedClock;
let sp: SalesPipeline;
let n = 0;

beforeAll(async () => {
  db = await createPgliteDb();
  await migrate(db, readMigrations(MIGRATIONS_DIR));
  uow = new PgUnitOfWork(db, uuidGenerator);
});
afterAll(() => db.close());
beforeEach(async () => {
  await db.exec(
    "TRUNCATE outbound_conversion_events, lead_stage_events, lead_consents, lead_attribution, contact_logs, activities, leads, persons CASCADE",
  );
  clock = new FixedClock("2026-11-10T10:00:00Z");
  sp = createSalesPipeline({
    uow,
    clock,
    ids: uuidGenerator,
    platforms: { enabledProviders: () => [] },
    events: { publish: async () => {} },
    logger: silentLogger,
    undoWindowMs: 10 * 60_000,
  });
});

const lead = async (over: Record<string, unknown> = {}) =>
  unwrap(
    await sp.createLead.execute({
      source: "manual",
      fullName: `PG Lead ${++n}`,
      email: `pg${n}@example.test`,
      country: "TR",
      actor: ADMIN,
      assignedUserId: "rep-1",
      ...over,
    }),
  ).lead;

describe("temas kaydı (Postgres)", () => {
  it("kaydet → geri al: aktivite, durum ve aşama başlangıca döner", async () => {
    const l = await lead();
    const plan = unwrap(
      await sp.addActivity.execute({
        leadId: l.id,
        type: "call",
        subject: "İlk arama",
        dueAt: new Date("2026-11-10T07:00:00Z"),
        actor: REP,
      }),
    );
    const r = unwrap(
      await sp.logContact.execute({
        leadId: l.id,
        actor: REP,
        activityId: plan.id,
        type: "whatsapp",
        outcome: "reply_received",
        customerStatus: "interested",
        stage: { target: "CONTACTED" },
        next: { type: "whatsapp", dueAt: new Date("2026-11-13T06:00:00Z") },
      }),
    );
    const detail = unwrap(await sp.queries.get(l.id, REP));
    expect(detail.lead).toMatchObject({ currentStage: "CONTACTED", customerStatus: "interested" });
    expect(detail.lead.contact).toMatchObject({ state: "contacted", replied: true, lastType: "whatsapp" });
    expect(detail.contactLogs.map((c) => c.id)).toEqual([r.logId]);
    expect(detail.undo.contactLogId).toBe(r.logId);

    unwrap(await sp.undoLogContact.execute({ logId: r.logId, actor: REP }));
    const back = unwrap(await sp.queries.get(l.id, REP));
    expect(back.lead).toMatchObject({ currentStage: "NEW", customerStatus: null });
    expect(back.activities).toHaveLength(1);
    expect(back.activities[0]).toMatchObject({ id: plan.id, type: "call", subject: "İlk arama", doneAt: null });
    expect(back.lead.contact.state).toBe("never");
  });

  it("SQL temas toplamı = aggregateContacts; geçmiş anahtar kümesi aynı zamanlı satırlarda kayıpsız", async () => {
    const a = await lead();
    const b = await lead();
    for (let i = 0; i < 5; i++) {
      unwrap(
        await sp.logContact.execute({
          leadId: a.id,
          actor: REP,
          type: "call",
          outcome: "follow_up",
          customerReplied: true,
        }),
      );
    }
    unwrap(await sp.logContact.execute({ leadId: b.id, actor: REP, type: "email", outcome: "awaiting_reply" }));
    const sql = await uow.run((r) => r.activities.contactAggregatesByLeads([a.id, b.id]));
    const all = await uow.run(async (r) => [
      ...(await r.activities.listByLead(a.id)),
      ...(await r.activities.listByLead(b.id)),
    ]);
    const key = (x: { leadId: string; type: string; outcome: string | null; n: number }) =>
      `${x.leadId}|${x.type}|${x.outcome}|${x.n}`;
    expect(sql.map(key).sort()).toEqual(aggregateContacts(all).map(key).sort());

    const seen: string[] = [];
    let before: string | undefined;
    for (let i = 0; i < 4; i++) {
      const page = unwrap(await sp.history.history({ actor: ADMIN, limit: 2, before }));
      seen.push(...page.items.map((x) => x.activity.id));
      if (!page.nextBefore) break;
      before = page.nextBefore;
    }
    expect(new Set(seen).size).toBe(6);
  });

  it("ürünler altı sütuna yazılır; scope ve campaign süzgeci SQL'de", async () => {
    const a = await lead({ extraAnswers: { excel_no: 4 }, campaign: { campaignName: "Bahar" } });
    await lead();
    unwrap(
      await sp.updateLeadFields.execute({
        leadId: a.id,
        fields: {
          products: { standard: 2, roof: { wanted: true, widthM: 10.25, lengthM: 20 } },
          installTimeline: "m0_3",
        },
        actor: ADMIN,
      }),
    );
    const got = await uow.run((r) => r.leads.findById(a.id));
    expect(got?.products).toEqual({
      standard: 2,
      panoramic: null,
      fullPanoramic: null,
      roof: { wanted: true, widthM: 10.25, lengthM: 20 },
    });
    expect((await sp.queries.list({ actor: ADMIN, scope: "excel" })).map((l) => l.id)).toEqual([a.id]);
    expect((await sp.queries.list({ actor: ADMIN, campaign: "Bahar" })).map((l) => l.id)).toEqual([a.id]);
    expect((await sp.queries.list({ actor: ADMIN, hot: true })).map((l) => l.id)).toEqual([a.id]);
    unwrap(await sp.checkWarning.execute({ leadId: a.id, code: "roof_size_missing", checked: true, actor: ADMIN }));
    await uow.run((r) => r.leads.mergeExtraAnswers(a.id, { excel_owner: "Enes" }, clock.now()));
    const after = await uow.run((r) => r.leads.findById(a.id));
    expect(after?.checkedWarnings).toEqual(["roof_size_missing"]);
    expect(after?.extraAnswers).toEqual({ excel_no: 4, excel_owner: "Enes" });
  });
});
