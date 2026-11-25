/**
 * UnixPadelST müşteri listesi aktarımı (PGlite + bellekte ST tablosu; kişisel veri yok): aşama süzgeci, geri alma
 * süresi, ST'den gelmiş lead, e-posta / ad eşleşmesi, ad çakışması, ülke ve sahip, idempotentlik.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPgliteDb, migrate, MIGRATIONS_DIR, readMigrations, type Db } from "../modules/shared/db";
import { FixedClock, MINUTE, silentLogger, unwrap, uuidGenerator } from "../modules/shared/kernel";
import { createSalesPipeline, type SalesPipeline } from "../modules/sales-pipeline/application";
import { PgUnitOfWork } from "../modules/sales-pipeline/infrastructure";
import {
  nameVariants,
  stText,
  syncStCustomers,
  type StCustomer,
  type StCustomerRow,
  type StCustomerStore,
} from "./stCustomerSync";

const START = new Date("2026-11-25T09:00:00Z");
const ADMIN = { userId: "admin", isAdmin: true } as const;
const YES = { budget_approved: true, site_known: true, install_within_12m: true };
const SETTLE = 10 * MINUTE;

class MemoryStore implements StCustomerStore {
  rows: (StCustomerRow & { id: number })[] = [];
  private next = 500;
  constructor(seed: StCustomer[] = []) {
    for (const s of seed) this.rows.push({ ...s, phone: "", address: "", countryId: null, ownerUserId: null });
  }
  findByEmail = async (email: string) => this.pick(this.rows.find((r) => r.email.toLowerCase() === email));
  findByName = async (name: string) => this.pick(this.rows.find((r) => r.name.toLowerCase() === name.toLowerCase()));
  countryId = async (iso: string) => ({ TR: 1, DE: 7 })[iso] ?? null;
  insert = async (row: StCustomerRow) => {
    const id = this.next++;
    this.rows.push({ ...row, id });
    return id;
  };
  private pick = (r?: StCustomer) => (r ? { id: r.id, name: r.name, email: r.email } : null);
}

let db: Db;
let sp: SalesPipeline;
const clock = new FixedClock(START);

const lead = async (input: Record<string, unknown>) =>
  unwrap(
    await sp.createLead.execute({
      source: "manual",
      actor: ADMIN,
      assignedUserId: "32",
      ...(input as { fullName: string }),
    }),
  ).lead.id;
const toStage = async (leadId: string, target: string, extra: Record<string, unknown> = {}) =>
  unwrap(await sp.changeLeadStage.execute({ leadId, actor: ADMIN, ...(extra as object), target: target as "WON" }));

beforeAll(async () => {
  db = await createPgliteDb();
  await migrate(db, readMigrations(MIGRATIONS_DIR));
  sp = createSalesPipeline({
    uow: new PgUnitOfWork(db, uuidGenerator),
    clock,
    ids: uuidGenerator,
    platforms: { enabledProviders: () => [] },
    events: { publish: async () => {} },
    logger: silentLogger,
    undoWindowMs: SETTLE,
  });
});
afterAll(() => db.close());

describe("yardımcılar", () => {
  it("utf8mb3 dışı karakter düşer, boşluk sadeleşir, uzunluk kesilir", () => {
    expect(stText("  Padel 🎾  Kulüp  ")).toBe("Padel Kulüp");
    expect(stText("x".repeat(60), 50)).toHaveLength(50);
  });
  it("ad çakışırsa ülke kodu, sonra sıra numarası; 50 karakteri aşmaz", () => {
    expect(nameVariants("Kulüp", "tr").slice(0, 3)).toEqual(["Kulüp", "Kulüp (TR)", "Kulüp (2)"]);
    expect(nameVariants("y".repeat(50), "DE")[1]).toBe(`${"y".repeat(45)} (DE)`);
  });
});

describe("syncStCustomers", () => {
  it("Nitelikli ve üstü, süresi dolmuş lead'ler yazılır ya da bağlanır; ikinci koşu bir şey yapmaz", async () => {
    const store = new MemoryStore([
      { id: 10, name: "Eski Müşteri", email: "eski@example.test" },
      { id: 11, name: "Aynı Ad Kulübü", email: "baska@example.test" },
      { id: 12, name: "Ortak Ad", email: "" },
    ]);

    const fresh = await lead({
      fullName: "Yeni Kişi",
      email: "YENI@example.test",
      phone: "+905550000001",
      country: "TR",
      city: "İzmir",
      company: "Yeni Padel",
    });
    const byEmail = await lead({ fullName: "Eski Kişi", email: "eski@example.test", country: "DE" });
    const clash = await lead({
      fullName: "Çakışan",
      email: "cakis@example.test",
      country: "DE",
      company: "Aynı Ad Kulübü",
    });
    const sameName = await lead({ fullName: "Kimse", email: "kimse@example.test", company: "Ortak Ad" });
    const imported = await lead({
      source: "import",
      platformLeadId: "mysql:musteri:77",
      fullName: "ST'den",
      email: "st@example.test",
    });
    const pool = await lead({ fullName: "Havuz", email: "havuz@example.test", assignedUserId: null });
    const contacted = await lead({ fullName: "Sadece temas", email: "temas@example.test" });
    const lost = await lead({ fullName: "Kayıp", email: "kayip@example.test" });
    const testLead = await lead({ fullName: "Test", email: "test@example.test", isTest: true });

    for (const id of [fresh, clash, imported, pool, lost, testLead]) await toStage(id, "PROPOSAL");
    await toStage(byEmail, "QUALIFIED", { qualificationAnswers: YES });
    await toStage(sameName, "WON", { value: { amount: 1000, currency: "EUR" } });
    await toStage(contacted, "CONTACTED");
    await toStage(lost, "LOST", { lostReasonCode: "competitor" });

    // Geri alma süresi dolmadan hiçbir şey yazılmaz.
    clock.advance(5 * MINUTE);
    expect((await syncStCustomers({ db, store, now: clock.now(), settleMs: SETTLE })).candidates).toBe(0);

    clock.advance(6 * MINUTE);
    const r = await syncStCustomers({ db, store, now: clock.now(), settleMs: SETTLE });
    expect(r).toMatchObject({ candidates: 6, created: 3, linked: 3, skipped: [], failed: [] });

    const links = new Map(
      (
        await db.query<{ lead_id: string; musteri_id: number; created: boolean }>(
          "SELECT lead_id, musteri_id, created FROM st_customer_links",
        )
      ).map((l) => [l.lead_id, l]),
    );
    expect(links.get(byEmail)).toMatchObject({ musteri_id: 10, created: false });
    expect(links.get(sameName)).toMatchObject({ musteri_id: 12, created: false });
    expect(links.get(imported)).toMatchObject({ musteri_id: 77, created: false });
    expect([contacted, lost, testLead].some((id) => links.has(id))).toBe(false);

    const made = (id: string) => store.rows.find((row) => row.id === links.get(id)?.musteri_id);
    expect(made(fresh)).toMatchObject({
      name: "Yeni Padel",
      email: "yeni@example.test",
      phone: "+905550000001",
      address: "İzmir",
      countryId: 1,
      ownerUserId: 32,
    });
    expect(made(clash)).toMatchObject({ name: "Aynı Ad Kulübü (DE)", countryId: 7 });
    expect(made(pool)).toMatchObject({ name: "Havuz", ownerUserId: null, countryId: null });

    const again = await syncStCustomers({ db, store, now: clock.now(), settleMs: SETTLE });
    expect(again).toMatchObject({ candidates: 0, created: 0, linked: 0 });
    expect(store.rows).toHaveLength(6);
  });

  it("geri alınan aşama değişikliği ve silinen lead aktarılmaz", async () => {
    const store = new MemoryStore();
    const undone = await lead({ fullName: "Geri Alınan", email: "geri@example.test" });
    const change = await toStage(undone, "PROPOSAL");
    unwrap(await sp.undoStageChange.execute({ leadId: undone, changeId: change.changeId, actor: ADMIN }));
    const deleted = await lead({ fullName: "Silinen", email: "silinen@example.test" });
    await toStage(deleted, "PROPOSAL");
    await db.query("UPDATE leads SET deleted_at = now() WHERE id = $1", [deleted]);

    clock.advance(SETTLE + MINUTE);
    expect((await syncStCustomers({ db, store, now: clock.now(), settleMs: SETTLE })).candidates).toBe(0);
    expect(store.rows).toHaveLength(0);
  });

  it("ST hatası diğer lead'leri durdurmaz, sonraki koşuda yeniden denenir", async () => {
    const store = new MemoryStore();
    const id = await lead({ fullName: "Hata", email: "hata@example.test" });
    await toStage(id, "PROPOSAL");
    clock.advance(SETTLE + MINUTE);
    const failing: StCustomerStore = {
      findByEmail: store.findByEmail,
      findByName: store.findByName,
      countryId: store.countryId,
      insert: () => Promise.reject(new Error("bağlantı yok")),
    };
    const r1 = await syncStCustomers({ db, store: failing, now: clock.now(), settleMs: SETTLE });
    expect(r1.failed).toEqual([{ leadId: id, error: "bağlantı yok" }]);
    const r2 = await syncStCustomers({ db, store, now: clock.now(), settleMs: SETTLE });
    expect(r2).toMatchObject({ created: 1, failed: [] });
  });
});
