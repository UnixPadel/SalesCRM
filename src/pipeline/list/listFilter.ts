/**
 * Lead listesi süzgeci (Faz 7g, iş emri §5.4): URL ↔ süzgeç, Excel otomatik süzgecinin sayılı değer listesi,
 * kararlı sıralama. Sunucuya yalnız türetilen bilgiye bakan süzgeçler gider (`contact`, `hot`, `warning`, `scope`,
 * `campaign`, `q`); sütun süzgeçleri (sorumlu, ülke, kaynak, aşama ve `f_*`) yüklenen kümede uygulanır ki başlık
 * menüsü bütün değerleri sayabilsin (Excel gibi). Saf: React yok.
 */
import type { LeadListDto } from "../../modules/sales-pipeline/api/dto";
import { COLUMNS, columnById, type ColumnDef, type Ctx } from "./listColumns";

export const SERVER_KEYS = ["contact", "hot", "warning", "rotting", "scope", "campaign", "includeTest"] as const;
/** Arama kutusu (ad, telefon, e-posta, Excel No): yüklenen kümede. */
export const SEARCH_KEY = "q";
/** Süzgeç sayılmayan görünüm anahtarları (filtre hatırlama ve sayaç bunları yok sayar). */
export const VIEW_KEYS = ["sort", "page", "size", "tab", "from", "fromLabel", "view"] as const;

export function serverParams(p: URLSearchParams): URLSearchParams {
  const out = new URLSearchParams();
  for (const k of SERVER_KEYS) {
    const v = p.get(k);
    if (v) out.set(k, v);
  }
  out.set("limit", "2000");
  return out;
}

export interface ColumnFilter {
  values?: ReadonlySet<string>;
  text?: string;
}

/** URL → sütun süzgeçleri. `owner=me` oturumdaki kişidir. */
export function clientFilters(p: URLSearchParams, meId: string | null): Map<string, ColumnFilter> {
  const out = new Map<string, ColumnFilter>();
  for (const col of COLUMNS) {
    const raw = p.get(col.param);
    if (!raw) continue;
    if (col.kind === "text") out.set(col.id, { text: raw.toLocaleLowerCase("tr") });
    else {
      const vals = raw
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean)
        .map((v) => (col.id === "owner" && v === "me" && meId ? meId : col.id === "country" ? v.toUpperCase() : v));
      if (vals.length) out.set(col.id, { values: new Set(vals) });
    }
  }
  return out;
}

export function matches(l: LeadListDto, col: ColumnDef, f: ColumnFilter, c: Ctx): boolean {
  if (f.text !== undefined) return (col.text?.(l, c) ?? "").toLocaleLowerCase("tr").includes(f.text);
  if (f.values) {
    // Lead tarihi aralığı ("2026-10-01..2026-10-31", rapordan): takvim günüyle, uçlar dahil.
    if (col.id === "createdAt") {
      const ranges = [...f.values].filter((v) => v.includes(".."));
      if (ranges.length) {
        const d = c.day(l.createdAt);
        return ranges.some((r) => {
          const [from, to] = r.split("..");
          return (!from || d >= from) && (!to || d <= to);
        });
      }
    }
    return (col.values?.(l, c) ?? []).some((v) => f.values!.has(v));
  }
  return true;
}

/** Süzgeçleri uygular; `except` başlık menüsünde o sütunun kendi süzgecini dışarıda bırakır (Excel davranışı). */
export function applyFilters(
  rows: readonly LeadListDto[],
  filters: ReadonlyMap<string, ColumnFilter>,
  c: Ctx,
  except?: string,
): LeadListDto[] {
  const active = [...filters].filter(([id]) => id !== except);
  if (!active.length) return [...rows];
  return rows.filter((l) => active.every(([id, f]) => matches(l, columnById.get(id)!, f, c)));
}

export interface ValueCount {
  value: string;
  label: string;
  count: number;
}

/** Başlık menüsünün sayılı değer listesi ("✔ Evet (91)"). */
export function valueCounts(rows: readonly LeadListDto[], col: ColumnDef, c: Ctx): ValueCount[] {
  const by = new Map<string, number>();
  for (const l of rows) for (const v of col.values?.(l, c) ?? []) by.set(v, (by.get(v) ?? 0) + 1);
  const out = [...by].map(([value, count]) => ({
    value,
    count,
    label: col.valueLabel ? col.valueLabel(value, c) : value,
  }));
  if (col.order) out.sort((a, b) => idx(col.order!, a.value) - idx(col.order!, b.value));
  else if (col.id === "createdAt" || col.id === "last" || col.id === "first")
    out.sort((a, b) => b.value.localeCompare(a.value));
  else out.sort((a, b) => a.label.localeCompare(b.label, "tr"));
  return out;
}
const idx = (order: string[], v: string) => (order.includes(v) ? order.indexOf(v) : order.length);

/** `sort` = "-createdAt" | "name" | …; ikincil sıra her zaman oluşturma azalan (kararlı). */
export function sortRows(rows: readonly LeadListDto[], sort: string | null, c: Ctx): LeadListDto[] {
  const key = sort || "-createdAt";
  const desc = key.startsWith("-");
  const col = columnById.get(desc ? key.slice(1) : key) ?? columnById.get("createdAt")!;
  const val = (l: LeadListDto) => col.sort(l, c);
  return [...rows].sort((a, b) => {
    const x = val(a);
    const y = val(b);
    const d = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "tr");
    return (desc ? -d : d) || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id);
  });
}

/** Etkin süzgeç sayısı (sunucu + sütun); görünüm anahtarları sayılmaz. */
export function activeFilterCount(p: URLSearchParams): number {
  let n = 0;
  for (const [k, v] of p) {
    if (!v || (VIEW_KEYS as readonly string[]).includes(k)) continue;
    if ((SERVER_KEYS as readonly string[]).includes(k) || k === SEARCH_KEY || COLUMNS.some((c) => c.param === k)) n++;
  }
  return n;
}

/** Filtre hatırlama [U-B1a]: URL'de süzgeç ya da `from` varsa hatırlanan süzgeç uygulanmaz. */
export const hasFilterParams = (p: URLSearchParams): boolean => activeFilterCount(p) > 0 || p.has("from");

/** Arama kutusu: ad, telefon, e-posta, firma ve Excel No içinde (küçük harf, tr). */
export function searchRows(rows: readonly LeadListDto[], q: string | null): LeadListDto[] {
  const s = (q ?? "").trim().toLocaleLowerCase("tr");
  if (!s) return [...rows];
  return rows.filter((l) =>
    [l.fullName, l.email ?? "", l.phoneE164 ?? "", l.company, String(l.extraAnswers?.["excel_no"] ?? "")]
      .join(" ")
      .toLocaleLowerCase("tr")
      .includes(s),
  );
}

/** Süzgeçleri temizlenmiş parametreler (görünüm anahtarları kalır, `from` düşer). */
export function clearFilters(p: URLSearchParams): URLSearchParams {
  const out = new URLSearchParams();
  for (const k of ["sort", "size"] as const) {
    const v = p.get(k);
    if (v) out.set(k, v);
  }
  return out;
}
