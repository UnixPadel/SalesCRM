/**
 * Şirket MySQL veritabanındaki eski müşteri listesini yeni pipeline'a taşır (Faz 7f).
 *
 *   MusteriBilgileri (390) → kişi + lead `import`, platform_lead_id `mysql:musteri:<MusteriID>`
 *     siparişi olan (SiparisAlTablo, Teklif/Iptal dışı, silinmemiş) → WON  (tutar: son siparişin ToplamFiyat/ParaTipi)
 *     yalnız teklifi olan                                              → PROPOSAL (tutar: son teklifin)
 *     hiç kaydı olmayan                                                → CONTACTED
 *   Clients (188 talep)  → kişi + lead `import` NEW, platform_lead_id `mysql:client:<id>`; talep metni nota.
 *     E-postası ya da telefonu zaten bir kişiye kayıtlıysa ikinci lead açılmaz (atlanır, raporlanır).
 *
 * Aynı komutlar (CreateLead, ChangeLeadStage): doğrulama ve mükerrer kişi kuralı aynen geçerli; platforma olay
 * üretmez. Yeniden çalıştırma güvenli: platform kimliği olan satır ikinci kez açılmaz. Kişisel veri loglanmaz.
 */
import type { Db } from "../modules/shared/db";
import { FixedClock, silentLogger, uuidGenerator, type Logger } from "../modules/shared/kernel";
import { createSalesPipeline, type SalesPipeline } from "../modules/sales-pipeline/application";
import type { StageCode } from "../modules/sales-pipeline/domain";
import { PgUnitOfWork } from "../modules/sales-pipeline/infrastructure";

export interface MysqlCustomer {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  vat: string | null;
  zip: string | null;
  /** UlkelerBilgileri.IsoKodu (ISO-2) ve NumaraBirimi (+90). */
  countryIso: string | null;
  dialCode: string | null;
  createdByUserId: string | null;
}

export interface MysqlClient {
  id: number;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  /** Serbest metin ülke adı (İngilizce ya da Türkçe). */
  country: string | null;
  city: string | null;
  details: string | null;
  platform: string | null;
  createdAt: string | null;
  createdByUserId: string | null;
}

export interface MysqlOrder {
  id: number;
  customerId: number | null;
  clientId: number | null;
  /** Teklif | Siparis | Tamamlandi | Hazir | Planlama | Uretim | Lojistik | Iptal */
  kind: string | null;
  deleted: boolean;
  total: number | null;
  currency: string | null;
  date: string | null;
  userId: string | null;
}

export interface MysqlSnapshot {
  customers: MysqlCustomer[];
  clients: MysqlClient[];
  orders: MysqlOrder[];
  /** Ülke adı (küçük harf, TR ve EN) → ISO-2; Clients.country çözümü için. */
  countryNames?: Record<string, string>;
}

export interface ImportMysqlOptions {
  /** Kullanıcı tablosundaki aktif satışçı/yönetici kimlikleri; dışındakiler havuza düşer. */
  teamIds: readonly string[];
  logger?: Logger;
}

export interface ImportMysqlReport {
  customers: {
    created: number;
    existing: number;
    skipped: { id: number; reason: string }[];
    stageErrors: { id: number; reason: string }[];
  };
  clients: { created: number; existing: number; skipped: { id: number; reason: string }[] };
  stages: Record<string, number>;
  unknownOwners: string[];
}

const QUOTE = "Teklif";
const CANCELLED = "Iptal";
const YES = { budget_approved: true, site_known: true, install_within_12m: true };
const CURRENCY: Record<string, string> = {
  euro: "EUR",
  eur: "EUR",
  dolar: "USD",
  usd: "USD",
  sterlin: "GBP",
  gbp: "GBP",
  tl: "TRY",
  try: "TRY",
};

export const currencyOf = (raw: string | null): string => CURRENCY[(raw ?? "").trim().toLowerCase()] ?? "EUR";

/**
 * Eski kayıtlardaki telefon: "+385 98 931 4208" olduğu gibi; "532 395 65 95" ülke koduyla; "0", "-" ya da
 * rakamsız değer boş. Baştaki 0 (ulusal önek) ülke kodu eklenince düşer.
 */
export function normalizePhone(raw: string | null, dialCode: string | null): string | null {
  const s = (raw ?? "").trim();
  if (
    !s ||
    s === "-" ||
    !/\d{5,}/.test(s.replace(/\D/g, "").padEnd(5, "0").slice(0, 5)) ||
    s.replace(/\D/g, "").length < 6
  ) {
    return null;
  }
  if (/^\+|^00/.test(s)) return s.startsWith("00") ? "+" + s.slice(2) : s;
  const digits = s.replace(/\D/g, "").replace(/^0+/, "");
  const code = (dialCode ?? "").replace(/\D/g, "");
  return code ? `+${code}${digits}` : digits;
}

const clean = (v: string | null | undefined): string => {
  const s = (v ?? "").trim();
  return s === "-" || s === "0" ? "" : s;
};

/** Sipariş kayıtlarından aşama: sipariş → WON, yalnız teklif → PROPOSAL, yoksa CONTACTED; tutar en son kaydın. */
export function stageFor(orders: readonly MysqlOrder[]): {
  stage: StageCode;
  value: { amount: number; currency: string } | null;
  at: string | null;
  userId: string | null;
} {
  const live = orders.filter((o) => !o.deleted && o.kind !== CANCELLED);
  const sales = live.filter((o) => o.kind !== QUOTE);
  const pick = sales.length ? sales : live;
  if (!pick.length) return { stage: "CONTACTED", value: null, at: null, userId: null };
  const sorted = [...pick].sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
  const last = sorted[sorted.length - 1]!;
  const amount = last.total !== null && Number.isFinite(last.total) && last.total > 0 ? last.total : null;
  return {
    stage: sales.length ? "WON" : "PROPOSAL",
    value: amount === null ? null : { amount, currency: currencyOf(last.currency) },
    at: last.date,
    userId: last.userId,
  };
}

/** Clients.country serbest metni → ISO-2 (İngilizce bölge adları ve verilen sözlük). */
export function countryCodeFor(name: string | null, dictionary: Record<string, string> = {}): string | null {
  const key = (name ?? "").trim().toLowerCase();
  if (!key) return null;
  if (/^[a-z]{2}$/.test(key)) return key.toUpperCase();
  if (dictionary[key]) return dictionary[key]!;
  return ENGLISH_NAMES[key] ?? null;
}

const ENGLISH_NAMES: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  try {
    const names = new Intl.DisplayNames(["en"], { type: "region" });
    for (let a = 65; a <= 90; a++)
      for (let b = 65; b <= 90; b++) {
        const code = String.fromCharCode(a) + String.fromCharCode(b);
        const n = names.of(code);
        if (n && n !== code) out[n.toLowerCase()] = code;
      }
  } catch {
    /* Intl yoksa yalnız sözlük */
  }
  out["uk"] = "GB";
  out["united kingdom"] = "GB";
  out["england"] = "GB";
  out["usa"] = "US";
  out["united states"] = "US";
  out["uae"] = "AE";
  out["ksa"] = "SA";
  out["turkey"] = "TR";
  out["türkiye"] = "TR";
  out["turkiye"] = "TR";
  out["russia"] = "RU";
  return out;
})();

export async function importMysqlCustomers(
  db: Db,
  snap: MysqlSnapshot,
  opts: ImportMysqlOptions,
): Promise<ImportMysqlReport> {
  const logger = opts.logger ?? silentLogger;
  const clock = new FixedClock();
  const uow = new PgUnitOfWork(db, uuidGenerator);
  const sp: SalesPipeline = createSalesPipeline({
    uow,
    clock,
    ids: uuidGenerator,
    platforms: { enabledProviders: () => [] }, // taşıma platformlara olay üretmez
    events: { publish: async () => {} },
    logger,
    undoWindowMs: 0,
  });
  const report: ImportMysqlReport = {
    customers: { created: 0, existing: 0, skipped: [], stageErrors: [] },
    clients: { created: 0, existing: 0, skipped: [] },
    stages: {},
    unknownOwners: [],
  };
  const team = new Set(opts.teamIds.map(String));
  const unknown = new Set<string>();
  const ACTOR = { userId: "import", isAdmin: true };
  const ownerOf = (...candidates: (string | null | undefined)[]): string | null => {
    for (const c of candidates) {
      if (!c) continue;
      if (team.has(String(c))) return String(c);
      unknown.add(String(c));
    }
    return null;
  };
  const bump = (stage: string) => (report.stages[stage] = (report.stages[stage] ?? 0) + 1);

  const byCustomer = new Map<number, MysqlOrder[]>();
  const byClient = new Map<number, MysqlOrder[]>();
  for (const o of snap.orders) {
    if (o.customerId !== null) byCustomer.set(o.customerId, [...(byCustomer.get(o.customerId) ?? []), o]);
    if (o.clientId !== null) byClient.set(o.clientId, [...(byClient.get(o.clientId) ?? []), o]);
  }

  /** Geçersiz e-posta ya da telefonla kaydı kaybetmemek için sırayla dener. */
  const createWithFallback = async (input: Parameters<SalesPipeline["createLead"]["execute"]>[0]) => {
    const first = await sp.createLead.execute(input);
    if (first.ok) return first;
    if (first.error.code.startsWith("phone") && input.email) return sp.createLead.execute({ ...input, phone: null });
    if (first.error.code.startsWith("email") && input.phone) return sp.createLead.execute({ ...input, email: null });
    return first;
  };

  /** Bu kişi (e-posta/telefon) zaten lead'li mi? Müşteri listesindeki mükerrerler ve müşteri olan talepler için. */
  const personHasLead = async (email: string | null, phone: string | null): Promise<boolean> => {
    if (!email && !phone) return false;
    return uow.run(async (r) => {
      const p = await r.persons.findByEmailOrPhone(email?.toLowerCase() ?? null, phone);
      if (!p) return false;
      const leads = await r.leads.list({ limit: 1, includeTest: true, personId: p.id });
      return leads.length > 0;
    });
  };

  // Müşteriler: önce siparişi olanlar (WON), sonra teklifliler, sonra kalanlar — mükerrer kişide zengin kayıt kazanır.
  const rank: Record<string, number> = { WON: 0, PROPOSAL: 1, CONTACTED: 2 };
  const customers = snap.customers
    .map((c) => ({ c, s: stageFor(byCustomer.get(c.id) ?? []) }))
    .sort((a, b) => rank[a.s.stage]! - rank[b.s.stage]! || a.c.id - b.c.id);

  for (const { c, s } of customers) {
    const platformLeadId = `mysql:musteri:${c.id}`;
    const existing = await uow.run((r) => r.leads.findByPlatformId("import", platformLeadId));
    if (existing) {
      report.customers.existing++;
      continue;
    }
    const email = clean(c.email) || null;
    const phone = normalizePhone(c.phone, c.dialCode);
    if (!email && !phone) {
      report.customers.skipped.push({ id: c.id, reason: "lead.contact_required" });
      continue;
    }
    if (await personHasLead(email, phone)) {
      report.customers.skipped.push({ id: c.id, reason: "kişi zaten kayıtlı (mükerrer)" });
      continue;
    }
    const createdAt = s.at ? new Date(s.at) : clock.now();
    clock.set(Number.isNaN(createdAt.getTime()) ? new Date() : createdAt);
    const notes = [
      clean(c.address) && `Adres: ${clean(c.address)}`,
      clean(c.vat) && `VAT: ${clean(c.vat)}`,
      clean(c.zip) && `Posta kodu: ${clean(c.zip)}`,
    ]
      .filter(Boolean)
      .join("\n");
    const r = await createWithFallback({
      source: "import",
      platformLeadId,
      fullName: clean(c.name) || `Müşteri ${c.id}`,
      email,
      phone,
      country: c.countryIso,
      notes,
      createdAt: clock.now(),
      assignedUserId: ownerOf(c.createdByUserId, s.userId),
      extraAnswers: { mysql: { table: "MusteriBilgileri", id: c.id, orders: (byCustomer.get(c.id) ?? []).length } },
    });
    if (!r.ok) {
      report.customers.skipped.push({ id: c.id, reason: r.error.code });
      continue;
    }
    if (!r.value.created) {
      report.customers.existing++;
      continue;
    }
    report.customers.created++;
    bump(s.stage);
    if (s.stage === "CONTACTED") {
      const st = await sp.changeLeadStage.execute({ leadId: r.value.lead.id, target: "CONTACTED", actor: ACTOR });
      if (!st.ok) report.customers.stageErrors.push({ id: c.id, reason: st.error.code });
      continue;
    }
    const st = await sp.changeLeadStage.execute({
      leadId: r.value.lead.id,
      target: s.stage,
      actor: ACTOR,
      qualificationAnswers: YES,
      value: s.value ?? (s.stage === "WON" ? { amount: 0, currency: "EUR" } : null),
      skipFollowUp: true, // geçmiş teklif: bugün takip aktivitesi açılmaz
    });
    if (!st.ok) report.customers.stageErrors.push({ id: c.id, reason: st.error.code });
  }

  // Talepler (Clients): gelen kutusuna NEW; siparişi varsa aynı kurallarla aşama alır.
  for (const k of [...snap.clients].sort((a, b) => a.id - b.id)) {
    const platformLeadId = `mysql:client:${k.id}`;
    const existing = await uow.run((r) => r.leads.findByPlatformId("import", platformLeadId));
    if (existing) {
      report.clients.existing++;
      continue;
    }
    const country = countryCodeFor(k.country, snap.countryNames);
    const email = clean(k.email) || null;
    const phone = normalizePhone(k.phone, null);
    if (!email && !phone) {
      report.clients.skipped.push({ id: k.id, reason: "lead.contact_required" });
      continue;
    }
    if (await personHasLead(email, phone)) {
      report.clients.skipped.push({ id: k.id, reason: "kişi müşteri listesinde zaten var" });
      continue;
    }
    const createdAt = k.createdAt ? new Date(k.createdAt) : new Date();
    clock.set(Number.isNaN(createdAt.getTime()) ? new Date() : createdAt);
    const s = stageFor(byClient.get(k.id) ?? []);
    const r = await createWithFallback({
      source: "import",
      platformLeadId,
      fullName: `${clean(k.firstName)} ${clean(k.lastName)}`.trim() || `Talep ${k.id}`,
      email,
      phone,
      country,
      city: clean(k.city),
      notes: clean(k.details),
      createdAt: clock.now(),
      assignedUserId: ownerOf(k.createdByUserId, s.userId),
      extraAnswers: { mysql: { table: "Clients", id: k.id, platform: k.platform, countryText: k.country } },
    });
    if (!r.ok) {
      report.clients.skipped.push({ id: k.id, reason: r.error.code });
      continue;
    }
    if (!r.value.created) {
      report.clients.existing++;
      continue;
    }
    report.clients.created++;
    if (s.stage === "CONTACTED") {
      bump("NEW");
      continue;
    }
    bump(s.stage);
    if (s.at) clock.set(s.at);
    const st = await sp.changeLeadStage.execute({
      leadId: r.value.lead.id,
      target: s.stage,
      actor: ACTOR,
      qualificationAnswers: YES,
      value: s.value ?? (s.stage === "WON" ? { amount: 0, currency: "EUR" } : null),
      skipFollowUp: true, // geçmiş teklif: bugün takip aktivitesi açılmaz
    });
    if (!st.ok) report.customers.stageErrors.push({ id: k.id, reason: st.error.code });
  }

  report.unknownOwners = [...unknown].sort();
  logger.info("mysql müşteri aktarımı bitti", {
    customers: report.customers.created,
    clients: report.clients.created,
    skipped: report.customers.skipped.length + report.clients.skipped.length,
  });
  return report;
}
