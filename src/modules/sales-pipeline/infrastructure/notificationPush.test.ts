import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPgliteDb, migrate, MIGRATIONS_DIR, readMigrations, type Db } from "../../shared/db";
import { pgNotificationStore } from "./notifications";
import { pgPushSubscriptionStore } from "./pushSubscriptions";
import { pgSweepSource } from "./sweepSource";

/** Migration 0023 (PGlite): bildirim tekilleştirme, push abonelikleri, zamanlı bildirim sorguları. */
let db: Db;
const NOW = new Date("2026-11-23T12:00:00Z");
const ago = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

async function lead(
  n: number,
  over: { owner?: string | null; stage?: string; hot?: boolean; test?: boolean; at?: Date },
) {
  await db.query("INSERT INTO persons (id) VALUES ($1)", [U(1000 + n)]);
  await db.query(
    `INSERT INTO leads (id, source, person_id, current_stage, assigned_user_id, full_name, company, country,
                        install_timeline, is_test, created_at)
     VALUES ($1,'manual',$2,$3,$4,$5,'Firma','TR',$6,$7,$8)`,
    [
      U(n),
      U(1000 + n),
      over.stage ?? "NEW",
      over.owner === undefined ? "12" : over.owner,
      `Lead ${n}`,
      over.hot === false ? null : "m0_3",
      over.test ?? false,
      over.at ?? ago(40),
    ],
  );
}

const activity = (id: number, leadN: number, dueAt: Date, doneAt: Date | null = null) =>
  db.query("INSERT INTO activities (id, lead_id, type, subject, due_at, done_at) VALUES ($1,$2,'call','Arama',$3,$4)", [
    U(id),
    U(leadN),
    dueAt,
    doneAt,
  ]);

beforeAll(async () => {
  db = await createPgliteDb();
  await migrate(db, readMigrations(MIGRATIONS_DIR));
});
afterAll(() => db.close());

describe("bildirim tekilleştirme", () => {
  it("aynı kişi + anahtar ikinci kez yazılmaz; başka kişi ve anahtarsız satır yazılır", async () => {
    const store = pgNotificationStore(db);
    const base = { type: "activity_due" as const, leadId: null, title: "İş", body: "{}", readAt: null, createdAt: NOW };
    expect(await store.insert({ ...base, id: U(1), userId: "12", dedupeKey: "k1" })).toBe(true);
    expect(await store.insert({ ...base, id: U(2), userId: "12", dedupeKey: "k1" })).toBe(false);
    expect(await store.insert({ ...base, id: U(3), userId: "13", dedupeKey: "k1" })).toBe(true);
    expect(await store.insert({ ...base, id: U(4), userId: "12" })).toBe(true);
    expect(await store.insert({ ...base, id: U(5), userId: "12" })).toBe(true);
    expect(await store.unreadCount("12")).toBe(3);
  });
});

describe("push abonelikleri", () => {
  it("aynı endpoint yeni sahibine geçer; silme sahibine özel", async () => {
    const store = pgPushSubscriptionStore(db);
    const sub = { endpoint: "https://fcm.googleapis.com/x", p256dh: "p", auth: "a", createdAt: NOW, updatedAt: NOW };
    await store.upsert({ ...sub, id: U(11), userId: "12", lang: "tr" });
    await store.upsert({ ...sub, id: U(12), userId: "13", lang: "ar", p256dh: "p2" });
    expect(await store.listForUser("12")).toEqual([]);
    expect(await store.listForUser("13")).toMatchObject([{ id: U(11), lang: "ar", p256dh: "p2" }]);
    await store.removeByEndpoint(sub.endpoint, "12");
    expect(await store.listForUser("13")).toHaveLength(1);
    await store.removeByEndpoint(sub.endpoint);
    expect(await store.listForUser("13")).toHaveLength(0);
  });
});

describe("zamanlı bildirim sorguları", () => {
  it("vadesi pencerede olan açık işler: kapalı, havuzdaki, test ve bitmiş olanlar çıkmaz", async () => {
    await lead(20, { hot: false });
    await lead(21, { hot: false, stage: "WON" });
    await lead(22, { hot: false, owner: null });
    await lead(23, { hot: false, test: true });
    await activity(201, 20, ago(2));
    await activity(202, 20, ago(30));
    await activity(203, 20, ago(-2));
    await activity(204, 20, ago(3), ago(1));
    await activity(205, 21, ago(2));
    await activity(206, 22, ago(2));
    await activity(207, 23, ago(2));
    const rows = await pgSweepSource(db).dueActivities(ago(24), NOW);
    expect(rows.map((r) => r.activityId)).toEqual([U(201)]);
    expect(rows[0]).toMatchObject({ userId: "12", leadName: "Lead 20", subject: "Arama", autoCreated: false });
  });

  it("bekleyen sıcak lead: son dokunma temas / biten iş / elle aşama; ileri tarihli işi olan sayılmaz", async () => {
    await lead(30, {}); // 40 saat önce açıldı, hiç dokunulmadı
    await lead(31, {}); // 5 saat önce temas
    await db.query("INSERT INTO contact_logs (id, lead_id, actor_user_id, created_at) VALUES ($1,$2,'12',$3)", [
      U(311),
      U(31),
      ago(5),
    ]);
    await lead(32, {}); // planlı işi var
    await activity(321, 32, ago(-24));
    await lead(33, { hot: false });
    await lead(34, { stage: "LOST" });
    await lead(35, { at: ago(24 * 30) }); // çok eski
    await lead(36, { at: ago(24 * 30) }); // eski ama 30 saat önce iş tamamlandı
    await activity(361, 36, ago(31), ago(30));
    const rows = await pgSweepSource(db).idleHotLeads(ago(24 * 14), ago(24), NOW);
    expect(rows.map((r) => r.leadId)).toEqual([U(30), U(36)]);
    expect(rows[1]!.lastTouchAt).toEqual(ago(30));
  });
});
