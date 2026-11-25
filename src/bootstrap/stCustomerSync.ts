/**
 * UnixPadelST müşteri listesi (2026-11-25): aşaması Nitelikli, Teklif gönderildi ya da Kazanıldı olan lead, öteki
 * programın (UnixPadelST, MySQL) `MusteriBilgileri` tablosunda müşteri olarak görünür.
 *
 *  - Aşama değişikliği geri alma süresi (10 dk) dolmadan aktarılmaz: "Geri al" yanlışlıkla açılmış müşteri bırakmaz.
 *  - ST'den gelmiş lead (`mysql:musteri:<MusteriID>`) yeniden yazılmaz, o müşteriye bağlanır.
 *  - ST'de aynı e-postalı müşteri varsa ona bağlanır; aynı adlı müşteri e-postası çelişmiyorsa ona bağlanır,
 *    çelişiyorsa ad ülke koduyla ayrıştırılır ("Ad (TR)"). ST müşteri adını tekil tutar.
 *  - Yazılan müşterinin sahibi (`CreatedByKullaniciID`) lead'in sorumlusudur: ST'de satışçı kendi müşterisini görür.
 *  - Bir kez aktarılan lead `st_customer_links` tablosuna yazılır; sonra kayıp olsa da geri çekilse de ST'de kalır.
 * Kişisel veri loglanmaz: yalnız lead kimliği, MusteriID ve sayılar.
 */
import type { Db } from "../modules/shared/db";
import { createScheduler, MINUTE, readSecret, type Logger, type Scheduler } from "../modules/shared/kernel";

/** "Nitelikli ve üstü": kayıp dışarıda (kaybedilen lead müşteri listesine girmez). */
export const ST_SYNC_STAGES = ["QUALIFIED", "PROPOSAL", "WON"] as const;
/** MusteriBilgileri.MusteriAd varchar(50). */
export const ST_NAME_MAX = 50;
const IMPORTED_PREFIX = "mysql:musteri:";

export interface StCustomer {
  id: number;
  name: string;
  email: string;
}

export interface StCustomerRow {
  name: string;
  phone: string;
  email: string;
  address: string;
  countryId: number | null;
  ownerUserId: number | null;
}

/** Öteki programın müşteri tablosu. Gerçeği MySQL (`createMysqlStCustomerStore`), testlerde bellek. */
export interface StCustomerStore {
  findByEmail(email: string): Promise<StCustomer | null>;
  findByName(name: string): Promise<StCustomer | null>;
  countryId(iso: string): Promise<number | null>;
  insert(row: StCustomerRow): Promise<number>;
  close?(): Promise<void>;
}

export interface StCandidate {
  leadId: string;
  platformLeadId: string | null;
  fullName: string;
  email: string | null;
  phone: string | null;
  country: string | null;
  city: string;
  company: string;
  organization: string | null;
  assignedUserId: string | null;
}

export interface StSyncReport {
  candidates: number;
  created: number;
  linked: number;
  skipped: { leadId: string; reason: string }[];
  failed: { leadId: string; error: string }[];
}

/** ST tablosu utf8mb3: 4 baytlık karakterler (emoji vb.) yazılamaz; boşluklar sadeleşir. */
export const stText = (s: string | null | undefined, max = Infinity): string =>
  Array.from(
    (s ?? "")
      .replace(/[\u{10000}-\u{10FFFF}]/gu, "")
      .replace(/\s+/g, " ")
      .trim(),
  )
    .slice(0, max)
    .join("")
    .trim();

/** Müşteri adı: kuruluş > firma > kişi adı. */
export const stCustomerName = (c: StCandidate): string =>
  stText(c.organization, ST_NAME_MAX) || stText(c.company, ST_NAME_MAX) || stText(c.fullName, ST_NAME_MAX);

const normEmail = (e: string | null | undefined) => (e ?? "").trim().toLowerCase();

/** Ad başka (e-postası çelişen) müşteriye aitse denenecek adlar. */
export function nameVariants(name: string, country: string | null): string[] {
  const fit = (suffix: string) => `${stText(name, ST_NAME_MAX - suffix.length)}${suffix}`;
  const out = [name];
  if (country) out.push(fit(` (${country.toUpperCase()})`));
  for (let i = 2; i <= 5; i++) out.push(fit(` (${i})`));
  return [...new Set(out)];
}

const CANDIDATE_SQL = `
  SELECT l.id, l.platform_lead_id, l.full_name, l.email, l.phone_e164, l.country, l.city, l.company,
         o.name AS org_name, l.assigned_user_id
    FROM leads l
    LEFT JOIN organizations o ON o.id = l.organization_id
   WHERE l.deleted_at IS NULL AND NOT l.is_test
     AND l.current_stage = ANY($1::text[])
     AND NOT EXISTS (SELECT 1 FROM st_customer_links s WHERE s.lead_id = l.id)
     AND EXISTS (SELECT 1 FROM lead_stage_events e
                  WHERE e.lead_id = l.id AND e.undone_at IS NULL
                    AND e.stage_code = ANY($1::text[]) AND e.occurred_at <= $2)
   ORDER BY l.created_at
   LIMIT $3`;

/** Aktarılacak lead'ler: aşaması uygun, geri alma süresi dolmuş, henüz bağlanmamış. */
export async function listStCandidates(db: Db, settledBefore: Date, limit = 200): Promise<StCandidate[]> {
  const rows = await db.query(CANDIDATE_SQL, [[...ST_SYNC_STAGES], settledBefore.toISOString(), limit]);
  return rows.map((r) => ({
    leadId: String(r["id"]),
    platformLeadId: (r["platform_lead_id"] as string | null) ?? null,
    fullName: String(r["full_name"] ?? ""),
    email: (r["email"] as string | null) ?? null,
    phone: (r["phone_e164"] as string | null) ?? null,
    country: ((r["country"] as string | null) ?? "").trim() || null,
    city: String(r["city"] ?? ""),
    company: String(r["company"] ?? ""),
    organization: (r["org_name"] as string | null) ?? null,
    assignedUserId: (r["assigned_user_id"] as string | null) ?? null,
  }));
}

/** Tek lead: var olan müşteriye bağla ya da yaz. */
async function placeCustomer(
  store: StCustomerStore,
  c: StCandidate,
  countries: Map<string, number | null>,
): Promise<{ id: number; created: boolean } | { skip: string }> {
  if (c.platformLeadId?.startsWith(IMPORTED_PREFIX)) {
    const id = Number(c.platformLeadId.slice(IMPORTED_PREFIX.length));
    if (Number.isInteger(id) && id > 0) return { id, created: false };
  }
  const email = normEmail(c.email);
  if (email) {
    const same = await store.findByEmail(email);
    if (same) return { id: same.id, created: false };
  }
  const name = stCustomerName(c);
  if (!name) return { skip: "no_name" };

  let freeName: string | null = null;
  for (const n of nameVariants(name, c.country)) {
    const taken = await store.findByName(n);
    if (!taken) {
      freeName = n;
      break;
    }
    // Aynı ad, e-postası çelişmeyen müşteri: aynı müşteri sayılır.
    const theirs = normEmail(taken.email);
    if (!email || !theirs || theirs === email) return { id: taken.id, created: false };
  }
  if (!freeName) return { skip: "name_taken" };

  let countryId: number | null = null;
  if (c.country) {
    const iso = c.country.toUpperCase();
    if (!countries.has(iso)) countries.set(iso, await store.countryId(iso));
    countryId = countries.get(iso) ?? null;
  }
  const owner = c.assignedUserId && /^\d+$/.test(c.assignedUserId) ? Number(c.assignedUserId) : null;
  const id = await store.insert({
    name: freeName,
    phone: stText(c.phone, 40),
    email: stText(email, 100),
    address: stText(c.city),
    countryId,
    ownerUserId: owner,
  });
  return { id, created: true };
}

export async function syncStCustomers(deps: {
  db: Db;
  store: StCustomerStore;
  now: Date;
  settleMs: number;
  limit?: number;
}): Promise<StSyncReport> {
  const candidates = await listStCandidates(deps.db, new Date(deps.now.getTime() - deps.settleMs), deps.limit);
  const report: StSyncReport = { candidates: candidates.length, created: 0, linked: 0, skipped: [], failed: [] };
  const countries = new Map<string, number | null>();
  for (const c of candidates) {
    try {
      const placed = await placeCustomer(deps.store, c, countries);
      if ("skip" in placed) {
        report.skipped.push({ leadId: c.leadId, reason: placed.skip });
        continue;
      }
      await deps.db.query(
        `INSERT INTO st_customer_links (lead_id, musteri_id, created, linked_at) VALUES ($1, $2, $3, $4)
         ON CONFLICT (lead_id) DO NOTHING`,
        [c.leadId, placed.id, placed.created, deps.now.toISOString()],
      );
      if (placed.created) report.created++;
      else report.linked++;
    } catch (e) {
      report.failed.push({ leadId: c.leadId, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return report;
}

/** MySQL (UnixPadelST). Bağlantı ilk kullanımda açılır; şifre ve sunucu adı loglanmaz. */
export function createMysqlStCustomerStore(url: string): StCustomerStore {
  type Pool = import("mysql2/promise").Pool;
  let pool: Pool | null = null;
  const conn = async (): Promise<Pool> => {
    if (pool) return pool;
    const mysql = await import("mysql2/promise");
    const u = new URL(url);
    pool = mysql.createPool({
      host: u.hostname,
      port: Number(u.port) || 3306,
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      database: u.pathname.replace(/^\//, ""),
      connectionLimit: 2,
      connectTimeout: 10000,
    });
    return pool;
  };
  const one = async (sql: string, params: unknown[]): Promise<Record<string, unknown> | null> => {
    const [rows] = await (await conn()).query(sql, params);
    return (rows as Record<string, unknown>[])[0] ?? null;
  };
  const toCustomer = (r: Record<string, unknown> | null): StCustomer | null =>
    r ? { id: Number(r["MusteriID"]), name: String(r["MusteriAd"] ?? ""), email: String(r["E_Mail"] ?? "") } : null;
  return {
    findByEmail: async (email) =>
      toCustomer(
        await one(
          "SELECT MusteriID, MusteriAd, E_Mail FROM MusteriBilgileri WHERE LOWER(TRIM(E_Mail)) = ? ORDER BY Silindi, MusteriID LIMIT 1",
          [email],
        ),
      ),
    findByName: async (name) =>
      toCustomer(
        await one(
          "SELECT MusteriID, MusteriAd, E_Mail FROM MusteriBilgileri WHERE TRIM(MusteriAd) = ? ORDER BY Silindi, MusteriID LIMIT 1",
          [name],
        ),
      ),
    countryId: async (iso) => {
      const r = await one(
        "SELECT UlkelerID FROM UlkelerBilgileri WHERE UPPER(IsoKodu) = ? ORDER BY UlkelerID LIMIT 1",
        [iso],
      );
      return r ? Number(r["UlkelerID"]) : null;
    },
    insert: async (row) => {
      const [res] = await (
        await conn()
      ).query(
        `INSERT INTO MusteriBilgileri (MusteriAd, Telefon, ZipKod, E_Mail, Adres, VATNumarasi, UlkelerID, CreatedByKullaniciID, Silindi)
         VALUES (?, ?, '', ?, ?, '', ?, ?, 0)`,
        [row.name, row.phone, row.email, row.address, row.countryId, row.ownerUserId],
      );
      return Number((res as { insertId: number }).insertId);
    },
    close: async () => {
      await pool?.end();
      pool = null;
    },
  };
}

export interface StCustomerSyncStatus {
  enabled: boolean;
  minutes: number;
  running: boolean;
  lastRunAt: string | null;
  lastOkAt: string | null;
  lastError: string | null;
  lastReport: (Omit<StSyncReport, "skipped" | "failed"> & { skipped: number; failed: number }) | null;
}

export interface StCustomerSync {
  status(): StCustomerSyncStatus;
  /** Elle tetikle; çalışıyorsa bitmesini bekler. */
  runNow(): Promise<StCustomerSyncStatus>;
  scheduler: Scheduler;
}

export function startStCustomerSync(opts: {
  db: Db;
  store: StCustomerStore;
  minutes: number;
  settleMs: number;
  logger: Logger;
  start?: boolean | undefined;
}): StCustomerSync {
  const st: StCustomerSyncStatus = {
    enabled: true,
    minutes: opts.minutes,
    running: false,
    lastRunAt: null,
    lastOkAt: null,
    lastError: null,
    lastReport: null,
  };
  const run = async () => {
    st.running = true;
    st.lastRunAt = new Date().toISOString();
    try {
      const r = await syncStCustomers({ db: opts.db, store: opts.store, now: new Date(), settleMs: opts.settleMs });
      st.lastReport = { ...r, skipped: r.skipped.length, failed: r.failed.length };
      st.lastOkAt = new Date().toISOString();
      st.lastError = r.failed[0]?.error ?? null;
      if (r.created || r.linked || r.failed.length) {
        opts.logger.info("ST müşteri listesi eşitlendi", {
          created: r.created,
          linked: r.linked,
          skipped: r.skipped.map((s) => `${s.leadId}:${s.reason}`),
          failed: r.failed.map((f) => f.leadId),
        });
      }
    } catch (e) {
      st.lastError = e instanceof Error ? e.message : String(e);
      opts.logger.warn("ST müşteri listesi eşitlenemedi", { error: st.lastError });
    } finally {
      st.running = false;
    }
  };
  const scheduler = createScheduler(
    [{ name: "st-customer-sync", everyMs: opts.minutes * MINUTE, runAtStart: true, run }],
    opts.logger,
  );
  if (opts.start ?? true) scheduler.start();
  return {
    status: () => ({ ...st }),
    async runNow() {
      await scheduler.runNow("st-customer-sync");
      return { ...st };
    },
    scheduler,
  };
}

/** Sunucu bağlantısı: ST_CUSTOMER_SYNC=0 değilse ve ST_DB_URL ya da AUTH_DB_URL bir MySQL adresiyse başlar; yoksa null. */
export function bootStCustomerSync(app: {
  db: Db;
  config: {
    undoWindowMinutes: number;
    stCustomerSync: { enabled: boolean; minutes: number; dbUrlSecretNames: readonly string[] };
  };
  logger: Logger;
}): StCustomerSync | null {
  const cfg = app.config.stCustomerSync;
  if (!cfg.enabled) return null;
  const url = cfg.dbUrlSecretNames.map((n) => readSecret(n).trim()).find(Boolean) ?? "";
  if (!/^mysql/.test(url)) return null;
  return startStCustomerSync({
    db: app.db,
    store: createMysqlStCustomerStore(url),
    minutes: cfg.minutes,
    settleMs: app.config.undoWindowMinutes * MINUTE,
    logger: app.logger.child({ module: "st-customer-sync" }),
  });
}
