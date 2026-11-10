/**
 * Excel aktarımı (Faz 7g S7) PGlite üzerinde, sentetik anlık görüntüyle (kişisel veri yok): yeni / zenginleştirme /
 * yeniden çalıştırma, aşama türetme, temaslar, bölge kuralı, takip tohumu, doğrulama karşılaştırması.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPgliteDb, migrate, MIGRATIONS_DIR, readMigrations, type Db } from "../modules/shared/db";
import { FixedClock, silentLogger, unwrap, uuidGenerator } from "../modules/shared/kernel";
import { createSalesPipeline } from "../modules/sales-pipeline/application";
import { PgUnitOfWork } from "../modules/sales-pipeline/infrastructure";
import { compareRows, excelSummary, formulaCheck } from "./excelVerify";
import type { ExcelLeadRow, ExcelSnapshot } from "./excelSnapshot";
import { importExcel, IMPORT_ACTOR, productsFromRow, provenanceFromWarning } from "./importExcel";
import type { DirectoryEntry } from "./teamMatch";

const NOW = new Date("2026-11-10T09:00:00Z");
const DIR: DirectoryEntry[] = [
  { id: "32", first: "Rep", last: "Bir", email: "rep1@example.test", role: "rep", active: true },
  { id: "28", first: "Rep", last: "Iki", email: "rep2@example.test", role: "rep", active: true },
];

const row = (no: number, over: Partial<ExcelLeadRow> = {}): ExcelLeadRow => ({
  rowNo: no + 2,
  no: String(no),
  leadDate: "2026-10-25",
  fullName: `Sentetik ${no}`,
  country: "Türkiye (TR)",
  owner: "Rep Bir (rep1@example.test)",
  phone: "",
  email: `s${no}@example.test`,
  mailSent: false,
  waSent: false,
  mailReply: false,
  mailReplyAt: null,
  mailReplyRaw: false,
  waReply: false,
  waReplyAt: null,
  waReplyRaw: false,
  status: "",
  proposal: false,
  standard: { tick: false, qty: null },
  panoramic: { tick: false, qty: null },
  fullPanoramic: { tick: false, qty: null },
  roof: { tick: false, widthM: null, lengthM: null },
  notes: "",
  installSite: "Tam kapalı / çatılı kort",
  installTimeline: "3 ay içinde",
  profile: "Kulüp sahibi / işletmeci",
  courtCount: "2-3 kort",
  platform: "Instagram",
  campaign: "Kampanya X",
  warning: "",
  ...over,
});

const SNAP: ExcelSnapshot = {
  rows: [
    row(1, { mailSent: true }),
    row(2, { mailSent: true, waReply: true, waReplyAt: "2026-10-27", owner: "Enes (ortak@example.test)" }),
    row(3, { proposal: true, standard: { tick: false, qty: 2 }, status: "İlgili", installTimeline: "3-6 ay" }),
    row(4, { owner: "ATANMADI", warning: "Ülke formda yoktu; ülke telefon kodundan atandı" }),
    row(5, { email: "zengin@example.test", mailSent: true, roof: { tick: false, widthM: 10, lengthM: 20 } }),
  ],
  contacts: [],
  territories: [
    { country: "Türkiye (TR)", owner: "Rep Bir (rep1@example.test)" },
    { country: "Almanya (DE)", owner: "Almanya Distribütörü" },
  ],
  ownerLabels: ["Rep Bir (rep1@example.test)", "Enes (ortak@example.test)", "ATANMADI"],
  summary: {},
};

let db: Db;
beforeAll(async () => {
  db = await createPgliteDb();
  await migrate(db, readMigrations(MIGRATIONS_DIR));
  // Zenginleştirilecek mevcut lead (aynı e-posta, açık aşama, temas geçmişi bilinmeyen eski kayıt).
  const sp = createSalesPipeline({
    uow: new PgUnitOfWork(db, uuidGenerator),
    clock: new FixedClock(NOW),
    ids: uuidGenerator,
    platforms: { enabledProviders: () => [] },
    events: { publish: async () => {} },
    logger: silentLogger,
    undoWindowMs: 0,
  });
  unwrap(
    await sp.createLead.execute({
      source: "manual",
      fullName: "Mevcut",
      email: "zengin@example.test",
      country: "TR",
      actor: IMPORT_ACTOR,
      assignedUserId: "28",
    }),
  );
});
afterAll(() => db.close());

describe("importExcel", () => {
  it("ilk koşu: yeni + zenginleştirme, aşama türetme, temaslar, bölge, tohum", async () => {
    const r = await importExcel(db, SNAP, { directory: DIR, now: NOW });
    expect(r.leads.created).toBe(4);
    expect(r.leads.enriched).toHaveLength(1);
    expect(r.territory.written).toEqual(["TR"]);
    expect(r.contacts).toMatchObject({ mailSent: 3, waReply: 1 });
    expect(r.newLeadStages).toMatchObject({ NEW: 2, CONTACTED: 1, PROPOSAL: 1 });
    expect(r.issues).toMatchObject({ qty_without_tick: 1, roof_dims_without_tick: 1, excel_warning: 1 });
    expect(r.owners.find((o) => o.name === "Enes")?.match.kind).toBe("unresolved");

    const leads = await db.query<{
      extra_answers: Record<string, unknown>;
      assigned_user_id: string | null;
      current_stage: string;
    }>(
      "SELECT extra_answers, assigned_user_id, current_stage FROM leads WHERE extra_answers ? 'excel_no' ORDER BY (extra_answers->>'excel_no')::int",
    );
    expect(leads.map((l) => l.assigned_user_id)).toEqual(["32", null, "32", null, "28"]);
    expect(leads[1]?.extra_answers["excel_owner"]).toBe("Enes");
    expect(leads[3]?.extra_answers).toMatchObject({ country_source: "phone" });
    expect(leads[3]?.extra_answers["excel_owner"]).toBeUndefined();
    // Takip tohumu: atanmış, açık, açık işi olmayan lead'lere; havuza yok. Eski teklif (3 günden eski) "Teklif
    // takibi" açmaz, o lead de tohum alır: No 1, No 3 (32) ve zenginleştirilen No 5 (28).
    expect(r.seeds).toEqual({ "32": 2, "28": 1 });
  });

  it("ikinci koşu değişiklik yazmaz", async () => {
    const r = await importExcel(db, SNAP, { directory: DIR, now: NOW });
    expect(r.changes).toBe(0);
    expect(r.leads.rerun).toBe(5);
  });

  it("doğrulama: izinli farklar (A1, A2, A3, A4, A9) dışında fark yok", async () => {
    const sp = createSalesPipeline({
      uow: new PgUnitOfWork(db, uuidGenerator),
      clock: new FixedClock(NOW),
      ids: uuidGenerator,
      platforms: { enabledProviders: () => [] },
      events: { publish: async () => {} },
      logger: silentLogger,
      undoWindowMs: 0,
    });
    const leads = await sp.queries.list({ actor: IMPORT_ACTOR, scope: "excel", limit: 100 });
    const owner = (r: ExcelLeadRow) => (r.owner.startsWith("Rep Bir") ? "32" : null);
    const res = compareRows(SNAP, leads, owner, "Europe/Istanbul");
    expect(res.rowDiffs).toEqual([]);
    expect(res.missing).toEqual([]);
    expect(res.enriched).toEqual(["5"]);
    expect(res.reasons).toMatchObject({ A1: 1, A2: 1, A3: 2, A4: 1 });
    expect(res.ownerDiffs).toEqual([]);
  });
});

describe("saf yardımcılar", () => {
  it("ürün kuralları ve AJ köken bilgisi", () => {
    expect(productsFromRow(row(9, { standard: { tick: true, qty: null } }))).toMatchObject({
      products: { standard: 1 },
      issues: ["tick_without_qty"],
    });
    expect(provenanceFromWarning("Telefonda ülke kodu yoktu, +90 eklendi")).toEqual({ dial_code_assumed: "+90" });
  });

  it("formül sağlaması: önbellek değerleri yeniden hesapla aynı; bozulma yakalanır", () => {
    const computed = excelSummary(SNAP);
    const snap = { ...SNAP, summary: { ...computed } };
    expect(formulaCheck(snap)).toEqual([]);
    expect(computed["B7"]).toBe(5);
    expect(computed["C7"]).toBe(3);
    expect(computed["E7"]).toBe(2);
    const broken = { ...SNAP, summary: { ...computed, C7: 99 } };
    expect(formulaCheck(broken).map((d) => d.cell)).toEqual(["C7"]);
  });
});
