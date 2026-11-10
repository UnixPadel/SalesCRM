import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPgliteDb, migrate, MIGRATIONS_DIR, readMigrations, type Db } from "../modules/shared/db";
import {
  countryCodeFor,
  currencyOf,
  importMysqlCustomers,
  normalizePhone,
  stageFor,
  type MysqlSnapshot,
} from "./importMysql";

const snap: MysqlSnapshot = {
  customers: [
    // siparişi var → WON, tutar son siparişin; sorumlu 12 (ekipte)
    {
      id: 1,
      name: "Ali Veli",
      phone: "532 123 45 67",
      email: "ali@example.com",
      address: "Bodrum",
      vat: "-",
      zip: "-",
      countryIso: "TR",
      dialCode: "+90",
      createdByUserId: "12",
    },
    // yalnız teklif → PROPOSAL; sorumlu 99 ekipte değil → havuz
    {
      id: 2,
      name: "Jane Doe",
      phone: "+44 7768 730300",
      email: "-",
      address: null,
      vat: null,
      zip: null,
      countryIso: "GB",
      dialCode: "+44",
      createdByUserId: "99",
    },
    // kayıt yok → CONTACTED; telefon "0" boş, e-posta var
    {
      id: 3,
      name: "Hans Müller",
      phone: "0",
      email: "hans@example.de",
      address: null,
      vat: null,
      zip: null,
      countryIso: "DE",
      dialCode: "+49",
      createdByUserId: null,
    },
    // e-posta ve telefon yok → atlanır
    {
      id: 4,
      name: "Boş Kayıt",
      phone: "-",
      email: "-",
      address: null,
      vat: null,
      zip: null,
      countryIso: null,
      dialCode: null,
      createdByUserId: null,
    },
    // Ali ile aynı e-posta → mükerrer, atlanır
    {
      id: 5,
      name: "Ali Veli (eski)",
      phone: null,
      email: "ALI@example.com",
      address: null,
      vat: null,
      zip: null,
      countryIso: "TR",
      dialCode: "+90",
      createdByUserId: "12",
    },
  ],
  clients: [
    {
      id: 10,
      firstName: "Chandra ",
      lastName: "Jayakumaran ",
      phone: null,
      email: "cm@example.com",
      country: "Australia",
      city: "Perth",
      details: "3 kort fiyat",
      platform: "Instagram",
      createdAt: "2025-12-04T04:56:36.000Z",
      createdByUserId: "44",
    },
    // müşteri listesindeki Hans ile aynı e-posta → ikinci lead açılmaz
    {
      id: 11,
      firstName: "Hans",
      lastName: "Mueller",
      phone: null,
      email: "hans@example.de",
      country: "Germany",
      city: null,
      details: null,
      platform: null,
      createdAt: null,
      createdByUserId: "44",
    },
    // ülke Türkçe adla sözlükten çözülür; siparişi var → WON
    {
      id: 12,
      firstName: "Mete",
      lastName: "Kaya",
      phone: "+90 533 111 22 33",
      email: null,
      country: "Hırvatistan",
      city: null,
      details: "x",
      platform: null,
      createdAt: "2026-01-10T10:00:00.000Z",
      createdByUserId: "12",
    },
  ],
  orders: [
    {
      id: 100,
      customerId: 1,
      clientId: null,
      kind: "Teklif",
      deleted: false,
      total: 50000,
      currency: "Euro",
      date: "2026-02-01T00:00:00.000Z",
      userId: "12",
    },
    {
      id: 101,
      customerId: 1,
      clientId: null,
      kind: "Siparis",
      deleted: false,
      total: 48000,
      currency: "Euro",
      date: "2026-03-01T00:00:00.000Z",
      userId: "12",
    },
    {
      id: 102,
      customerId: 1,
      clientId: null,
      kind: "Siparis",
      deleted: true,
      total: 1,
      currency: "Euro",
      date: "2026-04-01T00:00:00.000Z",
      userId: "12",
    },
    {
      id: 103,
      customerId: 2,
      clientId: null,
      kind: "Teklif",
      deleted: false,
      total: 12000,
      currency: "Sterlin",
      date: "2026-02-10T00:00:00.000Z",
      userId: "46",
    },
    {
      id: 104,
      customerId: 2,
      clientId: null,
      kind: "Iptal",
      deleted: false,
      total: 99999,
      currency: "Sterlin",
      date: "2026-02-11T00:00:00.000Z",
      userId: "46",
    },
    {
      id: 105,
      customerId: null,
      clientId: 12,
      kind: "Tamamlandi",
      deleted: false,
      total: 30000,
      currency: "Dolar",
      date: "2026-05-01T00:00:00.000Z",
      userId: "12",
    },
  ],
  countryNames: { hırvatistan: "HR", almanya: "DE" },
};

let db: Db;
beforeAll(async () => {
  db = await createPgliteDb();
  await migrate(db, readMigrations(MIGRATIONS_DIR));
});
afterAll(() => db.close());

describe("saf yardımcılar", () => {
  it("telefon: ülke kodu eklenir, baştaki 0 düşer, boş/0/- boş döner, + ve 00 korunur", () => {
    expect(normalizePhone("532 395 65 95", "+90")).toBe("+905323956595");
    expect(normalizePhone("0532 395 65 95", "+90")).toBe("+905323956595");
    expect(normalizePhone("+385 98 931 4208", "+385")).toBe("+385 98 931 4208");
    expect(normalizePhone("0044 7768 730300", "+44")).toBe("+44 7768 730300");
    expect(normalizePhone("0", "+1")).toBeNull();
    expect(normalizePhone("-", "+90")).toBeNull();
    expect(normalizePhone("", "+90")).toBeNull();
    expect(normalizePhone("12345", "+90")).toBeNull();
  });
  it("aşama: sipariş WON, yalnız teklif PROPOSAL, kayıt yok CONTACTED; silinen ve iptal sayılmaz; tutar son kaydın", () => {
    expect(stageFor([])).toMatchObject({ stage: "CONTACTED", value: null });
    expect(stageFor(snap.orders.filter((o) => o.customerId === 1))).toMatchObject({
      stage: "WON",
      value: { amount: 48000, currency: "EUR" },
      at: "2026-03-01T00:00:00.000Z",
    });
    expect(stageFor(snap.orders.filter((o) => o.customerId === 2))).toMatchObject({
      stage: "PROPOSAL",
      value: { amount: 12000, currency: "GBP" },
    });
    expect(currencyOf("Dolar")).toBe("USD");
    expect(currencyOf(null)).toBe("EUR");
  });
  it("ülke adı: İngilizce, kısaltma ve verilen sözlük", () => {
    expect(countryCodeFor("Australia")).toBe("AU");
    expect(countryCodeFor("United Kingdom")).toBe("GB");
    expect(countryCodeFor("UAE")).toBe("AE");
    expect(countryCodeFor("tr")).toBe("TR");
    expect(countryCodeFor("Hırvatistan", { hırvatistan: "HR" })).toBe("HR");
    expect(countryCodeFor("Atlantis")).toBeNull();
    expect(countryCodeFor(null)).toBeNull();
  });
});

describe("importMysqlCustomers", () => {
  it("müşteriler ve talepler taşınır; mükerrer kişi ve boş kayıt atlanır; sorumlu ekip dışıysa havuz; aşamalar doğru", async () => {
    const r = await importMysqlCustomers(db, snap, { teamIds: ["12", "44"] });
    expect(r.customers.created).toBe(3);
    expect(r.customers.existing).toBe(0);
    expect(r.customers.skipped).toEqual([
      { id: 4, reason: "lead.contact_required" },
      { id: 5, reason: "kişi zaten kayıtlı (mükerrer)" },
    ]);
    expect(r.customers.stageErrors).toEqual([]);
    expect(r.clients.created).toBe(2);
    expect(r.clients.skipped).toEqual([{ id: 11, reason: "kişi müşteri listesinde zaten var" }]);
    expect(r.stages).toEqual({ WON: 2, PROPOSAL: 1, CONTACTED: 1, NEW: 1 });
    expect(r.unknownOwners).toEqual(["46", "99"]);

    const leads = await db.query<{
      platform_lead_id: string;
      current_stage: string;
      assigned_user_id: string | null;
      phone_e164: string | null;
      email: string | null;
      country: string | null;
      notes: string;
      city: string;
      created_at: Date;
    }>(
      "SELECT platform_lead_id, current_stage, assigned_user_id, phone_e164, email, country, notes, city, created_at FROM leads WHERE source = 'import' ORDER BY platform_lead_id",
    );
    const by = Object.fromEntries(leads.map((l) => [l.platform_lead_id, l]));
    expect(by["mysql:musteri:1"]).toMatchObject({
      current_stage: "WON",
      assigned_user_id: "12",
      phone_e164: "+905321234567",
      email: "ali@example.com",
      country: "TR",
      notes: "Adres: Bodrum",
    });
    expect(new Date(by["mysql:musteri:1"]!.created_at).toISOString()).toBe("2026-03-01T00:00:00.000Z");
    expect(by["mysql:musteri:2"]).toMatchObject({
      current_stage: "PROPOSAL",
      assigned_user_id: null,
      email: null,
      country: "GB",
    });
    expect(by["mysql:musteri:3"]).toMatchObject({
      current_stage: "CONTACTED",
      phone_e164: null,
      email: "hans@example.de",
    });
    expect(by["mysql:client:10"]).toMatchObject({
      current_stage: "NEW",
      assigned_user_id: "44",
      country: "AU",
      city: "Perth",
      notes: "3 kort fiyat",
    });
    expect(by["mysql:client:12"]).toMatchObject({ current_stage: "WON", country: "HR", assigned_user_id: "12" });

    // Tutarlar aşama olayına yazıldı (WON ve PROPOSAL).
    const values = await db.query<{
      platform_lead_id: string;
      stage_code: string;
      value_amount: string | number | null;
      currency: string | null;
    }>(
      `SELECT l.platform_lead_id, e.stage_code, e.value_amount, e.currency
         FROM lead_stage_events e JOIN leads l ON l.id = e.lead_id
        WHERE e.stage_code IN ('WON','PROPOSAL') AND e.origin = 'manual' ORDER BY l.platform_lead_id`,
    );
    expect(values.map((v) => [v.platform_lead_id, v.stage_code, Number(v.value_amount), v.currency])).toEqual([
      ["mysql:client:12", "WON", 30000, "USD"],
      ["mysql:musteri:1", "WON", 48000, "EUR"],
      ["mysql:musteri:2", "PROPOSAL", 12000, "GBP"],
    ]);
    // Geçmiş teklif için bugün takip aktivitesi açılmadı.
    const autoActs = await db.query<{ n: string | number }>("SELECT count(*) AS n FROM activities WHERE auto_created");
    expect(Number(autoActs[0]?.n)).toBe(0);
    // Platforma olay üretilmedi (sağlayıcı listesi boş).
    const outbox = await db.query<{ n: string | number }>("SELECT count(*) AS n FROM outbound_conversion_events");
    expect(Number(outbox[0]?.n)).toBe(0);
  });

  it("yeniden çalıştırma güvenli: hiçbir şey ikinci kez açılmaz", async () => {
    const r = await importMysqlCustomers(db, snap, { teamIds: ["12", "44"] });
    expect(r.customers).toMatchObject({ created: 0, existing: 3 });
    expect(r.clients).toMatchObject({ created: 0, existing: 2 });
    expect(
      (await db.query<{ n: string | number }>("SELECT count(*) AS n FROM leads WHERE source = 'import'"))[0]?.n,
    ).toSatisfy((n: string | number) => Number(n) === 5);
  });
});
