import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPgliteDb, migrate, MIGRATIONS_DIR, readMigrations, type Db } from "../../shared/db";
import { pgNotificationStore } from "./notifications";

let db: Db;
const T0 = new Date("2026-03-01T10:00:00Z");
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

beforeAll(async () => {
  db = await createPgliteDb();
  await migrate(db, readMigrations(MIGRATIONS_DIR));
});
afterAll(() => db.close());

describe("user_notifications (PGlite)", () => {
  it("yazar, kullanıcıya göre listeler, okundu işaretler; başkasının bildirimi işaretlenemez; lead silinince düşer", async () => {
    const store = pgNotificationStore(db);
    await db.query("INSERT INTO persons (id) VALUES ($1)", [U(9)]);
    await db.query("INSERT INTO leads (id, source, person_id, current_stage) VALUES ($1,'manual',$2,'NEW')", [
      U(8),
      U(9),
    ]);
    const base = { type: "lead_assigned" as const, leadId: U(8), title: "Yeni lead", body: "{}", readAt: null };
    await store.insert({ ...base, id: U(1), userId: "12", createdAt: T0 });
    await store.insert({ ...base, id: U(2), userId: "12", createdAt: new Date(T0.getTime() + 1000) });
    await store.insert({ ...base, id: U(3), userId: "13", createdAt: T0 });
    expect((await store.listForUser("12", 10)).map((n) => n.id)).toEqual([U(2), U(1)]);
    expect(await store.unreadCount("12")).toBe(2);
    expect(await store.markRead(U(1), "13", T0)).toBe(false);
    expect(await store.markRead(U(1), "12", T0)).toBe(true);
    expect(await store.markRead(U(1), "12", new Date(T0.getTime() + 5000))).toBe(true);
    expect((await store.listForUser("12", 10)).find((n) => n.id === U(1))?.readAt).toEqual(T0);
    expect(await store.unreadCount("12")).toBe(1);
    expect(await store.markAllRead("12", T0)).toBe(1);
    expect(await store.markAllRead("12", T0)).toBe(0);
    await db.query("DELETE FROM leads WHERE id = $1", [U(8)]);
    expect(await store.listForUser("12", 10)).toEqual([]);
  });
});
