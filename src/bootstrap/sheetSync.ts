/**
 * Form tablosu eşitlemesi (2026-11-11): Google E-Tablolar'daki Meta form dökümü ("UNIXPADEL Form Kampanyası Verisi")
 * CSV dışa aktarımından okunur ve CRM'e düşer. Sunucu birkaç dakikada bir çeker; elle de tetiklenir.
 *
 *  - Yeni satır → lead (`source: import`, platform kimliği `sheet:<anahtar>`), ülke kuralıyla atanır, sorumluya
 *    bildirim gider (gerçek `CreateLead`). Form cevapları kodlara çevrilir (lead-intake `normalizeFormAnswers`).
 *  - Kişi CRM'de zaten varsa (e-posta ya da telefon) ve açık lead'i varsa yeni lead açılmaz: boş alanlar doldurulur,
 *    `sheet_key` eklenir. (Excel aktarımındaki lead'ler böyle bulunur.)
 *  - Not sütununda "mail" geçiyorsa (ör. "mail atildi") ve lead'in e-posta teması yoksa tahmini tarihli bir
 *    e-posta teması eklenir (Excel'deki "Mail atıldı ✔" gibi).
 *  - İdempotent: satır anahtarı e-posta + telefon + oluşturma zamanından; temas eski kimlikle (legacy id).
 * Kişisel veri loglanmaz ve rapora yazılmaz: yalnız satır numarası, sayılar ve kodlar.
 */
import { createHash } from "node:crypto";
import type { Db } from "../modules/shared/db";
import { createScheduler, MINUTE, type Logger, type Scheduler } from "../modules/shared/kernel";
import { Email, PhoneNumber } from "../modules/shared/normalization";
import { countryCodeFrom, fold, normalizeFormAnswers } from "../modules/lead-intake/application";
import { localDayStart, type SalesPipeline } from "../modules/sales-pipeline/application";
import {
  DEFAULT_SUBJECTS,
  DEFAULT_TIME_ZONE,
  NO_CONTACT_FIELDS,
  isTerminal,
  type Lead,
  type UnitOfWork,
} from "../modules/sales-pipeline/domain";
import { PgUnitOfWork } from "../modules/sales-pipeline/infrastructure";
import { uuidGenerator } from "../modules/shared/kernel";

export const SHEET_ACTOR = { userId: "import", isAdmin: true } as const;

/** RFC 4180 CSV (tırnak, kaçış, CRLF). */
export function parseCsv(text: string): string[][] {
  const s = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

export interface SheetRow {
  /** Tablodaki satır numarası (başlık 1). */
  rowNo: number;
  key: string;
  createdRaw: string;
  createdAt: Date | null;
  campaign: string;
  platform: string;
  /** Soru sütunları (başlık → cevap); `normalizeFormAnswers` soruları başlıktan tanır. */
  answers: Record<string, string>;
  email: string;
  fullName: string;
  phone: string;
  country: string;
  note: string;
}

/** Başlık (katlanmış) → alan; ilk eşleşen sütun kullanılır. */
const HEADERS: Record<"created" | "campaign" | "platform" | "email" | "name" | "phone" | "country" | "note", string[]> =
  {
    created: ["created time", "created_time", "lead tarihi", "tarih"],
    campaign: ["campaign name", "kampanya"],
    platform: ["platform"],
    email: ["email", "e mail", "e posta"],
    name: ["full name", "ad soyad", "name"],
    phone: ["phone number", "telefon", "phone"],
    country: ["country", "ulke"],
    note: ["note", "not", "notlar"],
  };

/**
 * "11.7.26" (Meta dökümü, ay.gün.yıl), "2026-11-07…" (ISO) ya da "7.11.2026" (gün.ay.yıl; ilk parça 12'den büyükse).
 * Saat yoksa yerel 12:00. Tanınmazsa null.
 */
export function parseCreated(raw: string, timeZone: string = DEFAULT_TIME_ZONE): Date | null {
  const t = raw.trim();
  if (!t) return null;
  if (/^\d{4}-\d{2}-\d{2}T/.test(t)) {
    const d = new Date(t.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const m = /^(\d{1,2})[./](\d{1,2})[./](\d{2}|\d{4})$/.exec(t);
  if (!m) return null;
  let [a, b] = [Number(m[1]), Number(m[2])];
  const year = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  if (a > 12) [a, b] = [b, a]; // gün.ay
  const [month, day] = [a, b];
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const ymd = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const start = localDayStart(ymd, 0, timeZone);
  return start ? new Date(start.getTime() + 12 * 3600_000) : null;
}

/** Tablo sayıya çevirdiği için "+" düşmüş numara: yalnız rakamsa (10–15 hane) başına "+" eklenir. */
export function sheetPhone(raw: string): string {
  const t = raw.trim().replace(/^p:/i, "");
  return /^\d{10,15}$/.test(t) ? `+${t}` : t;
}

export function sheetKey(email: string, phone: string, createdRaw: string): string {
  const base = `${email.trim().toLowerCase()}|${phone.replace(/\D/g, "")}|${createdRaw.trim()}`;
  return `sheet:${createHash("sha1").update(base).digest("hex").slice(0, 20)}`;
}

/** CSV → satırlar. Zorunlu başlıklar (e-posta, ad, telefon, oluşturma zamanı) yoksa `missing` dolar. */
export function readSheet(text: string, timeZone?: string): { rows: SheetRow[]; missing: string[] } {
  const table = parseCsv(text);
  const head = (table[0] ?? []).map((h) => fold(h));
  const at = (k: keyof typeof HEADERS) => head.findIndex((h) => HEADERS[k].includes(h));
  const idx = Object.fromEntries((Object.keys(HEADERS) as (keyof typeof HEADERS)[]).map((k) => [k, at(k)])) as Record<
    keyof typeof HEADERS,
    number
  >;
  const missing = (["email", "name", "phone", "created"] as const).filter((k) => idx[k] < 0);
  if (missing.length) return { rows: [], missing: [...missing] };
  const questionCols = (table[0] ?? [])
    .map((h, i) => ({ h, i }))
    .filter(({ h, i }) => /\?\s*$/.test(h) || (!Object.values(idx).includes(i) && fold(h).split(" ").length >= 3));
  const cell = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
  const rows = table.slice(1).map((r, n): SheetRow => {
    const email = cell(r, idx.email);
    const phone = sheetPhone(cell(r, idx.phone));
    const createdRaw = cell(r, idx.created);
    return {
      rowNo: n + 2,
      key: sheetKey(email, phone, createdRaw),
      createdRaw,
      createdAt: parseCreated(createdRaw, timeZone),
      campaign: cell(r, idx.campaign),
      platform: cell(r, idx.platform),
      answers: Object.fromEntries(questionCols.map(({ h, i }) => [h, cell(r, i)])),
      email,
      fullName: cell(r, idx.name),
      phone,
      country: cell(r, idx.country),
      note: cell(r, idx.note),
    };
  });
  return { rows, missing: [] };
}

export interface SheetSyncReport {
  rows: number;
  created: number;
  /** CRM'de zaten olan kişinin açık lead'i bulundu (Excel aktarımı dahil); boş alanlar dolduruldu. */
  matched: number;
  /** Bu tablodan daha önce açılmış lead (yeniden çalıştırma). */
  rerun: number;
  mailContacts: number;
  /** E-posta temasının CRM'de zaten olan (ör. Excel'de "mail atılmadı" görünen) lead'e eklendiği satırlar. */
  mailOnExisting: number;
  skipped: { rowNo: number; reason: string }[];
  failed: { rowNo: number; code: string }[];
  /** Toplam yazma; değişiklik yoksa 0. */
  changes: number;
}

const SURFACE: Record<string, string> = { ig: "ig", instagram: "ig", fb: "fb", facebook: "fb" };

/** Tablo satırlarını CRM'e işler. `pipeline` sunucunun asıl hattıdır (bildirim ve bölge ataması çalışsın). */
export async function syncSheet(
  deps: { pipeline: SalesPipeline; uow: UnitOfWork; db: Db; now: Date; timeZone?: string | undefined },
  rows: readonly SheetRow[],
): Promise<SheetSyncReport> {
  const { pipeline: sp, uow, db, now } = deps;
  const report: SheetSyncReport = {
    rows: rows.length,
    created: 0,
    matched: 0,
    rerun: 0,
    mailContacts: 0,
    mailOnExisting: 0,
    skipped: [],
    failed: [],
    changes: 0,
  };
  for (const r of rows) {
    const e = r.email ? Email.parse(r.email) : null;
    const email = e && e.ok ? e.value.value : null;
    const p = r.phone ? PhoneNumber.parse(r.phone) : null;
    const phone = p && p.ok ? p.value.e164 : null;
    if (!email && !phone) {
      report.skipped.push({ rowNo: r.rowNo, reason: "kimliksiz" });
      continue;
    }
    const answers = normalizeFormAnswers({}, r.answers);
    const surface = SURFACE[fold(r.platform)] ?? null;

    let lead: Lead | undefined = await uow.run((repos) => repos.leads.findByPlatformId("import", r.key));
    let createdNow = false;
    if (lead) report.rerun++;
    if (!lead) {
      const person = await uow.run(async (repos) => {
        const byEmail = email ? await repos.persons.findByEmailOrPhone(email, null) : undefined;
        return byEmail ?? (phone ? await repos.persons.findByEmailOrPhone(null, phone) : undefined);
      });
      if (person) {
        const open = (await uow.run((repos) => repos.leads.list({ personId: person.id, includeTest: true }))).filter(
          (l) => !isTerminal(l.currentStage),
        );
        if (open[0]) {
          lead = open[0];
          report.matched++;
        }
      }
      if (lead) {
        // Boş alanları doldur; dolu ve farklı değer değişmez (CRM esastır).
        const fill: Record<string, unknown> = {};
        for (const [k, v] of [
          ["installSite", answers.installSite],
          ["installTimeline", answers.installTimeline],
          ["customerProfile", answers.customerProfile],
          ["courtCountBand", answers.courtCountBand],
          ["adSurface", surface],
        ] as const) {
          if (lead[k] === null && v) fill[k] = v;
        }
        if (Object.keys(fill).length) {
          const u = await sp.updateLeadFields.execute({ leadId: lead.id, fields: fill, actor: SHEET_ACTOR });
          if (u.ok) report.changes++;
        }
        if (!lead.campaign.campaignName && r.campaign) {
          await db.query("UPDATE leads SET campaign_name = $2 WHERE id = $1 AND campaign_name IS NULL", [
            lead.id,
            r.campaign,
          ]);
          report.changes++;
        }
        if (lead.extraAnswers["sheet_key"] !== r.key) {
          await uow.run((repos) => repos.leads.mergeExtraAnswers(lead!.id, { sheet_key: r.key }, now));
          report.changes++;
        }
      }
    }

    if (!lead) {
      // Ülke sütunu (ISO kodu ya da ad); yoksa ya da "90" gibi bir arama koduysa telefonun ülkesi.
      const country = countryCodeFrom(r.country);
      let resolved = country;
      if (!resolved && phone) {
        const pp = PhoneNumber.parse(phone);
        if (pp.ok && pp.value.country) resolved = pp.value.country;
      }
      const extra: Record<string, unknown> = { sheet_key: r.key, sheet_row: r.rowNo };
      if (!country && resolved) extra["country_source"] = "phone";
      if (r.country && !countryCodeFrom(r.country)) extra["country_raw"] = r.country;
      if (answers.unmatched.length) extra["unmatched_answers"] = answers.unmatched;
      const created = await sp.createLead.execute({
        source: "import",
        platformLeadId: r.key,
        fullName: r.fullName || r.email || "Form",
        email: email,
        phone: r.phone || null,
        country: resolved,
        campaign: { campaignName: r.campaign || null },
        installSite: answers.installSite,
        installTimeline: answers.installTimeline,
        customerProfile: answers.customerProfile,
        courtCountBand: answers.courtCountBand,
        ...(answers.courtCount !== null ? { courtCount: answers.courtCount } : {}),
        adSurface: surface,
        extraAnswers: extra,
        createdAt: r.createdAt,
        actor: null,
        parseMode: "lenient",
        invalidPhone: "drop",
      });
      if (!created.ok) {
        report.failed.push({ rowNo: r.rowNo, code: created.error.code });
        continue;
      }
      lead = created.value.lead;
      if (created.value.created) {
        report.created++;
        report.changes++;
        createdNow = true;
      }
    }

    // "mail atildi" → e-posta teması (lead'in hiç e-posta teması yoksa).
    if (fold(r.note).includes("mail")) {
      const l = lead;
      const legacyId = `${r.key}:mail_sent`;
      const added = await uow.run(async (repos) => {
        if (await repos.activities.findByLegacyId(legacyId)) return false;
        const acts = await repos.activities.listByLead(l.id);
        if (acts.some((a) => a.doneAt !== null && a.type === "email")) return false;
        const at = r.createdAt ? new Date(r.createdAt.getTime() - 3 * 3600_000) : now;
        await repos.activities.insert({
          id: uuidGenerator.next(),
          leadId: l.id,
          type: "email",
          subject: DEFAULT_SUBJECTS.email,
          dueAt: at,
          doneAt: at,
          notes: "",
          autoCreated: false,
          createdByChangeId: null,
          createdByUserId: SHEET_ACTOR.userId,
          legacyId,
          ...NO_CONTACT_FIELDS,
          outcome: "awaiting_reply",
          doneByUserId: l.assignedUserId,
          dateEstimated: true,
          createdAt: now,
          updatedAt: now,
        });
        return true;
      });
      if (added) {
        report.mailContacts++;
        if (!createdNow) report.mailOnExisting++;
        report.changes++;
      }
    }
  }
  return report;
}

export interface SheetSyncStatus {
  enabled: boolean;
  minutes: number;
  running: boolean;
  lastRunAt: string | null;
  lastOkAt: string | null;
  lastError: string | null;
  lastReport: (Omit<SheetSyncReport, "skipped" | "failed"> & { skipped: number; failed: number }) | null;
}

export interface SheetSync {
  status(): SheetSyncStatus;
  /** Elle tetikle; çalışıyorsa bitmesini bekler. */
  runNow(): Promise<SheetSyncStatus>;
  scheduler: Scheduler;
}

/**
 * Sunucu içinde zamanlanmış eşitleme. `fetchText` CSV'yi getirir (testlerde sahte). Hata zamanlayıcıyı durdurmaz;
 * durum yönetici göstergesine gider (adres asla).
 */
export function startSheetSync(opts: {
  pipeline: SalesPipeline;
  db: Db;
  minutes: number;
  fetchText: () => Promise<string>;
  logger: Logger;
  timeZone?: string | undefined;
  start?: boolean | undefined;
}): SheetSync {
  const uow = new PgUnitOfWork(opts.db, uuidGenerator);
  const st: SheetSyncStatus = {
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
      const text = await opts.fetchText();
      const { rows, missing } = readSheet(text, opts.timeZone);
      if (missing.length) throw new Error(`Tabloda zorunlu sütun yok: ${missing.join(", ")}`);
      const r = await syncSheet(
        { pipeline: opts.pipeline, uow, db: opts.db, now: new Date(), timeZone: opts.timeZone },
        rows,
      );
      st.lastReport = { ...r, skipped: r.skipped.length, failed: r.failed.length };
      st.lastOkAt = new Date().toISOString();
      st.lastError = null;
      if (r.changes) {
        opts.logger.info("form tablosu eşitlendi", {
          rows: r.rows,
          created: r.created,
          matched: r.matched,
          mailContacts: r.mailContacts,
          failed: r.failed.map((f) => `${f.rowNo}:${f.code}`),
        });
      }
    } catch (e) {
      st.lastError = e instanceof Error ? e.message : String(e);
      opts.logger.warn("form tablosu eşitlenemedi", { error: st.lastError });
    } finally {
      st.running = false;
    }
  };
  const scheduler = createScheduler(
    [{ name: "sheet-sync", everyMs: opts.minutes * MINUTE, runAtStart: true, run }],
    opts.logger,
  );
  if (opts.start ?? true) scheduler.start();
  return {
    status: () => ({ ...st }),
    async runNow() {
      await scheduler.runNow("sheet-sync");
      return { ...st };
    },
    scheduler,
  };
}

/** CSV adresinden metin; tablo herkese açık değilse Google giriş sayfası (HTML) döner. */
export async function fetchSheetCsv(url: string): Promise<string> {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`Tablo okunamadı (HTTP ${res.status}).`);
  const text = await res.text();
  if (/^\s*</.test(text)) throw new Error("Tablo CSV vermedi: bağlantı paylaşımı kapalı ya da adres yanlış.");
  return text;
}

/**
 * Sunucu bağlantısı: `SHEET_SYNC_CSV_URL` tanımlıysa eşitleme sunucunun asıl hattıyla başlar (bölge ataması ve
 * "yeni lead" bildirimi çalışır); tanımlı değilse null.
 */
export function bootSheetSync(app: {
  pipeline: SalesPipeline;
  db: Db;
  config: { sheetSync: { csvUrl: string; minutes: number } };
  logger: Logger;
}): SheetSync | null {
  const { csvUrl, minutes } = app.config.sheetSync;
  if (!csvUrl) return null;
  return startSheetSync({
    pipeline: app.pipeline,
    db: app.db,
    minutes,
    fetchText: () => fetchSheetCsv(csvUrl),
    logger: app.logger.child({ module: "sheet-sync" }),
  });
}
