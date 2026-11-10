import { PhoneNumber } from "../../shared/normalization";
import { calendarDay } from "./activity";
import type { ContactSummary } from "./contact";
import type { Lead } from "./lead";
import { isTerminal } from "./stage";

/**
 * Veri uyarıları (Faz 7g, D6, iş emri §3.3.5): Excel'in sarı hücreleri. Saklanmaz, her okumada hesaplanır;
 * yalnız yöneticinin "Kontrol edildi" dediği kodlar lead'de durur (`checkedWarnings`). Excel tutarsızlıklarının
 * çoğu yapısal olarak oluşamaz (dönüş tarihli temas, adet = tercih); kalanlar burada.
 */
export type WarningCode =
  | "phone_country_mismatch"
  | "phone_invalid"
  | "phone_unreadable"
  | "country_missing"
  | "contact_before_lead"
  | "roof_size_missing"
  | "import_review"
  | "country_from_phone"
  | "dial_code_assumed"
  | "status_stage_conflict";

export const WARNING_CODES: readonly WarningCode[] = [
  "phone_country_mismatch",
  "phone_invalid",
  "phone_unreadable",
  "country_missing",
  "contact_before_lead",
  "roof_size_missing",
  "import_review",
  "country_from_phone",
  "dial_code_assumed",
  "status_stage_conflict",
];
export const isWarningCode = (v: unknown): v is WarningCode =>
  typeof v === "string" && (WARNING_CODES as readonly string[]).includes(v);

export type WarningSeverity = "warn" | "info";

/** Kodun olağan önemi (`/reference`); `country_missing` içe aktarılan lead'de "info" olur [M-M15]. */
export const WARNING_SEVERITY: Readonly<Record<WarningCode, WarningSeverity>> = {
  phone_country_mismatch: "warn",
  phone_invalid: "warn",
  phone_unreadable: "warn",
  country_missing: "warn",
  contact_before_lead: "warn",
  roof_size_missing: "warn",
  import_review: "warn",
  country_from_phone: "info",
  dial_code_assumed: "info",
  status_stage_conflict: "info",
};

/** Satışçının işini etkileyen üç uyarı; bilginin yanında satır içi görünür [U-I18]. */
export const REP_VISIBLE_WARNINGS: readonly WarningCode[] = [
  "phone_country_mismatch",
  "phone_invalid",
  "roof_size_missing",
];

/** İçe aktarma sorunları (`extraAnswers.import_issues`; `import_review` uyarısının parametresi) [K-I9]. */
export const IMPORT_ISSUE_CODES = [
  "excel_warning",
  "k_without_j",
  "m_without_l",
  "reply_before_lead",
  "qty_without_tick",
  "tick_without_qty",
  "roof_dims_without_tick",
  "status_unknown",
] as const;
export type ImportIssueCode = (typeof IMPORT_ISSUE_CODES)[number];

export interface DataWarning {
  code: WarningCode;
  severity: WarningSeverity;
  /** Yönetici "Kontrol edildi" dedi. */
  checked: boolean;
  params?: Record<string, string>;
}

/** Köken anahtarları (`extraAnswers`): alan düzeltilince silinir. */
export const PROVENANCE_KEYS = {
  country: ["country_source", "country_raw"],
  phone: ["phone_raw", "dial_code_assumed"],
} as const;

/** Alan düzeltilince kontrol listesinden düşen kodlar (uyarı yeniden doğarsa yeniden görünür). */
export const WARNINGS_CLEARED_BY = {
  country: ["country_missing", "country_from_phone", "phone_country_mismatch"],
  phone: ["phone_invalid", "phone_unreadable", "dial_code_assumed", "phone_country_mismatch"],
} as const satisfies Record<keyof typeof PROVENANCE_KEYS, readonly WarningCode[]>;

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** `import_issues` dizi (ya da tek metin) → boş olmayan kodlar. */
function importIssues(v: unknown): string[] {
  const list = Array.isArray(v) ? v : [v];
  return list.map(text).filter((s) => s !== "");
}

/**
 * Lead'in bütün veri uyarıları, `WARNING_CODES` sırasıyla. `contact` aynı lead'in temas özetidir
 * (`contact_before_lead`); takvim günü `timeZone`'a göredir.
 */
export function dataWarnings(lead: Lead, contact: ContactSummary, timeZone: string): DataWarning[] {
  const found: { code: WarningCode; severity?: WarningSeverity; params?: Record<string, string> }[] = [];
  const extra = lead.extraAnswers ?? {};

  if (lead.phoneE164) {
    const parsed = PhoneNumber.parse(lead.phoneE164);
    const phone = parsed.ok ? parsed.value : null;
    const countryCode = PhoneNumber.callingCodeFor(lead.country);
    if (phone && countryCode !== null && phone.callingCode !== countryCode) {
      found.push({
        code: "phone_country_mismatch",
        params: { phoneCode: `+${phone.callingCode}`, country: String(lead.country) },
      });
    }
    if (!phone || !phone.valid) found.push({ code: "phone_invalid" });
  } else if (text(extra.phone_raw) !== "") {
    found.push({ code: "phone_unreadable" });
  }
  if (!lead.country) found.push({ code: "country_missing", severity: lead.source === "import" ? "info" : "warn" });
  if (contact.firstAt && calendarDay(contact.firstAt, timeZone) < calendarDay(lead.createdAt, timeZone)) {
    found.push({ code: "contact_before_lead" });
  }
  const roof = lead.products.roof;
  if (roof.wanted && (roof.widthM === null || roof.lengthM === null)) found.push({ code: "roof_size_missing" });
  const issues = importIssues(extra.import_issues);
  if (issues.length) found.push({ code: "import_review", params: { issues: issues.join(",") } });
  if (extra.country_source === "phone") found.push({ code: "country_from_phone" });
  const dialCode = text(extra.dial_code_assumed);
  if (dialCode !== "") found.push({ code: "dial_code_assumed", params: { dialCode } });
  const status = lead.customerStatus;
  if (
    (status === "not_interested" && !isTerminal(lead.currentStage)) ||
    (status === "buyer_ready" && lead.currentStage === "LOST")
  ) {
    found.push({ code: "status_stage_conflict", params: { status, stage: lead.currentStage } });
  }

  const checked = new Set(lead.checkedWarnings);
  return found
    .sort((a, b) => WARNING_CODES.indexOf(a.code) - WARNING_CODES.indexOf(b.code))
    .map(({ code, severity, params }) => {
      const w: DataWarning = { code, severity: severity ?? WARNING_SEVERITY[code], checked: checked.has(code) };
      if (params) w.params = params;
      return w;
    });
}

/** Yönetici bütün uyarıları görür; satışçı yalnız işini etkileyen ve kontrol edilmemiş üçünü [U-I18]. */
export const visibleWarnings = (all: DataWarning[], isAdmin: boolean): DataWarning[] =>
  isAdmin ? all : all.filter((w) => REP_VISIBLE_WARNINGS.includes(w.code) && !w.checked);

/** Kart sayısı (⚠ n), Kontrol sütunu ve "Uyarılı" süzgeci: kontrol edilmemiş "warn" uyarıları. */
export const openWarnings = (all: readonly DataWarning[]): DataWarning[] =>
  all.filter((w) => w.severity === "warn" && !w.checked);
