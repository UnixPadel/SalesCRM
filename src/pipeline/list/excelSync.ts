/**
 * Lead listesinin Excel gidiş-dönüşü: dışa aktarılan dosyanın sütun düzeni, içe aktarılan dosyanın bu düzenle
 * birebir karşılaştırılması ve değişen hücrelerden güncelleme planı. Saf: React, dosya ve ağ yok.
 *
 * Düzen sabittir: listenin bütün sütunları, liste sırasıyla, sonda satırı lead ile eşleştiren "CRM kimliği".
 * Ekrandaki grup katlama ve sütun gizleme düzeni değiştirmez; yoksa bir görünümde alınan dosya ötekinde okunmazdı.
 * Yalnız elle girilen sütunlar (`EDITS`) alınır; temas kayıtlarından türeyen sütunlar okunmaz.
 *
 * "Değişti" demek, hücrenin **Excel'de** değiştirilmiş olması demektir: dosya, dışa aktarım anındaki hücre
 * metinlerini gizli bir sayfada taşır (`baseline`); o metinle aynı kalan hücreye dokunulmaz. Böylece eski bir
 * dosya, o arada programda yapılan değişiklikleri geri almaz. Gizli sayfa yoksa (dosya başka bir araçtan geçmişse)
 * hücre programdaki şimdiki değerle karşılaştırılır ve sonradan güncellenen lead'ler önizlemede işaretlenir.
 */
import type { LeadListDto, ProductPrefsDto } from "../../modules/sales-pipeline/api/dto";
import { COLUMNS, GROUPS, type ColumnDef, type Ctx } from "./listColumns";

export const ID_LABEL = "xl.col.id";

/** Dosyadaki sütunlar (kimlik sütunu hariç). */
export const EXCEL_COLUMNS: readonly ColumnDef[] = GROUPS.flatMap((g) =>
  COLUMNS.filter((c) => c.group === g.id && !c.noCsv),
);

export const excelHeader = (t: Ctx["t"]): string[] => [...EXCEL_COLUMNS.map((c) => t(c.label)), t(ID_LABEL)];

/* ---------------- dışa aktarım ---------------- */

export type CellValue = string | number | Date;

const DATE_COLS: readonly string[] = ["createdAt", "last", "first"];
const NUMBER_COLS: readonly string[] = ["count", "warn"];

/** Tarih ve sayı sütunları Excel'de gerçek tarih ve sayı olur (sıralanır, toplanır); diğerleri metin. */
function cellValue(col: ColumnDef, text: string): CellValue {
  if (DATE_COLS.includes(col.id)) {
    const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(text);
    if (m) return new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])));
  }
  if (NUMBER_COLS.includes(col.id) && /^\d+$/.test(text)) return Number(text);
  return text;
}

/** Satırın hücre metinleri (sonda kimlik): gizli sayfaya yazılır, okunan hücreler de bu metinlerle karşılaştırılır. */
export const excelTexts = (l: LeadListDto, c: Ctx): string[] => [...EXCEL_COLUMNS.map((col) => col.csv(l, c)), l.id];

export const excelRow = (l: LeadListDto, c: Ctx): CellValue[] =>
  excelTexts(l, c).map((text, i) => (EXCEL_COLUMNS[i] ? cellValue(EXCEL_COLUMNS[i], text) : text));

/** Okunan hücre → dışa aktarımdaki metin (`excelFile` tarih ve sayıyı bununla metne çevirir). */
export function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) {
    const p = (n: number) => String(n).padStart(2, "0");
    return Number.isNaN(v.getTime()) ? "" : `${p(v.getUTCDate())}.${p(v.getUTCMonth() + 1)}.${v.getUTCFullYear()}`;
  }
  return clean(String(v));
}

/* ---------------- düzen denetimi ---------------- */

/** Göze görünmeyen farklar (bölünemez boşluk, baştaki/sondaki boşluk, Unicode bileşimi) fark sayılmaz. */
export const clean = (s: string): string =>
  s
    .normalize("NFC")
    .replace(/\u00a0/g, " ")
    .replace(/\r\n?/g, "\n")
    .trim();

export interface LayoutMismatch {
  expected: number;
  actual: number;
  /** İlk farklı sütun (1'den başlar); yalnız sayı farklıysa null. */
  at: { n: number; expected: string; actual: string } | null;
}

/** Başlık satırı beklenenle kelimesi kelimesine, aynı sırada ve aynı sayıda mı? Aynıysa null. */
export function layoutMismatch(expected: readonly string[], actual: readonly string[]): LayoutMismatch | null {
  const n = Math.max(expected.length, actual.length);
  for (let i = 0; i < n; i++) {
    const e = clean(expected[i] ?? "");
    const a = clean(actual[i] ?? "");
    if (e !== a) {
      const both = i < expected.length && i < actual.length;
      return {
        expected: expected.length,
        actual: actual.length,
        at: both ? { n: i + 1, expected: e, actual: a } : null,
      };
    }
  }
  return null;
}

/* ---------------- içe aktarım planı ---------------- */

/** Bir lead'e gidecek çağrılar: her parça ayrı uç noktadır (alanlar, kişi kimliği, müşteri durumu, sorumlu). */
export type PatchPart = "fields" | "contact" | "status" | "owner";

export interface LeadPatch {
  fields: Record<string, unknown>;
  contact: { fullName?: string; email?: string | null; phone?: string | null };
  /** undefined = değişmedi. */
  status?: string | null;
  owner?: string | null;
}

export interface Change {
  colId: string;
  label: string;
  part: PatchPart;
  from: string;
  to: string;
  /** Aynı bilgi dosya dışa aktarıldıktan sonra programda da değişti; uygulanırsa Excel'deki değer geçerli olur. */
  conflict: boolean;
}

export interface PlannedLead {
  id: string;
  name: string;
  /** Değişikliklerinden en az biri çakışıyor (`Change.conflict`). */
  stale: boolean;
  patch: LeadPatch;
  changes: Change[];
}

export interface InvalidCell {
  row: number;
  label: string;
  value: string;
  /** Çeviri anahtarı (`xl.bad.*`). */
  reason: string;
  vars?: Record<string, string | number>;
}

export interface ImportPlan {
  leads: PlannedLead[];
  changeCount: number;
  staleCount: number;
  invalid: InvalidCell[];
  /** Atlanan satırlar: kimliği yok / programda karşılığı yok / aynı lead ikinci kez. */
  noId: number;
  unknown: number;
  duplicate: number;
}

export interface ParseCtx {
  /** Dosyanın dilinde metin üreten bağlam (başlıklar hangi dildeyse değerler de o dildedir). */
  ctx: Ctx;
  owners: readonly { id: string; name: string }[];
  ref: {
    customerStatuses: readonly string[];
    installSites: readonly string[];
    installTimelines: readonly string[];
    customerProfiles: readonly string[];
    courtCountBands: readonly string[];
    productQtyMax: number;
    /** Ürün listesi (kullanımdan kalkanlar dahil). */
    products: readonly { id: number; name: string; active: boolean }[];
  };
  /** Dışa aktarım anındaki hücre metinleri (kimlik → satır); dosyada gizli sayfa yoksa null. */
  baseline: ReadonlyMap<string, readonly string[]> | null;
  /** Dosyanın dışa aktarıldığı an (ms); bilinmiyorsa null. `baseline` yokken çakışma buna göre tahmin edilir. */
  exportedAt: number | null;
}

type Bad = { ok: false; reason: string; vars?: Record<string, string | number> };
type Parsed<V> = { ok: true; value: V } | Bad;
const good = <V>(value: V): Parsed<V> => ({ ok: true, value });
const bad = (reason: string, vars?: Record<string, string | number>): Bad => ({
  ok: false,
  reason,
  ...(vars ? { vars } : {}),
});

/** Seçenek ve ad eşleştirmesi büyük/küçük harfe bakmaz (Türkçe İ/ı dahil). */
const fold = (s: string): string =>
  clean(s)
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("tr")
    .replace(/ı/g, "i")
    .replace(/i\u0307/g, "i");
const digits = (s: string | null): string => (s ?? "").replace(/\D/g, "");

interface Edit<V> {
  part: PatchPart;
  parse(text: string, p: ParseCtx, l: LeadListDto): Parsed<V>;
  current(l: LeadListDto): V;
  set(patch: LeadPatch, value: V, l: LeadListDto): void;
  /** Önizlemede gösterilecek yeni değer; yoksa hücredeki metin. */
  show?(value: V, p: ParseCtx): string;
}
const edit = <V>(e: Edit<V>): Edit<unknown> => e as unknown as Edit<unknown>;

/** Etiketi yazılan seçeneğin kodu ("" → null). */
function option(
  text: string,
  codes: readonly string[],
  label: (code: string) => string,
  ...emptyLabels: string[]
): Parsed<string | null> {
  if (!text || emptyLabels.some((x) => fold(x) === fold(text))) return good(null);
  const want = fold(text);
  const hit = codes.find((code) => fold(label(code)) === want || fold(code) === want);
  return hit ? good(hit) : bad("xl.bad.option");
}

function countryCode(text: string, c: Ctx): string | null {
  const tagged = /\(([A-Za-z]{2})\)$/.exec(text);
  if (tagged) return tagged[1]!.toUpperCase();
  if (/^[A-Za-z]{2}$/.test(text)) return text.toUpperCase();
  const want = fold(text);
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  for (const x of A) for (const y of A) if (fold(c.countryName(x + y)) === want) return x + y;
  return null;
}

/**
 * Ürünler hücresi: "2 Standard Padel Court; 1 Padel Court Cover". Ürünler noktalı virgül ya da satır sonuyla ayrılır;
 * adet yazılmazsa 1 sayılır ("2 x Ad" ve "2 × Ad" de olur). Ad ürün listesindekiyle aynı olmalı (büyük/küçük harf ve
 * fazla boşluk önemsiz). Kullanımdan kalkmış ürün yalnız lead'de zaten varsa kalabilir.
 */
function parseProducts(text: string, p: ParseCtx, l: LeadListDto): Parsed<ProductPrefsDto> {
  if (!text || text === "—") return good([]);
  const byName = new Map(p.ref.products.map((x) => [fold(x.name), x]));
  const out: ProductPrefsDto = [];
  for (const raw of text.split(/[;\n]/)) {
    const item = raw.trim();
    if (!item) continue;
    const m = /^(\d+)\s*(?:[x×*]\s*)?(.+)$/i.exec(item);
    const qty = m ? Number(m[1]) : 1;
    const name = (m ? m[2]! : item).trim();
    const hit = byName.get(fold(name));
    if (!hit) return bad("xl.bad.product", { name });
    if (!hit.active && !l.products.some((x) => x.productId === hit.id)) {
      return bad("xl.bad.productInactive", { name: hit.name });
    }
    if (!Number.isInteger(qty) || qty < 1 || qty > p.ref.productQtyMax) {
      return bad("xl.bad.qty", { max: p.ref.productQtyMax });
    }
    if (out.some((x) => x.productId === hit.id)) return bad("xl.bad.productTwice", { name: hit.name });
    out.push({ productId: hit.id, qty });
  }
  return good(out.sort((a, b) => a.productId - b.productId));
}

const answer = (
  field: "installSite" | "installTimeline" | "customerProfile" | "courtCountBand",
  codes: (p: ParseCtx) => readonly string[],
  key: string,
) =>
  edit<string | null>({
    part: "fields",
    parse: (text, p) => option(text, codes(p), (code) => p.ctx.t(`${key}.${code}`), "—"),
    current: (l) => l[field],
    set: (patch, v) => {
      patch.fields[field] = v;
    },
    show: (v, p) => (v ? p.ctx.t(`${key}.${v}`) : ""),
  });

/** İçe alınan sütunlar: programda elle girilen bilgiler. */
const EDITS: Record<string, Edit<unknown>> = {
  name: edit<string>({
    part: "contact",
    parse: (text) => (text ? good(text) : bad("xl.bad.required")),
    current: (l) => clean(l.fullName),
    set: (patch, v) => {
      patch.contact.fullName = v;
    },
  }),
  phone: edit<string | null>({
    part: "contact",
    // Excel "+90…" yazılan numarayı sayıya çevirip "+"yı atabilir: rakamları aynıysa numara değişmemiştir.
    parse: (text, _p, l) =>
      !text ? good(null) : digits(text) === digits(l.phoneE164) ? good(l.phoneE164) : good(text),
    current: (l) => l.phoneE164,
    set: (patch, v) => {
      patch.contact.phone = v;
    },
  }),
  email: edit<string | null>({
    part: "contact",
    parse: (text, _p, l) =>
      !text ? good(null) : text.toLowerCase() === (l.email ?? "").toLowerCase() ? good(l.email) : good(text),
    current: (l) => l.email,
    set: (patch, v) => {
      patch.contact.email = v;
    },
  }),
  country: edit<string | null>({
    part: "fields",
    parse: (text, p) => {
      if (!text || text === "—") return good(null);
      const code = countryCode(text, p.ctx);
      return code ? good(code) : bad("xl.bad.country");
    },
    current: (l) => l.country,
    set: (patch, v) => {
      patch.fields["country"] = v;
    },
    show: (v, p) => (v ? `${p.ctx.countryName(v)} (${v})` : ""),
  }),
  owner: edit<string | null>({
    part: "owner",
    parse: (text, p) => {
      if (!text || fold(text) === fold(p.ctx.t("common.pool"))) return good(null);
      const hits = p.owners.filter((o) => fold(o.name) === fold(text));
      return hits.length === 1 ? good(hits[0]!.id) : bad("xl.bad.owner");
    },
    current: (l) => l.assignedUserId,
    set: (patch, v) => {
      patch.owner = v;
    },
    show: (v, p) => (v ? p.ctx.nameOf(v) : p.ctx.t("common.pool")),
  }),
  status: edit<string | null>({
    part: "status",
    parse: (text, p) =>
      option(text, p.ref.customerStatuses, (code) => p.ctx.t(`customerStatus.${code}`), p.ctx.t("customerStatus.none")),
    current: (l) => l.customerStatus,
    set: (patch, v) => {
      patch.status = v;
    },
    show: (v, p) => (v ? p.ctx.t(`customerStatus.${v}`) : ""),
  }),
  products: edit<ProductPrefsDto>({
    part: "fields",
    parse: parseProducts,
    current: (l) => l.products,
    set: (patch, v) => {
      patch.fields["products"] = v;
    },
    show: (v, p) => v.map((x) => `${x.qty} ${p.ctx.productName(x.productId)}`).join("; "),
  }),
  note: edit<string>({
    part: "fields",
    parse: (text) => good(text),
    current: (l) => clean(l.notes),
    set: (patch, v) => {
      patch.fields["notes"] = v;
    },
  }),
  site: answer("installSite", (p) => p.ref.installSites, "answer.site"),
  timeline: answer("installTimeline", (p) => p.ref.installTimelines, "answer.timeline"),
  profile: answer("customerProfile", (p) => p.ref.customerProfiles, "answer.profile"),
  band: answer("courtCountBand", (p) => p.ref.courtCountBands, "answer.band"),
};

export const isEditable = (colId: string): boolean => colId in EDITS;

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Satırların sonundaki hücre lead kimliğidir. */
export const rowLeadId = (cells: readonly string[]): string => clean(cells[EXCEL_COLUMNS.length] ?? "");

/**
 * Dosya satırlarından güncelleme planı. `rows[].n` Excel'deki satır numarasıdır (hata bildirimi için).
 * Excel'de değiştirilmemiş ya da programdaki değerle aynı olan hücreye dokunulmaz; okunamayan hücre atlanır ve
 * bildirilir, satırın geri kalanı alınır.
 */
export function planImport(
  rows: readonly { n: number; cells: readonly string[] }[],
  leads: ReadonlyMap<string, LeadListDto>,
  p: ParseCtx,
): ImportPlan {
  const plan: ImportPlan = { leads: [], changeCount: 0, staleCount: 0, invalid: [], noId: 0, unknown: 0, duplicate: 0 };
  const seen = new Set<string>();
  for (const row of rows) {
    if (row.cells.every((x) => !clean(x))) continue;
    const id = rowLeadId(row.cells);
    if (!id) {
      plan.noId++;
      continue;
    }
    const lead = leads.get(id);
    if (!lead) {
      plan.unknown++;
      continue;
    }
    if (seen.has(id)) {
      plan.duplicate++;
      continue;
    }
    seen.add(id);
    const patch: LeadPatch = { fields: {}, contact: {} };
    const changes: Change[] = [];
    const exported = p.baseline?.get(id);
    const updatedSince = p.exportedAt !== null && new Date(lead.updatedAt).getTime() > p.exportedAt;
    EXCEL_COLUMNS.forEach((col, i) => {
      const e = EDITS[col.id];
      if (!e) return;
      const text = clean(row.cells[i] ?? "");
      const base = exported ? clean(exported[i] ?? "") : null;
      if (text === base) return;
      const from = clean(col.csv(lead, p.ctx));
      if (text === from) return;
      const label = p.ctx.t(col.label);
      const parsed = e.parse(text, p, lead);
      if (!parsed.ok) {
        plan.invalid.push({
          row: row.n,
          label,
          value: text,
          reason: parsed.reason,
          ...(parsed.vars ? { vars: parsed.vars } : {}),
        });
        return;
      }
      if (same(parsed.value, e.current(lead))) return;
      e.set(patch, parsed.value, lead);
      changes.push({
        colId: col.id,
        label,
        part: e.part,
        from,
        to: e.show ? e.show(parsed.value, p) : text,
        conflict: base === null ? updatedSince : base !== from,
      });
    });
    if (!changes.length) continue;
    const stale = changes.some((c) => c.conflict);
    plan.leads.push({ id, name: lead.fullName, stale, patch, changes });
    plan.changeCount += changes.length;
    if (stale) plan.staleCount++;
  }
  return plan;
}
