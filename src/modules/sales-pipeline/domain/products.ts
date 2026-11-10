/**
 * Ürün tercihleri (Faz 7g, D4, ADR-0014): Excel P–U (kort ürünü ✔ + adet) ve V–Y (Kapatma ✔ + çatı ölçüsü).
 * Adet = tercih: "✔ var adet yok" ve "adet var ✔ yok" oluşamaz. Çatı alanı türetilir, saklanmaz.
 * `court_count` ürün satırlarından yazılmaz (§3.4); formdan gelen kesin sayı ayrı alandır.
 */
import { round2 } from "./numbers";

export const COURT_PRODUCTS = ["standard", "panoramic", "full_panoramic"] as const;
export type CourtProduct = (typeof COURT_PRODUCTS)[number];
/** Ekran ve rapor sırası (Excel): üç kort ürünü, sonra Kapatma. */
export const PRODUCT_CODES = [...COURT_PRODUCTS, "roof"] as const;
export type ProductCode = (typeof PRODUCT_CODES)[number];

/** Adet 1–29 (Excel veri doğrulaması + DB CHECK). */
export const PRODUCT_QTY_MAX = 29;

export interface ProductPrefs {
  /** null = tercih yok. */
  standard: number | null;
  panoramic: number | null;
  fullPanoramic: number | null;
  roof: { wanted: boolean; widthM: number | null; lengthM: number | null };
}

/** Boş tercih; dondurulmuştur (kopyalayarak kullanın). */
export const EMPTY_PRODUCTS: ProductPrefs = Object.freeze({
  standard: null,
  panoramic: null,
  fullPanoramic: null,
  roof: Object.freeze({ wanted: false, widthM: null, lengthM: null }),
});

const QTY_KEY: Readonly<Record<CourtProduct, "standard" | "panoramic" | "fullPanoramic">> = {
  standard: "standard",
  panoramic: "panoramic",
  full_panoramic: "fullPanoramic",
};

/** Kort ürününün adedi (null = tercih yok). */
export const productQty = (p: ProductPrefs, code: CourtProduct): number | null => p[QTY_KEY[code]];

export const courtTotal = (p: ProductPrefs): number => (p.standard ?? 0) + (p.panoramic ?? 0) + (p.fullPanoramic ?? 0);

/** Çatı alanı (Excel Y = W×X), iki ölçü de doluysa 2 ondalık; değilse null. */
export function roofAreaM2(p: ProductPrefs): number | null {
  const { widthM, lengthM } = p.roof;
  return widthM === null || lengthM === null ? null : round2(widthM * lengthM);
}

export const hasAnyProduct = (p: ProductPrefs): boolean => courtTotal(p) > 0 || p.roof.wanted;

export interface ProductSummaryItem {
  code: ProductCode;
  qty?: number;
  widthM?: number;
  lengthM?: number;
  areaM2?: number | null;
}

/** Gösterim sırası Excel'deki gibi: "2 Panoramic · Kapatma 20 × 10 m (200 m²)". Metin UI'da kurulur. */
export function productSummary(p: ProductPrefs): ProductSummaryItem[] {
  const out: ProductSummaryItem[] = [];
  for (const code of COURT_PRODUCTS) {
    const qty = productQty(p, code);
    if (qty !== null && qty > 0) out.push({ code, qty });
  }
  if (p.roof.wanted) {
    const roof: ProductSummaryItem = { code: "roof", areaM2: roofAreaM2(p) };
    if (p.roof.widthM !== null) roof.widthM = p.roof.widthM;
    if (p.roof.lengthM !== null) roof.lengthM = p.roof.lengthM;
    out.push(roof);
  }
  return out;
}
