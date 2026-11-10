/**
 * Ürün tercihleri (Faz 7g, D4, ADR-0014): Excel P–U (kort ürünü ✔ + adet) ve V–Y (Kapatma ✔ + çatı ölçüsü).
 * Adet = tercih: "✔ var adet yok" ve "adet var ✔ yok" oluşamaz. Çatı alanı türetilir, saklanmaz.
 * `court_count` ürün satırlarından yazılmaz (§3.4); formdan gelen kesin sayı ayrı alandır.
 */
import { RuleError, err, ok, type Result } from "../../shared/kernel";
import { round2 } from "./numbers";

export const COURT_PRODUCTS = ["standard", "panoramic", "full_panoramic"] as const;
export type CourtProduct = (typeof COURT_PRODUCTS)[number];
/** Ekran ve rapor sırası (Excel): üç kort ürünü, sonra Kapatma. */
export const PRODUCT_CODES = [...COURT_PRODUCTS, "roof"] as const;
export type ProductCode = (typeof PRODUCT_CODES)[number];

/** Adet 1–29 (Excel veri doğrulaması + DB CHECK). */
export const PRODUCT_QTY_MAX = 29;
/** Çatı ölçüsü üst sınırı, metre (DB `numeric(5,2)`); alt sınır 0'dan büyük. */
export const ROOF_SIZE_MAX_M = 999.99;

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

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const blank = (v: unknown): boolean => v === null || v === undefined || (typeof v === "string" && v.trim() === "");

function parseQty(raw: unknown, product: CourtProduct): Result<number | null, RuleError> {
  if (blank(raw)) return ok(null);
  const n = typeof raw === "number" ? raw : typeof raw === "string" && /^\d+$/.test(raw.trim()) ? Number(raw) : NaN;
  if (!Number.isInteger(n) || n < 1 || n > PRODUCT_QTY_MAX) {
    return err(
      new RuleError("product.qty_range", `Adet 1 ile ${PRODUCT_QTY_MAX} arasında tam sayı olmalı.`, {
        product,
        value: raw,
      }),
    );
  }
  return ok(n);
}

/** Ölçü: sayı ya da "10,5" / "10.5"; 2 ondalığa yuvarlanır, sonra 0 < x ≤ 999,99 aranır (DB CHECK ile aynı). */
function parseSize(raw: unknown, field: "widthM" | "lengthM"): Result<number | null, RuleError> {
  if (blank(raw)) return ok(null);
  const text = typeof raw === "string" ? raw.trim().replace(",", ".") : null;
  const n = typeof raw === "number" ? raw : text !== null && /^\d+(\.\d+)?$/.test(text) ? Number(text) : NaN;
  const x = Number.isFinite(n) ? round2(n) : NaN;
  if (!(x > 0 && x <= ROOF_SIZE_MAX_M)) {
    return err(
      new RuleError("product.roof_size", "Çatı ölçüsü 0'dan büyük ve en fazla 999,99 m olmalı.", {
        field,
        value: raw,
      }),
    );
  }
  return ok(x);
}

/**
 * PATCH / oluşturma girdisi → ürün tercihleri. Değiştirme anlamı: eksik anahtar = null/false (gönderilen nesne
 * bütün tercihin yerini alır); `null` = hepsini temizle. Kapatma işaretsizken ölçü reddedilir (arayüz ölçü
 * yazılınca Kapatma'yı işaretler; DB `leads_roof_dims_need_roof`).
 */
export function parseProductPrefs(raw: unknown): Result<ProductPrefs, RuleError> {
  if (raw === null || raw === undefined) return ok({ ...EMPTY_PRODUCTS, roof: { ...EMPTY_PRODUCTS.roof } });
  const roofRaw = isPlainObject(raw) ? (raw.roof ?? {}) : null;
  if (!isPlainObject(raw) || !isPlainObject(roofRaw)) {
    return err(new RuleError("product.invalid", "Ürün tercihleri okunamadı.", {}));
  }
  const wanted = roofRaw.wanted ?? false;
  if (typeof wanted !== "boolean") {
    return err(new RuleError("product.invalid", "Ürün tercihleri okunamadı.", { field: "roof.wanted" }));
  }
  const qty: Partial<Record<CourtProduct, number | null>> = {};
  for (const code of COURT_PRODUCTS) {
    const r = parseQty(raw[QTY_KEY[code]], code);
    if (!r.ok) return r;
    qty[code] = r.value;
  }
  const widthM = parseSize(roofRaw.widthM, "widthM");
  if (!widthM.ok) return widthM;
  const lengthM = parseSize(roofRaw.lengthM, "lengthM");
  if (!lengthM.ok) return lengthM;
  if (!wanted && (widthM.value !== null || lengthM.value !== null)) {
    return err(
      new RuleError("product.roof_dims_without_roof", "Çatı ölçüsü için Kapatma'yı işaretleyin.", {
        widthM: widthM.value,
        lengthM: lengthM.value,
      }),
    );
  }
  return ok({
    standard: qty.standard ?? null,
    panoramic: qty.panoramic ?? null,
    fullPanoramic: qty.full_panoramic ?? null,
    roof: { wanted, widthM: widthM.value, lengthM: lengthM.value },
  });
}
