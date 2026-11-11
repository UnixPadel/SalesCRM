/**
 * Form tablosu eşitlemesi (PGlite, sentetik CSV; kişisel veri yok): ayrıştırma, yeni lead, CRM'de olan kişiyle
 * eşleşme, "mail atildi" teması, idempotentlik, zamanlayıcı durumu.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPgliteDb, migrate, MIGRATIONS_DIR, readMigrations, type Db } from "../modules/shared/db";
import { FixedClock, silentLogger, unwrap, uuidGenerator } from "../modules/shared/kernel";
import { createSalesPipeline, type SalesPipeline } from "../modules/sales-pipeline/application";
import { PgUnitOfWork } from "../modules/sales-pipeline/infrastructure";
import { parseCreated, parseCsv, readSheet, sheetPhone, startSheetSync, syncSheet } from "./sheetSync";

const NOW = new Date("2026-11-11T09:00:00Z");
const HEAD =
  "Campaign name,created_time,platform,where_will_the_court_be_installed?,when_do_you_plan_to_install?," +
  "which_best_describes_you?,how_many_courts_are_you_planning?,email,full_name,phone_number,country,note";
const CSV = [
  HEAD,
  "Kampanya A,11.7.26,ig,full_cover_padel_court_,within_3_months,investor_opening_a_new_padel_venue,2-3_courts,a1@example.test,Test Bir,905550000001,TR,mail atildi",
  "Kampanya A,11.8.26,fb,coastal_/_windy_site,in_3-6_months,padel_club_owner_/_operator,1_court,a2@example.test,Test Iki,447700000002,,",
  'Kampanya A,11.9.26,ig,"çatı_/_teras",şimdilik_araştırıyorum,evim_için_özel_kort,7+_kort,mevcut@example.test,Test Uc,######,90,mail atildi',
  "Kampanya A,11.10.26,ig,rooftop,within_3_months,distributor_/_reseller,1_court,,,,,",
].join("\r\n");

let db: Db;
let sp: SalesPipeline;
let uow: PgUnitOfWork;

beforeAll(async () => {
  db = await createPgliteDb();
  await migrate(db, readMigrations(MIGRATIONS_DIR));
  uow = new PgUnitOfWork(db, uuidGenerator);
  sp = createSalesPipeline({
    uow,
    clock: new FixedClock(NOW),
    ids: uuidGenerator,
    platforms: { enabledProviders: () => [] },
    events: { publish: async () => {} },
    logger: silentLogger,
    undoWindowMs: 0,
  });
  // CRM'de zaten olan kişi (ör. Excel aktarımı): açık lead'i, e-posta teması yok.
  unwrap(
    await sp.createLead.execute({
      source: "import",
      fullName: "Mevcut",
      email: "mevcut@example.test",
      country: "TR",
      extraAnswers: { excel_no: "7" },
      actor: { userId: "import", isAdmin: true },
      assignedUserId: "32",
    }),
  );
});
afterAll(() => db.close());

describe("ayrıştırma", () => {
  it("CSV tırnak ve CRLF; tarih ay.gün.yıl; telefona + eklenir", () => {
    expect(parseCsv('a,"b,c"\r\n"x""y",z\r\n')).toEqual([
      ["a", "b,c"],
      ['x"y', "z"],
    ]);
    expect(parseCreated("11.7.26")?.toISOString()).toBe("2026-11-07T09:00:00.000Z");
    expect(parseCreated("25.11.2026")?.toISOString()).toBe("2026-11-25T09:00:00.000Z");
    expect(parseCreated("x")).toBeNull();
    expect(sheetPhone("905550000001")).toBe("+905550000001");
    expect(sheetPhone("######")).toBe("######");
    const { rows, missing } = readSheet(CSV);
    expect(missing).toEqual([]);
    expect(rows).toHaveLength(4);
    expect(Object.keys(rows[0]!.answers)).toHaveLength(4);
  });

  it("zorunlu sütun yoksa missing", () => {
    expect(readSheet("a,b\n1,2").missing).toEqual(["email", "name", "phone", "created"]);
  });
});

describe("syncSheet", () => {
  it("yeni lead, mevcut kişiyle eşleşme, mail teması; ikinci koşu değişiklik yok", async () => {
    const { rows } = readSheet(CSV);
    const r = await syncSheet({ pipeline: sp, uow, db, now: NOW }, rows);
    expect(r).toMatchObject({ rows: 4, created: 2, matched: 1, mailContacts: 2, mailOnExisting: 1 });
    expect(r.skipped).toEqual([{ rowNo: 5, reason: "kimliksiz" }]);

    const leads = await db.query<{
      email: string;
      country: string | null;
      install_site: string | null;
      install_timeline: string | null;
      customer_profile: string | null;
      court_count_band: string | null;
      ad_surface: string | null;
      phone_e164: string | null;
      extra_answers: Record<string, unknown>;
      campaign_name: string | null;
    }>(
      "SELECT email, country, install_site, install_timeline, customer_profile, court_count_band, ad_surface, phone_e164, extra_answers, campaign_name FROM leads ORDER BY email",
    );
    const a1 = leads.find((l) => l.email === "a1@example.test")!;
    expect(a1).toMatchObject({
      country: "TR",
      install_site: "covered_court",
      install_timeline: "m0_3",
      customer_profile: "investor",
      court_count_band: "2_3",
      ad_surface: "ig",
      phone_e164: "+905550000001",
      campaign_name: "Kampanya A",
    });
    const a2 = leads.find((l) => l.email === "a2@example.test")!;
    // Ülke sütunu boş → telefondan (GB), köken işaretli.
    expect(a2).toMatchObject({
      country: "GB",
      install_site: "beach_windy",
      install_timeline: "m3_6",
      customer_profile: "club_operator",
    });
    expect(a2.extra_answers["country_source"]).toBe("phone");
    // Mevcut lead: yeni lead açılmadı, boş alanlar doldu, sheet_key eklendi, e-posta teması eklendi.
    const ex = leads.find((l) => l.email === "mevcut@example.test")!;
    expect(ex).toMatchObject({
      install_site: "rooftop",
      install_timeline: "researching",
      customer_profile: "private_home",
      court_count_band: "7_plus",
    });
    expect(typeof ex.extra_answers["sheet_key"]).toBe("string");
    expect(leads).toHaveLength(3);

    const again = await syncSheet({ pipeline: sp, uow, db, now: NOW }, rows);
    expect(again).toMatchObject({ created: 0, rerun: 2, matched: 1, mailContacts: 0, changes: 0 });
  });

  it("zamanlanmış eşitleme durumu ve hata", async () => {
    const ok = startSheetSync({
      pipeline: sp,
      db,
      minutes: 5,
      fetchText: async () => CSV,
      logger: silentLogger,
      start: false,
    });
    const s = await ok.runNow();
    expect(s).toMatchObject({ enabled: true, lastError: null, lastReport: { rows: 4, changes: 0 } });
    const bad = startSheetSync({
      pipeline: sp,
      db,
      minutes: 5,
      fetchText: async () => "foo,bar\n1,2",
      logger: silentLogger,
      start: false,
    });
    expect((await bad.runNow()).lastError).toContain("zorunlu sütun");
  });
});
