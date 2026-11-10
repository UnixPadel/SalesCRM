/**
 * Pano filtreleri (Faz 6b, kaynak Faz 7, hızlı çipler Faz 7g): sorumlu · ülke · kaynak · takipsiz · hiç ulaşılmamış ·
 * sıcak · uyarılı. Gerçek kaynak URL'dir (`#/pipeline?owner=me&country=TR&rotting=1&contact=never`), böylece bağlantı
 * paylaşılabilir; son kullanılan filtre tarayıcıda da hatırlanır ve panoya parametresiz girince uygulanır.
 */
export interface BoardFilter {
  /** "" hepsi · "me" ben · "pool" ortak havuz · kullanıcı kimliği */
  owner: string;
  /** ISO 3166-1 alpha-2 ya da "" */
  country: string;
  /** Lead kaynağı (meta_form, google_form, web_form, manual, import) ya da "" */
  source: string;
  rotting: boolean;
  /** Faz 7g: hiç ulaşılmamış (temas kaydı yok, eski kayıt değil). */
  never: boolean;
  /** Faz 7g: kurulumu 3 ay içinde, açık aşamada. */
  hot: boolean;
  /** Faz 7g: kontrol edilmemiş veri uyarısı (yalnız yönetici). */
  warning: boolean;
}

export const SOURCES = ["meta_form", "google_form", "web_form", "manual", "import"] as const;
export const EMPTY_FILTER: BoardFilter = {
  owner: "",
  country: "",
  source: "",
  rotting: false,
  never: false,
  hot: false,
  warning: false,
};
const STORAGE_KEY = "unixcrm.v2.boardFilter";

/** Etkin filtre sayısı ("3 filtre · Filtreleri temizle"). */
export const filterCount = (f: BoardFilter) =>
  [f.owner, f.country, f.source, f.rotting, f.never, f.hot, f.warning].filter(Boolean).length;
export const isEmptyFilter = (f: BoardFilter) => filterCount(f) === 0;

export function filterFromParams(p: URLSearchParams): BoardFilter {
  const country = (p.get("country") ?? "").trim().toUpperCase();
  const source = (p.get("source") ?? "").trim();
  return {
    owner: (p.get("owner") ?? "").trim(),
    country: /^[A-Z]{2}$/.test(country) ? country : "",
    source: (SOURCES as readonly string[]).includes(source) ? source : "",
    rotting: p.get("rotting") === "1",
    never: p.get("contact") === "never",
    hot: p.get("hot") === "1",
    warning: p.get("warning") === "1",
  };
}

export function filterToParams(f: BoardFilter): URLSearchParams {
  const p = new URLSearchParams();
  if (f.owner) p.set("owner", f.owner);
  if (f.country) p.set("country", f.country);
  if (f.source) p.set("source", f.source);
  if (f.rotting) p.set("rotting", "1");
  if (f.never) p.set("contact", "never");
  if (f.hot) p.set("hot", "1");
  if (f.warning) p.set("warning", "1");
  return p;
}

/** URL'de filtre ya da `from` varsa hatırlanan uygulanmaz (görünüm anahtarları sayılmaz) [U-B1a]. */
export function hasFilterParams(p: URLSearchParams): boolean {
  return ["owner", "country", "source", "rotting", "contact", "hot", "warning", "from"].some((k) => p.has(k));
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
