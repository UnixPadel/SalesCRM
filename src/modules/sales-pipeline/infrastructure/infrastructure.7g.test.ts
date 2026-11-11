/**
 * Faz 7g (S1) Postgres gidiş-dönüşü (PGlite): yeni lead sütunları (ürünler numeric, form cevapları, uyarı listesi),
 * DB CHECK listeleri = domain kod listeleri, aktivite temas sütunları, `contact_logs` deposu ve iki yönlü yabancı
 * anahtar bağları, çoklu değerli `list` süzgeci. Sahte depo aynı senaryolarda Postgres'le karşılaştırılır. Sentetik veri.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPgliteDb, migrate, MIGRATIONS_DIR, readMigrations, type Db } from "../../shared/db";
import { uuidGenerator } from "../../shared/kernel";
import { InMemoryUnitOfWork } from "../application/fakes";
import {
  ACTIVITY_OUTCOMES,
  ACTIVITY_TYPES,
  COURT_COUNT_BANDS,
  CUSTOMER_PROFILES,
  CUSTOMER_STATUSES,
  EMPTY_CAMPAIGN,
  INSTALL_SITES,
  INSTALL_TIMELINES,
  NO_CONTACT_FIELDS,
  emptyTrackingFields,
  type Activity,
  type ContactLog,
  type Lead,
  type LeadListFilter,
  type Repositories,
  type UnitOfWork,
} from "../domain";
import { PgUnitOfWork } from "./unitOfWork";

let db: Db;
let uow: PgUnitOfWork;
const T0 = new Date("2026-11-01T09:00:00Z");

beforeAll(async () => {
  db = await createPgliteDb();
  await migrate(db, readMigrations(MIGRATIONS_DIR));
  uow = new PgUnitOfWork(db, uuidGenerator);
});
afterAll(() => db.close());
beforeEach(async () => {
  await db.exec("TRUNCATE contact_logs, activities, lead_stage_events, leads, persons CASCADE");
});

const personId = async (r: Repositories, n: number) => {
  const id = uuidGenerator.next();
  await r.persons.insert({
    id,
    fullName: `Kişi ${n}`,
    emailNormalized: `k${n}@example.test`,
    phoneE164: null,
    country: null,
    company: "",
    organizationId: null,
    mergedIntoId: null,
    createdAt: T0,
  });
  return id;
};

const baseLead = (id: string, person: string, over: Partial<Lead> = {}): Lead => ({
  id,
  source: "manual",
  platformLeadId: null,
  formId: null,
  personId: person,
  fullName: "Test Lead",
  email: null,
  phoneE164: null,
  country: "TR",
  city: "",
  company: "",
  productInterest: "",
  campaign: { ...EMPTY_CAMPAIGN },
  assignedUserId: null,
  currentStage: "NEW",
  isTest: false,
  notes: "",
  extraAnswers: {},
  courtCount: null,
  courtModel: "",
  expectedCloseDate: null,
  organizationId: null,
  ...emptyTrackingFields(),
  createdAt: T0,
  updatedAt: T0,
  ...over,
});

const activity = (leadId: string, over: Partial<Activity> = {}): Activity => ({
  id: uuidGenerator.next(),
  leadId,
  type: "call",
  subject: "Arama",
  dueAt: T0,
  doneAt: null,
  notes: "",
  autoCreated: false,
  createdByChangeId: null,
  createdByUserId: "rep-1",
  legacyId: null,
  ...NO_CONTACT_FIELDS,
  createdAt: T0,
  updatedAt: T0,
  ...over,
});

describe("Faz 7g: lead satış takip sütunları", () => {
  it("ürünler (numeric ölçü sayı olarak), form cevapları, reklam yüzeyi, uyarı listesi gidiş-dönüş", async () => {
    const lead = await uow.run(async (r) => {
      const l = baseLead(uuidGenerator.next(), await personId(r, 1), {
        customerStatus: "collecting_prices",
        products: {
          standard: 2,
          panoramic: null,
          fullPanoramic: 29,
          roof: { wanted: true, widthM: 10.5, lengthM: 20 },
        },
        installSite: "covered_court",
        installTimeline: "m0_3",
        customerProfile: "club_operator",
        courtCountBand: "2_3",
        adSurface: "ig",
        checkedWarnings: ["phone_invalid", "import_review"],
        contactHistoryUnknown: true,
      });
      await r.leads.insert(l);
      return l;
    });
    const back = await uow.run((r) => r.leads.findById(lead.id));
    expect(back).toEqual(lead);
    expect(typeof back!.products.roof.widthM).toBe("number");
    expect(typeof back!.products.standard).toBe("number");
  });

  it("boş alanlar: tercih yok, Kapatma yok, uyarı listesi boş dizi", async () => {
    const lead = await uow.run(async (r) => {
      const l = baseLead(uuidGenerator.next(), await personId(r, 2));
      await r.leads.insert(l);
      return l;
    });
    const back = (await uow.run((r) => r.leads.findById(lead.id)))!;
    expect(back.products).toEqual({
      standard: null,
      panoramic: null,
      fullPanoramic: null,
      roof: { wanted: false, widthM: null, lengthM: null },
    });
    expect(back).toMatchObject({
      customerStatus: null,
      installSite: null,
      installTimeline: null,
      customerProfile: null,
      courtCountBand: null,
      adSurface: null,
      checkedWarnings: [],
      contactHistoryUnknown: false,
    });
  });

  it("DB CHECK listeleri domain kod listeleriyle aynı: her kod yazılır ve okunur", async () => {
    // En uzun liste kadar lead; i. lead her listenin (i mod uzunluk). kodunu alır, böylece her kod en az bir kez denenir.
    const n = Math.max(
      CUSTOMER_STATUSES.length,
      INSTALL_SITES.length,
      INSTALL_TIMELINES.length,
      CUSTOMER_PROFILES.length,
      COURT_COUNT_BANDS.length,
      ACTIVITY_TYPES.length,
      ACTIVITY_OUTCOMES.length,
    );
    const pick = <T>(list: readonly T[], i: number): T => list[i % list.length]!;
    const written = await uow.run(async (r) => {
      const leads: Lead[] = [];
      const acts: Activity[] = [];
      for (let i = 0; i < n; i++) {
        const l = baseLead(uuidGenerator.next(), await personId(r, 100 + i), {
          customerStatus: pick(CUSTOMER_STATUSES, i),
          installSite: pick(INSTALL_SITES, i),
          installTimeline: pick(INSTALL_TIMELINES, i),
          customerProfile: pick(CUSTOMER_PROFILES, i),
          courtCountBand: pick(COURT_COUNT_BANDS, i),
        });
        await r.leads.insert(l);
        leads.push(l);
        const a = activity(l.id, { type: pick(ACTIVITY_TYPES, i), doneAt: T0, outcome: pick(ACTIVITY_OUTCOMES, i) });
        await r.activities.insert(a);
        acts.push(a);
      }
      return { leads, acts };
    });
    for (const l of written.leads) expect(await uow.run((r) => r.leads.findById(l.id))).toEqual(l);
    for (const a of written.acts) expect(await uow.run((r) => r.activities.findById(a.id))).toEqual(a);
  });

  it("DB kısıtı: Kapatma işaretsiz ölçü ve aralık dışı adet reddedilir", async () => {
    await expect(
      uow.run(async (r) =>
        r.leads.insert(
          baseLead(uuidGenerator.next(), await personId(r, 3), {
            products: {
              standard: null,
              panoramic: null,
              fullPanoramic: null,
              roof: { wanted: false, widthM: 5, lengthM: null },
            },
          }),
        ),
      ),
    ).rejects.toThrow(/leads_roof_dims_need_roof/);
    await expect(
      uow.run(async (r) =>
        r.leads.insert(
          baseLead(uuidGenerator.next(), await personId(r, 4), {
            products: {
              standard: 30,
              panoramic: null,
              fullPanoramic: null,
              roof: { wanted: false, widthM: null, lengthM: null },
            },
          }),
        ),
      ),
    ).rejects.toThrow(/leads_qty_standard_check/);
  });
});

describe("Faz 7g: aktivite temas sütunları ve contact_logs", () => {
  it("temas alanları yazılır ve okunur; whatsapp türü", async () => {
    const { lead, done, next, log } = await uow.run(async (r) => {
      const l = baseLead(uuidGenerator.next(), await personId(r, 5));
      await r.leads.insert(l);
      const log: ContactLog = {
        id: uuidGenerator.next(),
        leadId: l.id,
        actorUserId: "rep-1",
        createdAt: T0,
        completedActivityId: null,
        prevType: null,
        prevSubject: null,
        statusChanged: false,
        statusBefore: null,
        statusAfter: null,
        stageChangeId: null,
        assignedOnLog: false,
      };
      await r.contactLogs.insert(log);
      const done = activity(l.id, {
        type: "whatsapp",
        subject: "WhatsApp",
        doneAt: T0,
        outcome: "follow_up",
        customerReplied: true,
        resultNote: "Fiyat listesi istedi.",
        doneByUserId: "rep-1",
        dateEstimated: true,
        logId: log.id,
      });
      const next = activity(l.id, { type: "whatsapp", subject: "WhatsApp takibi", nextOfLogId: log.id });
      await r.activities.insert(done);
      await r.activities.insert(next);
      return { lead: l, done, next, log };
    });
    expect(await uow.run((r) => r.activities.findById(done.id))).toEqual(done);
    expect(await uow.run((r) => r.activities.findById(next.id))).toEqual(next);
    expect(await uow.run((r) => r.contactLogs.findById(log.id))).toEqual(log);
    expect((await uow.run((r) => r.activities.listByLead(lead.id))).map((a) => a.id).sort()).toEqual(
      [done.id, next.id].sort(),
    );
  });

  it("contact_logs: tüm alanlar gidiş-dönüş; silinince bağlı aktivitelerin bağı NULL olur", async () => {
    const { log, completed, added, next } = await uow.run(async (r) => {
      const l = baseLead(uuidGenerator.next(), await personId(r, 6), { customerStatus: "interested" });
      await r.leads.insert(l);
      const completed = activity(l.id, { type: "email", subject: "E-posta takibi" });
      await r.activities.insert(completed);
      const log: ContactLog = {
        id: uuidGenerator.next(),
        leadId: l.id,
        actorUserId: "rep-2",
        createdAt: new Date("2026-11-02T10:15:00Z"),
        completedActivityId: completed.id,
        prevType: "call",
        prevSubject: "Takip araması",
        statusChanged: true,
        statusBefore: null,
        statusAfter: "interested",
        stageChangeId: uuidGenerator.next(),
        assignedOnLog: true,
      };
      await r.contactLogs.insert(log);
      const added = activity(l.id, {
        type: "other",
        subject: "Temas",
        doneAt: T0,
        outcome: "reply_received",
        logId: log.id,
      });
      await r.activities.insert(added);
      const next = activity(l.id, { type: "email", subject: "E-posta takibi", nextOfLogId: log.id });
      await r.activities.insert(next);
      return { log, completed, added, next };
    });
    // Tamamlanan planın bağı (S3'te `complete` yazar; döngüsel FK yüzünden ekleme sonrası).
    await db.query("UPDATE activities SET log_id = $1 WHERE id = $2", [log.id, completed.id]);
    expect((await uow.run((r) => r.activities.findById(completed.id)))!.logId).toBe(log.id);
    expect(await uow.run((r) => r.contactLogs.findById(log.id))).toEqual(log);

    await uow.run((r) => r.contactLogs.remove(log.id));
    expect(await uow.run((r) => r.contactLogs.findById(log.id))).toBeUndefined();
    expect((await uow.run((r) => r.activities.findById(added.id)))!.logId).toBeNull();
    expect((await uow.run((r) => r.activities.findById(completed.id)))!.logId).toBeNull();
    expect((await uow.run((r) => r.activities.findById(next.id)))!.nextOfLogId).toBeNull();
  });

  it("yabancı anahtar bağları iki yönde de düşer (Postgres = bellek içi sahte)", async () => {
    // Plan ve otomatik takip silinince kaydın `completedActivityId`'si, kayıt silinince aktivitelerin bağları NULL olur.
    const scenario = async (target: UnitOfWork) => {
      const ids = await target.run(async (r) => {
        const l = baseLead(uuidGenerator.next(), await personId(r, 8));
        await r.leads.insert(l);
        const changeId = uuidGenerator.next();
        const plan = activity(l.id);
        const auto = activity(l.id, { autoCreated: true, createdByChangeId: changeId, subject: "Teklif takibi" });
        await r.activities.insert(plan);
        await r.activities.insert(auto);
        const log = (id: string, completedActivityId: string): ContactLog => ({
          id,
          leadId: l.id,
          actorUserId: "rep-1",
          createdAt: T0,
          completedActivityId,
          prevType: "call",
          prevSubject: "Arama",
          statusChanged: false,
          statusBefore: null,
          statusAfter: null,
          stageChangeId: null,
          assignedOnLog: false,
        });
        const logPlan = log(uuidGenerator.next(), plan.id);
        const logAuto = log(uuidGenerator.next(), auto.id);
        await r.contactLogs.insert(logPlan);
        await r.contactLogs.insert(logAuto);
        const done = activity(l.id, { doneAt: T0, outcome: "awaiting_reply", logId: logPlan.id });
        const next = activity(l.id, { nextOfLogId: logPlan.id });
        await r.activities.insert(done);
        await r.activities.insert(next);
        return { changeId, plan: plan.id, logPlan: logPlan.id, logAuto: logAuto.id, done: done.id, next: next.id };
      });
      await target.run((r) => r.activities.remove(ids.plan));
      const removedAuto = await target.run((r) => r.activities.removeAutoCreatedByChange(ids.changeId));
      const afterActivityDelete = await target.run(async (r) => ({
        logPlan: (await r.contactLogs.findById(ids.logPlan))?.completedActivityId,
        logAuto: (await r.contactLogs.findById(ids.logAuto))?.completedActivityId,
      }));
      await target.run((r) => r.contactLogs.remove(ids.logPlan));
      const afterLogDelete = await target.run(async (r) => ({
        doneLogId: (await r.activities.findById(ids.done))?.logId,
        nextOfLogId: (await r.activities.findById(ids.next))?.nextOfLogId,
        logAutoKept: (await r.contactLogs.findById(ids.logAuto)) !== undefined,
      }));
      return { removedAuto, afterActivityDelete, afterLogDelete };
    };
    const expected = {
      removedAuto: 1,
      afterActivityDelete: { logPlan: null, logAuto: null },
      afterLogDelete: { doneLogId: null, nextOfLogId: null, logAutoKept: true },
    };
    expect(await scenario(uow)).toEqual(expected);
    expect(await scenario(new InMemoryUnitOfWork())).toEqual(expected);
  });

  it("transaction: kayıt yazımı hata verirse contact_logs satırı kalmaz", async () => {
    const leadId = await uow.run(async (r) => {
      const l = baseLead(uuidGenerator.next(), await personId(r, 7));
      await r.leads.insert(l);
      return l.id;
    });
    const logId = uuidGenerator.next();
    await expect(
      uow.run(async (r) => {
        await r.contactLogs.insert({
          id: logId,
          leadId,
          actorUserId: "rep-1",
          createdAt: T0,
          completedActivityId: null,
          prevType: null,
          prevSubject: null,
          statusChanged: false,
          statusBefore: null,
          statusAfter: null,
          stageChangeId: null,
          assignedOnLog: false,
        });
        // Sonuç tamamlanmamış satırda → activities_outcome_done
        await r.activities.insert(activity(leadId, { outcome: "awaiting_reply", logId }));
      }),
    ).rejects.toThrow(/activities_outcome_done/);
    expect(await uow.run((r) => r.contactLogs.findById(logId))).toBeUndefined();
  });
});

describe("Faz 7g: çoklu değerli list süzgeci (Postgres = bellek içi sahte)", () => {
  const seed = async (target: UnitOfWork) =>
    target.run(async (r) => {
      const rows: [string, Partial<Lead>][] = [
        ["a", { assignedUserId: "rep-1", country: "TR", source: "meta_form", currentStage: "NEW" }],
        ["b", { assignedUserId: "rep-2", country: "DE", source: "manual", currentStage: "CONTACTED" }],
        ["c", { assignedUserId: null, country: "FR", source: "import", currentStage: "PROPOSAL" }],
        ["d", { assignedUserId: null, country: null, source: "web_form", currentStage: "NEW" }],
        ["e", { assignedUserId: "rep-3", country: "TR", source: "import", currentStage: "WON" }],
      ];
      const ids: Record<string, string> = {};
      let n = 10;
      for (const [name, over] of rows) {
        const id = uuidGenerator.next();
        ids[name] = id;
        await r.leads.insert(
          baseLead(id, await personId(r, n++), {
            ...over,
            fullName: `Lead ${name}`,
            createdAt: new Date(T0.getTime() + n * 60_000),
          }),
        );
      }
      return ids;
    });

  const cases: [string, LeadListFilter, string[]][] = [
    ["tek sorumlu", { owner: "rep-1" }, ["a"]],
    ["havuz", { owner: null }, ["c", "d"]],
    ["sorumlu listesi + havuz", { owner: ["rep-2", null] }, ["b", "c", "d"]],
    ["sorumlu listesi", { owner: ["rep-1", "rep-3"] }, ["a", "e"]],
    ["boş liste = süzgeç yok", { owner: [] }, ["a", "b", "c", "d", "e"]],
    ["ülke listesi (küçük harf)", { country: ["tr", "FR"] }, ["a", "c", "e"]],
    ["tek ülke", { country: "DE" }, ["b"]],
    ["kaynak listesi", { source: ["import", "web_form"] }, ["c", "d", "e"]],
    ["aşama listesi", { stage: ["NEW", "WON"] }, ["a", "d", "e"]],
    ["tek aşama", { stage: "PROPOSAL" }, ["c"]],
    ["birleşik", { owner: ["rep-1", null], country: ["TR", "FR"], stage: ["NEW", "PROPOSAL"] }, ["a", "c"]],
  ];

  it("Postgres ve sahte depo aynı sonucu verir; visibleTo değişmedi", async () => {
    const pgIds = await seed(uow);
    const mem = new InMemoryUnitOfWork();
    const memIds = await seed(mem);
    const names = (ids: Record<string, string>, leads: Lead[]) =>
      leads.map((l) => Object.keys(ids).find((k) => ids[k] === l.id)!).sort();
    for (const [label, filter, expected] of cases) {
      const pg = names(pgIds, await uow.run((r) => r.leads.list(filter)));
      const fake = names(memIds, await mem.run((r) => r.leads.list(filter)));
      expect(pg, label).toEqual(expected);
      expect(fake, label).toEqual(expected);
    }
    // Görünürlük süzgeci bugünkü gibi: kendi + bütün havuz (kural yokken).
    const visible = { visibleTo: { userId: "rep-1", countries: [] as string[] } };
    expect(names(pgIds, await uow.run((r) => r.leads.list(visible)))).toEqual(["a", "c", "d"]);
    expect(names(memIds, await mem.run((r) => r.leads.list(visible)))).toEqual(["a", "c", "d"]);
  });
});
