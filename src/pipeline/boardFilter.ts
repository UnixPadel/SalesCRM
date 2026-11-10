/**
 * Pano filtreleri (Faz 6b, kaynak Faz 7): sorumlu · ülke · kaynak · takipsiz. Gerçek kaynak URL'dir (`#/pipeline?owner=me&country=TR&rotting=1`),
 * böylece bağlantı paylaşılabilir; son kullanılan filtre tarayıcıda da hatırlanır ve panoya parametresiz girince uygulanır.
 */
export interface BoardFilter {
  /** "" hepsi · "me" ben · "pool" ortak havuz · kullanıcı kimliği */
  owner: string;
  /** ISO 3166-1 alpha-2 ya da "" */
  country: string;
  /** Lead kaynağı (meta_form, google_form, web_form, manual, import) ya da "" */
  source: string;
  rotting: boolean;
}

export const SOURCES = ["meta_form", "google_form", "web_form", "manual", "import"] as const;
export const EMPTY_FILTER: BoardFilter = { owner: "", country: "", source: "", rotting: false };
const STORAGE_KEY = "unixcrm.v2.boardFilter";

export const isEmptyFilter = (f: BoardFilter) => !f.owner && !f.country && !f.source && !f.rotting;

export function filterFromParams(p: URLSearchParams): BoardFilter {
  const country = (p.get("country") ?? "").trim().toUpperCase();
  const source = (p.get("source") ?? "").trim();
  return {
    owner: (p.get("owner") ?? "").trim(),
    country: /^[A-Z]{2}$/.test(country) ? country : "",
    source: (SOURCES as readonly string[]).includes(source) ? source : "",
    rotting: p.get("rotting") === "1",
  };
}

export function filterToParams(f: BoardFilter): URLSearchParams {
  const p = new URLSearchParams();
  if (f.owner) p.set("owner", f.owner);
  if (f.country) p.set("country", f.country);
  if (f.source) p.set("source", f.source);
  if (f.rotting) p.set("rotting", "1");
  return p;
}

/** URL'de filtre varsa o; yoksa hatırlanan. */
export function hasFilterParams(p: URLSearchParams): boolean {
  return p.has("owner") || p.has("country") || p.has("source") || p.has("rotting");
}

export function rememberFilter(f: BoardFilter): void {
  try {
    if (isEmptyFilter(f)) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(f));
  } catch {
    /* özel pencere ya da depolama kapalı: hatırlamadan devam */
  }
}

export function recallFilter(): BoardFilter {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_FILTER;
    const v = JSON.parse(raw) as Partial<BoardFilter>;
    return filterFromParams(filterToParams({ ...EMPTY_FILTER, ...v }));
  } catch {
    return EMPTY_FILTER;
  }
}
