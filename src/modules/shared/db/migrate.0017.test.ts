import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "./db";
import { MIGRATIONS_DIR } from "./open";
import { migrate, readMigrations } from "./migrate";
import { createPgliteDb } from "./pglite";

/**
 * Migration 0017 (ürün listesi): 1–16 uygulanır, eski ürün sütunlarıyla örnek lead'ler yazılır, sonra 0017 uygulanır.
 * Standard → 21, Panoramic → 22, Full Panoramic → 25, Kapatma → 27 (1 adet) ve Kapatma'lı lead'in notuna
 * "Eski kayıt: kapatma istedi" (ölçü varsa o da) yazılır. Eski sütunlar yedek olarak kalır. Sentetik veri.
 */

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const P = uuid(1);
const L = {
  none: uuid(101), // ürün yok
  courts: uuid(102), // 2 Standard + 1 Full Panoramic
  roofBoth: uuid(103), // Panoramic 3 + Kapatma 20 × 10,5; notu dolu
  roofWidth: uuid(104), // Kapatma, yalnız genişlik
  roofNone: uuid(105), // Kapatma, ölçü yok
};

describe("migration 0017: ürün listesi ve eski kayıtların taşınması", () => {
  let db: Db;
  const all = readMigrations(MIGRATIONS_DIR);
  const row = async (id: string) =>
    (
      await db.query<{ products: unknown; notes: string; qty_standard: number | null; roof_wanted: boolean }>(
        "SELECT products, notes, qty_standard, roof_wanted FROM leads WHERE id = $1",
        [id],
      )
    )[0]!;
  const products = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : v);

  beforeAll(async () => {
    db = await createPgliteDb();
    await migrate(
      db,
      all.filter((m) => m.version <= 16),
    );
    await db.query("INSERT INTO persons (id, country) VALUES ($1, 'TR')", [P]);
    const ins = (
      id: string,
      q: [number | null, number | null, number | null],
      roof: [boolean, number | null, number | null],
      notes = "",
    ) =>
      db.query(
        `INSERT INTO leads (id, source, person_id, current_stage, notes, qty_standard, qty_panoramic, qty_full_panoramic,
                            roof_wanted, roof_width_m, roof_length_m)
         VALUES ($1, 'manual', $2, 'NEW', $3, $4, $5, $6, $7, $8, $9)`,
        [id, P, notes, ...q, ...roof],
      );
    await ins(L.none, [null, null, null], [false, null, null]);
    await ins(L.courts, [2, null, 1], [false, null, null]);
    await ins(L.roofBoth, [null, 3, null], [true, 20, 10.5], "Fiyat istedi");
    await ins(L.roofWidth, [null, null, null], [true, 12, null]);
    await ins(L.roofNone, [null, null, null], [true, null, null]);
    await migrate(db, all);
  });
  afterAll(() => db.close());

  it("ürün listesi: 35 ürün, 'de' yok, FLOD yazımı düzeltilmiş", async () => {
    const rows = await db.query<{ id: number; name: string }>("SELECT id, name FROM products ORDER BY sort_order");
    expect(rows).toHaveLength(35);
    expect(rows[0]).toEqual({ id: 21, name: "Standard Padel Court" });
    expect(rows.some((r) => Number(r.id) === 79)).toBe(false);
    expect(rows.filter((r) => /FLOD/.test(r.name))).toEqual([]);
  });

  it("adetler ürün listesine taşınır; Kapatma 27 numaraya 1 adet", async () => {
    expect(products((await row(L.none)).products)).toEqual([]);
    expect(products((await row(L.courts)).products)).toEqual([
      { productId: 21, qty: 2 },
      { productId: 25, qty: 1 },
    ]);
    expect(products((await row(L.roofBoth)).products)).toEqual([
      { productId: 22, qty: 3 },
      { productId: 27, qty: 1 },
    ]);
    expect(products((await row(L.roofNone)).products)).toEqual([{ productId: 27, qty: 1 }]);
  });

  it("Kapatma'lı lead'in notuna eski kayıt bilgisi ve varsa ölçü yazılır; diğer notlar değişmez", async () => {
    expect((await row(L.roofBoth)).notes).toBe("Fiyat istedi\nEski kayıt: kapatma istedi (çatı ölçüsü 20 × 10,5 m)");
    expect((await row(L.roofWidth)).notes).toBe("Eski kayıt: kapatma istedi (çatı genişliği 12 m)");
    expect((await row(L.roofNone)).notes).toBe("Eski kayıt: kapatma istedi");
    expect((await row(L.courts)).notes).toBe("");
  });

  it("eski sütunlar yedek olarak kalır", async () => {
    const r = await row(L.courts);
    expect(Number(r.qty_standard)).toBe(2);
    expect((await row(L.roofBoth)).roof_wanted).toBe(true);
  });
});
