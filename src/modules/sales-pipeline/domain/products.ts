/**
 * Ürünler: yönetimdeki ürün listesi (katalog) ve lead'in istediği ürünler. Bütün ürünler aynı statüdedir ve adetle
 * girilir; kort, kapatma ya da aksesuar ayrımı yoktur. Katalog dışarıdan gelen ürün dosyasından (CSV) yüklenir; ürün
 * numarası dosyadaki numaradır ve değişmez. Dosyada artık olmayan ürün silinmez, "kullanımdan kalktı" olur: eski
 * lead'lerde görünür, yeni lead'e eklenemez.
 */
import { RuleError, err, ok, type Result } from "../../shared/kernel";

/** Adet 1–29. */
export const PRODUCT_QTY_MAX = 29;
/** Ürün adı uzunluk sınırı (dosyadan gelen ad). */
export const PRODUCT_NAME_MAX = 120;

/** Ürün listesindeki bir ürün. */
export interface CatalogProduct {
  /** Dosyadaki ürün numarası. */
  id: number;
  name: string;
  /** false = kullanımdan kalktı. */
  active: boolean;
  /** Dosyadaki sıra. */
  sortOrder: number;
}

/** Lead'in istediği bir ürün ve adedi. */
export interface LeadProduct {
  productId: number;
  qty: number;
}

/** Lead'in ürünleri; ürün numarasına göre sıralı, her ürün bir kez. Boş dizi = ürün girilmemiş. */
export type ProductPrefs = LeadProduct[];

export const emptyProducts = (): ProductPrefs => [];

export const hasAnyProduct = (p: readonly LeadProduct[]): boolean => p.length > 0;

/** Ürünün adedi; lead'de yoksa null. */
export const productQty = (p: readonly LeadProduct[], productId: number): number | null =>
  p.find((x) => x.productId === productId)?.qty ?? null;

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const toInt = (v: unknown): number =>
  typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v.trim()) ? Number(v.trim()) : NaN;

/**
 * PATCH / oluşturma girdisi → ürünler. Gönderilen dizi lead'in ürünlerinin tamamının yerini alır; `null` hepsini
 * temizler. Ürünün listede olup olmadığına burada bakılmaz (`checkCatalogRefs`).
 */
export function parseProductPrefs(raw: unknown): Result<ProductPrefs, RuleError> {
  if (raw === null || raw === undefined) return ok(emptyProducts());
  if (!Array.isArray(raw)) return err(new RuleError("product.invalid", "Ürünler okunamadı.", {}));
  const out: ProductPrefs = [];
  const seen = new Set<number>();
  for (const item of raw) {
    if (!isPlainObject(item)) return err(new RuleError("product.invalid", "Ürünler okunamadı.", {}));
    const productId = toInt(item["productId"]);
    if (!Number.isInteger(productId) || productId <= 0) {
      return err(new RuleError("product.invalid", "Ürün numarası geçersiz.", { productId: item["productId"] }));
    }
    if (seen.has(productId)) {
      return err(new RuleError("product.duplicate", "Aynı ürün iki kez girilmiş.", { productId }));
    }
    const qty = toInt(item["qty"]);
    if (!Number.isInteger(qty) || qty < 1 || qty > PRODUCT_QTY_MAX) {
      return err(
        new RuleError("product.qty_range", `Adet 1 ile ${PRODUCT_QTY_MAX} arasında tam sayı olmalı.`, {
          productId,
          value: item["qty"],
        }),
      );
    }
    seen.add(productId);
    out.push({ productId, qty });
  }
  return ok(out.sort((a, b) => a.productId - b.productId));
}

/**
 * Girilen ürünler listede mi: bilinmeyen ürün reddedilir; kullanımdan kalkmış ürün yalnız lead'de zaten varsa kalır
 * (adedi değişebilir), yeni eklenemez.
 */
export function checkCatalogRefs(
  next: readonly LeadProduct[],
  current: readonly LeadProduct[],
  catalog: readonly CatalogProduct[],
): Result<true, RuleError> {
  const byId = new Map(catalog.map((c) => [c.id, c]));
  for (const p of next) {
    const c = byId.get(p.productId);
    if (!c) return err(new RuleError("product.unknown", "Ürün listede yok.", { productId: p.productId }));
    if (!c.active && !current.some((x) => x.productId === p.productId)) {
      return err(
        new RuleError("product.inactive", "Bu ürün kullanımdan kalktı; yeni lead'e eklenemez.", {
          productId: p.productId,
        }),
      );
    }
  }
  return ok(true);
}

/* ---------------- ürün dosyası (CSV) ---------------- */

/** Dosyadan okunan satır: ürün numarası ve adı. */
export interface CatalogRow {
  id: number;
  name: string;
}

/** Ürün listesi güncellemesinin planı: dosya ile mevcut liste karşılaştırması. */
export interface CatalogImportPlan {
  /** Listede olmayan, eklenecek ürünler. */
  added: CatalogRow[];
  /** Adı değişecek ürünler. */
  renamed: { id: number; from: string; to: string }[];
  /** Dosyada olmadığı için kullanımdan kalkacak ürünler. */
  deactivated: CatalogRow[];
  /** Kullanımdan kalkmışken dosyada yeniden görünen ürünler. */
  reactivated: CatalogRow[];
  /** Değişmeyen ürün sayısı. */
  unchanged: number;
}

const cleanName = (s: string): string => s.normalize("NFC").replace(/\s+/g, " ").trim();

/** Dosya satırlarını doğrular: numara pozitif tam sayı, ad dolu, numara ve ad tekrarsız. */
export function parseCatalogRows(raw: readonly { id: unknown; name: unknown }[]): Result<CatalogRow[], RuleError> {
  if (!raw.length) return err(new RuleError("catalog.empty", "Dosyada ürün bulunamadı.", {}));
  const out: CatalogRow[] = [];
  const ids = new Set<number>();
  const names = new Set<string>();
  for (const [i, r] of raw.entries()) {
    const id = toInt(r.id);
    const name = cleanName(typeof r.name === "string" ? r.name : String(r.name ?? ""));
    if (!Number.isInteger(id) || id <= 0) {
      return err(new RuleError("catalog.bad_id", "Ürün numarası geçersiz.", { row: i + 2, value: r.id }));
    }
    if (!name || name.length > PRODUCT_NAME_MAX) {
      return err(new RuleError("catalog.bad_name", "Ürün adı boş ya da çok uzun.", { row: i + 2, id }));
    }
    if (ids.has(id)) return err(new RuleError("catalog.duplicate_id", "Aynı ürün numarası iki kez var.", { id }));
    const key = name.toLocaleLowerCase("tr");
    if (names.has(key)) return err(new RuleError("catalog.duplicate_name", "Aynı ürün adı iki kez var.", { name }));
    ids.add(id);
    names.add(key);
    out.push({ id, name });
  }
  return ok(out);
}

/** Dosya ile mevcut listeyi karşılaştırır; `skip` dosyadaki ama listeye alınmayacak yeni ürünlerdir. */
export function planCatalogImport(
  current: readonly CatalogProduct[],
  rows: readonly CatalogRow[],
  skip: readonly number[] = [],
): CatalogImportPlan {
  const byId = new Map(current.map((c) => [c.id, c]));
  const inFile = new Set(rows.map((r) => r.id));
  const plan: CatalogImportPlan = { added: [], renamed: [], deactivated: [], reactivated: [], unchanged: 0 };
  for (const r of rows) {
    const c = byId.get(r.id);
    if (!c) {
      if (!skip.includes(r.id)) plan.added.push(r);
      continue;
    }
    let same = true;
    if (c.name !== r.name) {
      plan.renamed.push({ id: r.id, from: c.name, to: r.name });
      same = false;
    }
    if (!c.active) {
      plan.reactivated.push(r);
      same = false;
    }
    if (same) plan.unchanged++;
  }
  for (const c of current) {
    if (c.active && !inFile.has(c.id)) plan.deactivated.push({ id: c.id, name: c.name });
  }
  return plan;
}

/** Ad → ürün (büyük/küçük harf ve boşluk farkı yok sayılır). Excel içe aktarımı bunu kullanır. */
export const productNameKey = (s: string): string => cleanName(s).toLocaleLowerCase("tr");
