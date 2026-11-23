/**
 * Kişisel Excel listesinin eşitlenmesi ve geri yükleme noktası (2026-11-23), PGlite üzerinde sentetik veriyle (kişisel
 * bilgi yok). Senaryo: ana liste 16.11'de içe aktarılmış; satışçı kesimden önce bir lead'de, kesimden sonra başka bir
 * lead'de çalışmış; kişisel dosya aynı kişileri farklı numarayla ve yeni kişileri içeriyor.
 */
import express from "express";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPgliteDb, migrate, MIGRATIONS_DIR, readMigrations, type Db } from "../modules/shared/db";
import { FixedClock, silentLogger, unwrap, uuidGenerator } from "../modules/shared/kernel";
import { createSalesPipeline } from "../modules/sales-pipeline/application";
import { PgUnitOfWork } from "../modules/sales-pipeline/infrastructure";
import {
  captureLeads,
  createCheckpointRouter,
  listCheckpoints,
  previewRestore,
  restoreCheckpoint,
} from "./checkpoints";
import type { ExcelLeadRow, ExcelSnapshot } from "./excelSnapshot";
import { importExcel, IMPORT_ACTOR } from "./importExcel";
import type { DirectoryEntry } from "./teamMatch";
import { applyExcelSync, fixSwappedDates, mergedNote, planExcelSync, type SyncList } from "./syncExcel";

const IMPORT_AT = new Date("2026-11-16T12:00:00Z");
const AS_OF = new Date("2026-11-20T12:07:00Z");
const RUN_AT = new Date("2026-11-23T20:00:00Z");
const REP = "32";
const DIR: DirectoryEntry[] = [
  { id: REP, first: "Rep", last: "Bir", email: "rep1@example.test", role: "rep", active: true },
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
  installSite: "",
  installTimeline: "",
  profile: "",
  courtCount: "",
  platform: "",
  campaign: "MDM",
  warning: "",
  ...over,
});
const snap = (rows: ExcelLeadRow[]): ExcelSnapshot => ({
  rows,
  contacts: [],
  territories: [],
  ownerLabels: [],
  summary: {},
});

// Ana liste (16.11 içe aktarması): No 1–3, hepsine "mail atıldı".
const MASTER = snap([
  row(1, { email: "a@example.test", mailSent: true }),
  row(2, { email: "b@example.test", mailSent: true }),
  row(3, { email: "c@example.test", mailSent: true, notes: "Eski not" }),
]);
// Kişisel liste: a, b, c başka numarayla; No 1 ana listedeki No 1 değil, yeni kişi; No 10 CRM'de iki kopya.
const PERSONAL = snap([
  row(7, {
    email: "a@example.test",
    waSent: true,
    status: "İlgili",
    proposal: true,
    standard: { tick: true, qty: 6 },
    notes: "Teklif verildi",
  }),
  row(8, { email: "b@example.test", mailSent: true, status: "İlgisiz", proposal: true, notes: "Kesimden önce" }),
  row(9, {
    email: "c@example.test",
    mailSent: true,
    waSent: true,
    waReply: true,
    waReplyAt: "2026-03-11",
    notes: "Yeni not",
  }),
  row(1, { email: "yeni@example.test", mailSent: true, status: "İlgisiz", campaign: "Padel Court" }),
  row(10, { email: "dup@example.test", status: "İlgili" }),
]);
const LISTS: SyncList[] = [{ name: "amro", ownerId: REP, snapshot: PERSONAL }];

let db: Db;
const idOf = async (email: string) =>
  (await db.query<{ id: string }>("SELECT id FROM leads WHERE email = $1 ORDER BY created_at, id", [email])).map(
    (r) => r.id,
  );
const leadRow = async (id: string) =>
  (
    await db.query<{
      current_stage: string;
      customer_status: string | null;
      notes: string;
      products: unknown;
      assigned_user_id: string | null;
      is_test: boolean;
      extra_answers: Record<string, unknown>;
      campaign_name: string | null;
    }>(
      "SELECT current_stage, customer_status, notes, products, assigned_user_id, is_test, extra_answers, campaign_name FROM leads WHERE id = $1",
      [id],
    )
  )[0]!;
const acts = async (id: string) =>
  db.query<{ type: string; legacy_id: string | null; created_by_user_id: string | null; done_at: unknown }>(
    "SELECT type, legacy_id, created_by_user_id, done_at FROM activities WHERE lead_id = $1 ORDER BY created_at, id",
    [id],
  );
let allBefore: Awaited<ReturnType<typeof captureLeads>>;
let idsBefore: string[];
let checkpointId: string;

beforeAll(async () => {
  db = await createPgliteDb();
  await migrate(db, readMigrations(MIGRATIONS_DIR));
  await importExcel(db, MASTER, { directory: DIR, now: IMPORT_AT, seedFollowUps: false });
  const clock = new FixedClock(IMPORT_AT);
  const uow = new PgUnitOfWork(db, uuidGenerator);
  const sp = createSalesPipeline({
    uow,
    clock,
    ids: uuidGenerator,
    platforms: { enabledProviders: () => [] },
    events: { publish: async () => {} },
    logger: silentLogger,
    undoWindowMs: 0,
  });
  const [a] = await idOf("a@example.test");
  const [b] = await idOf("b@example.test");
  // a: satışçı 18.11'de (kesimden önce) arama kaydetti → Excel esas; arama kaydı kalır.
  const at = new Date("2026-11-18T08:00:00Z");
  await uow.run((repos) =>
    repos.activities.insert({
      id: uuidGenerator.next(),
      leadId: a!,
      type: "call",
      subject: "Arama",
      dueAt: at,
      doneAt: at,
      notes: "",
      autoCreated: false,
      createdByChangeId: null,
      createdByUserId: REP,
      legacyId: null,
      outcome: "negative",
      customerReplied: false,
      resultNote: "",
      doneByUserId: REP,
      dateEstimated: false,
      logId: null,
      nextOfLogId: null,
      createdAt: at,
      updatedAt: at,
    }),
  );
  await db.query("UPDATE leads SET updated_at = $2 WHERE id = $1", [a, at]);
  // b: satışçı 21.11'de (kesimden sonra) aşamayı değiştirdi → CRM esas.
  clock.set(new Date("2026-11-21T08:00:00Z"));
  unwrap(await sp.changeLeadStage.execute({ leadId: b!, target: "CONTACTED", actor: { userId: REP, isAdmin: false } }));
  // dup: aynı form iki kez çekilmiş (aynı saniye, aynı kişi).
  clock.set(IMPORT_AT);
  const d = unwrap(
    await sp.createLead.execute({
      source: "web_form",
      platformLeadId: "web:1",
      fullName: "Kopya",
      email: "dup@example.test",
      actor: IMPORT_ACTOR,
      assignedUserId: REP,
    }),
  ).lead;
  await db.query(
    `INSERT INTO leads SELECT (jsonb_populate_record(NULL::leads,
        to_jsonb(l) || jsonb_build_object('id', $2::text, 'platform_lead_id', 'web:2'))).* FROM leads l WHERE id = $1`,
    [d.id, uuidGenerator.next()],
  );
  idsBefore = (await db.query<{ id: string }>("SELECT id FROM leads ORDER BY id")).map((r) => r.id);
  allBefore = await captureLeads(db, idsBefore);
});
afterAll(() => db.close());

describe("syncExcel", () => {
  it("plan: kişiyle eşleşir, kesim zamanına göre karar verir, numara çakışmaz", async () => {
    const r = await planExcelSync(db, LISTS, { asOf: AS_OF, now: RUN_AT });
    const by = (no: string) => r.plans.find((p) => p.no === no)!;
    expect(r.counts).toEqual({ excel: 3, crm: 1, create: 1, skip: 0 });
    expect(by("7").mode).toBe("excel");
    expect(by("8").mode).toBe("crm");
    expect(by("9").mode).toBe("excel");
    expect(by("9").dateFixes).toEqual(["wa_reply_date_swapped"]);
    expect(by("1").mode).toBe("create");
    expect(by("10").hideDuplicates).toHaveLength(1);
    // Kuru koşu hiçbir şey yazmaz.
    expect(await captureLeads(db, idsBefore)).toEqual(allBefore);
  });

  it("uygula: Excel esas, CRM esas, yeni lead, kopya ve geri yükleme noktası", async () => {
    const plan = await planExcelSync(db, LISTS, { asOf: AS_OF, now: RUN_AT });
    const out = await applyExcelSync(db, plan, { asOf: AS_OF, now: RUN_AT, label: "Deneme", actorId: "import" });
    checkpointId = out.checkpointId;
    expect(out.failed).toEqual([]);
    expect(out.created).toBe(1);
    expect(out.hidden).toBe(1);

    // a (Excel esas): durum, ürün, not, aşama PROPOSAL; ana listenin mail teması silindi, satışçının araması kaldı.
    const [a] = await idOf("a@example.test");
    const la = await leadRow(a!);
    expect(la).toMatchObject({ customer_status: "interested", current_stage: "PROPOSAL", notes: "Teklif verildi" });
    expect(la.products).toEqual([{ productId: 21, qty: 6 }]);
    expect(la.extra_answers).toMatchObject({ excel_no: "1", excel_list: "amro", excel_list_no: "7" });
    const aa = await acts(a!);
    expect(aa.some((x) => x.legacy_id === "excel:1:mail_sent")).toBe(false);
    expect(aa.some((x) => x.type === "call" && x.created_by_user_id === REP)).toBe(true);
    expect(aa.some((x) => x.legacy_id === "excel:amro-7:wa_sent")).toBe(true);

    // b (CRM esas): yalnız boş alan doldu (durum, not); aşama ilerlemedi, mail teması kaldı.
    const [b] = await idOf("b@example.test");
    const lb = await leadRow(b!);
    expect(lb).toMatchObject({ customer_status: "not_interested", current_stage: "CONTACTED", notes: "Kesimden önce" });
    expect((await acts(b!)).some((x) => x.legacy_id === "excel:2:mail_sent")).toBe(true);

    // c (Excel esas): eski not korunur; ters tarih düzeltildi; dönüş → CONTACTED.
    const [c] = await idOf("c@example.test");
    const lc = await leadRow(c!);
    expect(lc.notes).toBe("Yeni not\n\nÖnceki not:\nEski not");
    expect(lc.current_stage).toBe("CONTACTED");
    const reply = (await acts(c!)).find((x) => x.legacy_id === "excel:amro-9:wa_reply");
    expect(new Date(reply!.done_at as string).toISOString().slice(0, 10)).toBe("2026-11-03");

    // Yeni kişi: ana listenin No 1'ine karışmadı.
    const [n] = await idOf("yeni@example.test");
    expect(await leadRow(n!)).toMatchObject({
      assigned_user_id: REP,
      customer_status: "not_interested",
      campaign_name: "Padel Court",
      extra_answers: expect.objectContaining({ excel_no: "amro-1", excel_list: "amro" }),
    });

    // Kopya gizlendi, asıl lead güncellendi.
    const [d1, d2] = await idOf("dup@example.test");
    expect((await leadRow(d1!)).customer_status).toBe("interested");
    expect(await leadRow(d2!)).toMatchObject({
      is_test: true,
      extra_answers: expect.objectContaining({ duplicate_of: d1 }),
    });

    const list = await listCheckpoints(db);
    expect(list[0]).toMatchObject({ id: checkpointId, label: "Deneme", restoredAt: null });
    expect(list[0]!.summary.leads.created).toBe(1);
  });

  it("ikinci koşu değişiklik yapmaz", async () => {
    const r = await planExcelSync(db, LISTS, { asOf: AS_OF, now: new Date(RUN_AT.getTime() + 60_000) });
    expect(r.plans.filter((p) => p.changes.length).map((p) => `${p.no}:${p.changes.join(",")}`)).toEqual([]);
  });

  it("geri yükleme noktası: veri işlemden önceki haline döner, ikinci kez kullanılamaz", async () => {
    const preview = await previewRestore(db, checkpointId);
    expect(preview).toMatchObject({ leads: { toDelete: 1, toRevert: 5 }, changedSince: 0 });
    const r = await restoreCheckpoint(db, checkpointId, "admin", new Date());
    expect(r.deleted).toBeGreaterThan(0);
    const ids = (await db.query<{ id: string }>("SELECT id FROM leads ORDER BY id")).map((x) => x.id);
    expect(ids).toEqual(idsBefore);
    expect(await captureLeads(db, idsBefore)).toEqual(allBefore);
    expect(await db.query("SELECT 1 FROM persons WHERE email_normalized = 'yeni@example.test'")).toEqual([]);
    await expect(restoreCheckpoint(db, checkpointId, "admin", new Date())).rejects.toMatchObject({
      code: "checkpoint.already_restored",
    });
  });

  it("uç yalnız yöneticiye açık", async () => {
    const ex = express();
    ex.use((req, _res, next) => {
      (req as express.Request & { role?: string | undefined }).role = req.header("x-role") ?? undefined;
      next();
    });
    ex.use(
      "/cp",
      createCheckpointRouter({
        db,
        roleOf: (req) => (req as express.Request & { role?: string | undefined }).role,
        actorIdOf: () => "admin",
        now: () => new Date(),
      }),
    );
    const server: Server = await new Promise((res) => {
      const s = ex.listen(0, () => res(s));
    });
    const addr = server.address();
    const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}/cp`;
    try {
      for (const role of ["rep", "marketing", "viewer"]) {
        expect((await fetch(base, { headers: { "x-role": role } })).status).toBe(403);
        expect(
          (await fetch(`${base}/${checkpointId}/restore`, { method: "POST", headers: { "x-role": role } })).status,
        ).toBe(403);
      }
      const ok = await fetch(base, { headers: { "x-role": "admin" } });
      expect(ok.status).toBe(200);
      expect(((await ok.json()) as { items: unknown[] }).items).toHaveLength(1);
      const again = await fetch(`${base}/${checkpointId}/restore`, { method: "POST", headers: { "x-role": "admin" } });
      expect(again.status).toBe(409);
    } finally {
      server.close();
    }
  });
});

describe("saf yardımcılar", () => {
  it("not birleştirme ve ters tarih", () => {
    expect(mergedNote("", "Yeni")).toBe("Yeni");
    expect(mergedNote("Eski", "Yeni")).toBe("Yeni\n\nÖnceki not:\nEski");
    expect(mergedNote("Yeni\n\nÖnceki not:\nEski", "Yeni")).toBeNull();
    expect(mergedNote("Bir şey", "")).toBeNull();
    const r = row(1, { leadDate: "2026-10-24", waReplyAt: "2026-03-11", mailReplyAt: "2026-10-01" });
    const f = fixSwappedDates(r, "2026-11-20");
    expect(f.row.waReplyAt).toBe("2026-11-03");
    // 10.01 → 01.10 lead tarihinden önce kalır: düzeltilmez.
    expect(f.row.mailReplyAt).toBe("2026-10-01");
    expect(f.fixes).toEqual(["wa_reply_date_swapped"]);
  });
});
