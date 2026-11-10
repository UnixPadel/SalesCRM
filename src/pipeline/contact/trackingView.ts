/**
 * Satış takip bilgisinin ortak metinleri (Faz 7g): ürün özeti, kort satırı, son temas, kanal ve uyarı metinleri.
 * Lead sayfası, liste, pano kartı ve CSV aynı fonksiyonları kullanır. Saf: `t` çevirmeni dışarıdan gelir.
 */
import type { DataWarningDto, LeadListDto, ProductPrefsDto } from "../../modules/sales-pipeline/api/dto";

export type T = (key: string, vars?: Record<string, string | number>) => string;

const num = (n: number, lang: string) =>
  n.toLocaleString(lang === "tr" ? "tr-TR" : "en-GB", { maximumFractionDigits: 2 });

export function roofArea(p: ProductPrefsDto): number | null {
  return p.roof.widthM !== null && p.roof.lengthM !== null
    ? Math.round(p.roof.widthM * p.roof.lengthM * 100) / 100
    : null;
}

/** "2 Panoramic · Kapatma 20 × 10 m (200 m²)"; "×" adet için kullanılmaz [U-M3]. Boşsa "". */
export function productLine(p: ProductPrefsDto, t: T, lang = "tr", short = false): string {
  const parts: string[] = [];
  if (p.standard) parts.push(`${p.standard} ${t("product.standard")}`);
  if (p.panoramic) parts.push(`${p.panoramic} ${t("product.panoramic")}`);
  if (p.fullPanoramic) parts.push(`${p.fullPanoramic} ${t("product.full_panoramic")}`);
  if (p.roof.wanted) {
    const area = roofArea(p);
    // "Kapatma (çatı)" → "Kapatma" (ürün özetinde kısa ad).
    const name = t("product.roof").split(" (")[0]!;
    if (area === null) parts.push(t("product.roofNoSize"));
    else if (short) parts.push(`${name} ${num(area, lang)} m²`);
    else parts.push(`${name} ${num(p.roof.widthM!, lang)} × ${num(p.roof.lengthM!, lang)} m (${num(area, lang)} m²)`);
  }
  return parts.join(" · ");
}

/** Kort satırı (§3.4): ürünlerden > formdaki kesin sayı > bant. */
export function courtLine(lead: Pick<LeadListDto, "courtTotal" | "courtCount" | "courtCountBand">, t: T): string {
  if (lead.courtTotal && lead.courtTotal > 0) return t("product.courtsFromProducts", { n: lead.courtTotal });
  if (lead.courtCount !== null) return t("product.courtsExact", { n: lead.courtCount });
  if (lead.courtCountBand) return t("product.courtsBand", { band: t(`answer.band.${lead.courtCountBand}`) });
  return "";
}

/** "05.11.2026 · 3 g önce" / "≈ 22.10.2026 (tahmini)". */
export function dateText(iso: string, estimated: boolean, t: T, lang = "tr"): string {
  const d = new Date(iso).toLocaleDateString(lang === "tr" ? "tr-TR" : "en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  return estimated ? `≈ ${d} ${t("summary.estimated")}` : d;
}

/** Göreli gün: "bugün", "3 g önce". */
export function daysAgo(iso: string, now: number, lang = "tr"): string {
  const d = Math.floor((now - new Date(iso).getTime()) / 86_400_000);
  if (lang !== "tr") return d <= 0 ? "today" : `${d} d ago`;
  return d <= 0 ? "bugün" : `${d} g önce`;
}

/** Uyarı metni (parametreler çevrilir: ithalat sorunları, durum ve aşama). */
export function warningText(w: DataWarningDto, t: T, stageName: (c: string) => string = (c) => c): string {
  const p = { ...(w.params ?? {}) } as Record<string, string>;
  if (w.code === "import_review" && p["issues"]) {
    p["issues"] = p["issues"]
      .split(",")
      .map((c) => t(`importIssue.${c}`))
      .join("; ");
  }
  if (w.code === "status_stage_conflict") {
    if (p["status"]) p["status"] = t(`customerStatus.${p["status"]}`);
    if (p["stage"]) p["stage"] = stageName(p["stage"]);
  }
  return t(`warning.${w.code}`, p);
}

/** Kontrol edilmemiş "warn" uyarıları (kart sayısı, Kontrol sütunu). */
export const openWarnings = (ws: readonly DataWarningDto[]) => ws.filter((w) => w.severity === "warn" && !w.checked);

/** Kaynak etiketi: Excel lead'inde "Excel · Instagram" [U-M8]. */
export function sourceText(
  lead: Pick<LeadListDto, "source" | "extraAnswers" | "adSurface">,
  t: T,
  sourceName: string,
): string {
  const excel = "excel_no" in (lead.extraAnswers ?? {});
  const surface = lead.adSurface ? t(`surface.${lead.adSurface}`) : "";
  const surfaceText = surface.startsWith("surface.") ? (lead.adSurface ?? "") : surface;
  if (excel) return [t("source.excel"), surfaceText].filter(Boolean).join(" · ");
  return [sourceName, surfaceText].filter(Boolean).join(" · ");
}
