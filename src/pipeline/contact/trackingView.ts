/**
 * Satış takip bilgisinin ortak metinleri (Faz 7g): ürün özeti, kort satırı, son temas, kanal ve uyarı metinleri.
 * Lead sayfası, liste, pano kartı ve CSV aynı fonksiyonları kullanır. Saf: `t` çevirmeni dışarıdan gelir.
 */
import { translate } from "../../i18n/dict";
import { isLang, localeOf } from "../../i18n/lang";
import type { DataWarningDto, LeadListDto, LeadProductDto } from "../../modules/sales-pipeline/api/dto";

export type T = (key: string, vars?: Record<string, string | number>) => string;

/** Ürün listesi: numara → ad. Listede yoksa (silinmiş/bilinmeyen) "#numara". */
export type ProductNames = (id: number) => string;

export const productNamesOf =
  (catalog: readonly { id: number; name: string }[] | undefined): ProductNames =>
  (id) =>
    catalog?.find((p) => p.id === id)?.name ?? `#${id}`;

/**
 * Lead'in ürünleri tek satırda: "2 Standard Padel Court · 1 Padel Court Cover". `max` verilirse ilk `max` ürün yazılır,
 * kalanlar "+3" olur. Ürün yoksa "".
 */
export function productLine(p: readonly LeadProductDto[], name: ProductNames, max?: number): string {
  const parts = p.map((x) => `${x.qty} ${name(x.productId)}`);
  if (max === undefined || parts.length <= max) return parts.join(" · ");
  return `${parts.slice(0, max).join(" · ")} +${parts.length - max}`;
}

/** Formdan gelen kort sayısı (ürünlerden bağımsız): kesin sayı > bant. */
export function courtLine(lead: Pick<LeadListDto, "courtCount" | "courtCountBand">, t: T): string {
  if (lead.courtCount !== null) return t("product.courtsExact", { n: lead.courtCount });
  if (lead.courtCountBand) return t("product.courtsBand", { band: t(`answer.band.${lead.courtCountBand}`) });
  return "";
}

/** "05.11.2026 · 3 g önce" / "≈ 22.10.2026 (tahmini)". */
export function dateText(iso: string, estimated: boolean, t: T, lang = "tr"): string {
  const d = new Date(iso).toLocaleDateString(localeOf(lang), {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  return estimated ? `≈ ${d} ${t("summary.estimated")}` : d;
}

/** Göreli gün: "bugün", "3 g önce". */
export function daysAgo(iso: string, now: number, lang = "tr"): string {
  const d = Math.floor((now - new Date(iso).getTime()) / 86_400_000);
  const l = isLang(lang) ? lang : "en";
  return d <= 0 ? translate(l, "rel.today") : translate(l, "rel.daysAgoShort", { n: d });
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
  const extra = lead.extraAnswers ?? {};
  const surface = lead.adSurface ? t(`surface.${lead.adSurface}`) : "";
  const surfaceText = surface.startsWith("surface.") ? (lead.adSurface ?? "") : surface;
  // Excel aktarımı "Excel · Instagram", form tablosu "Form tablosu · Instagram" [U-M8].
  const origin = "excel_no" in extra ? t("source.excel") : "sheet_key" in extra ? t("source.sheet") : sourceName;
  return [origin, surfaceText].filter(Boolean).join(" · ");
}

/** İki haneli ülke arama kodları; 1 ve 7 tek hanelidir, kalanların hepsi üç hanelidir (ITU E.164). */
const CC2 = new Set(
  (
    "20 27 30 31 32 33 34 36 39 40 41 43 44 45 46 47 48 49 51 52 53 54 55 56 57 58 60 61 62 63 64 65 66 " +
    "81 82 84 86 90 91 92 93 94 95 98"
  ).split(" "),
);

/**
 * E.164 numarayı okunur yazar ("+905321234567" → "+90 532 123 45 67"). Yalnız gösterim içindir; doğrulama ve
 * normalleştirme sunucudadır. Türkiye'nin alışılmış 3-3-2-2 kümesi, diğer ülkelerde üçerli kümeler.
 */
export function phoneText(e164: string | null | undefined): string {
  if (!e164) return "";
  const digits = e164.replace(/\D/g, "");
  if (!e164.startsWith("+") || digits.length < 8) return e164;
  const ccLen = digits[0] === "1" || digits[0] === "7" ? 1 : CC2.has(digits.slice(0, 2)) ? 2 : 3;
  const cc = digits.slice(0, ccLen);
  const rest = digits.slice(ccLen);
  if (cc === "90" && rest.length === 10) {
    return `+90 ${rest.slice(0, 3)} ${rest.slice(3, 6)} ${rest.slice(6, 8)} ${rest.slice(8)}`;
  }
  const groups: string[] = [];
  for (let i = 0; i < rest.length; i += 3) groups.push(rest.slice(i, i + 3));
  // Tek haneli son küme bir öncekine katılır ("… 555 2671").
  if (groups.length > 1 && groups[groups.length - 1]!.length === 1) {
    const last = groups.pop()!;
    groups[groups.length - 1] += last;
  }
  return `+${cc} ${groups.join(" ")}`;
}
