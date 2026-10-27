import type { ActivityType, Currency, LeadSource, OrgType, Role, StageKey, Urgency } from "./types";

/** Visual tone of a column; maps to the --col-<tone>-* tokens in styles.css. */
export type StageTone = "slate" | "green" | "blue" | "amber" | "red";

export interface StageDef {
  key: StageKey;
  /** 1-based column number, shown on the board header. */
  no: number;
  label: string;
  /** One-line explanation under the column title. */
  hint: string;
  /** What moves a customer out of this column (plain words, shown on the journey view). */
  next: string;
  short: string;
  tone: StageTone;
  /** Default probability, used for the weighted forecast. */
  probability: number;
  open: boolean;
}

/** Fixed board order. Labels are Turkish throughout; "yeşil / kırmızı hat" keep the team's green-line / red-line idea. */
export const STAGES: StageDef[] = [
  {
    key: "contacted",
    no: 1,
    label: "İletişim kuruldu",
    hint: "Ulaştığımız tüm müşteriler",
    next: "Dönüş yapıp fiyat sorarsa → 2. Yeşil hat",
    short: "İletişim",
    tone: "slate",
    probability: 10,
    open: true,
  },
  {
    key: "interested",
    no: 2,
    label: "Yeşil hat",
    hint: "Dönüş yaptı, fiyat soruyor",
    next: "Proformayı gönderince → 3. Proforma",
    short: "Yeşil hat",
    tone: "green",
    probability: 35,
    open: true,
  },
  {
    key: "proforma_sent",
    no: 3,
    label: "Proforma gönderildi",
    hint: "Teklif müşteride",
    next: "Keşif / ölçü planlanınca → 4. Saha",
    short: "Proforma",
    tone: "blue",
    probability: 55,
    open: true,
  },
  {
    key: "site_visit",
    no: 4,
    label: "Saha ziyareti",
    hint: "Keşif, ölçü, proje planlama",
    next: "Sözleşme olunca → Satış tamamlandı",
    short: "Saha",
    tone: "amber",
    probability: 80,
    open: true,
  },
  {
    key: "lost",
    no: 5,
    label: "Kırmızı hat",
    hint: "Olumsuz sonuçlandı, neden zorunlu",
    next: "Yeniden ilgi gösterirse geri taşınır",
    short: "Kırmızı hat",
    tone: "red",
    probability: 0,
    open: false,
  },
];
export const STAGE: Record<StageKey, StageDef> = Object.fromEntries(STAGES.map((s) => [s.key, s])) as Record<
  StageKey,
  StageDef
>;
export const OPEN_STAGES = STAGES.filter((s) => s.open).map((s) => s.key);
export const stageIndex = (k: StageKey) => STAGES.findIndex((s) => s.key === k);

/**
 * The team. Login e-mail → display name and role; several addresses may belong to one person.
 *  admin: sees and controls everything (all reps' customers, reassigning, deleting, data reset).
 *  rep:   own customers + the shared pool.
 * "Admin" is a local account without a mailbox (password in server/data/config.json).
 */
export const USERS: { name: string; emails: string[]; role: Role; local?: boolean }[] = [
  { name: "Admin", emails: ["admin@unixpadel.com"], role: "admin", local: true },
  { name: "Elshan", emails: ["elshan@unixpadel.com"], role: "admin" },
  { name: "Salah", emails: ["export3@unixpadel.com"], role: "rep" },
  { name: "Yuşa", emails: ["yusa@unixpadel.com", "yusa.bedir@unixpadel.com"], role: "rep" },
  { name: "Ahlem", emails: ["export2@unixpadel.com"], role: "rep" },
];
/** People who can own customers (the local Admin account does not sell). */
export const OWNERS = USERS.filter((u) => !u.local).map((u) => u.name);
export const MAIL_DOMAIN = "unixpadel.com";
/** Display name for a login address; unknown addresses fall back to the local part. */
export function userNameFor(email: string) {
  const e = email.trim().toLowerCase();
  const u = USERS.find(
    (x) => x.emails.includes(e) || (!e.includes("@") && x.emails.some((m) => m.split("@")[0] === e)),
  );
  if (u) return u.name;
  const local = e.split("@")[0] || e;
  return local.charAt(0).toUpperCase() + local.slice(1);
}
/** Login addresses of a rep (first one = main mailbox). */
export const emailsOf = (name: string) => USERS.find((u) => u.name === name)?.emails ?? [];
/** Names from the old tracker that are no longer sales reps go to the shared pool. */
export const normalizeOwner = (o: string) => {
  if (o === "Yusa") return "Yuşa";
  return OWNERS.includes(o) ? o : "";
};

export const ACTIVITY_TYPES: { key: ActivityType; label: string; icon: string }[] = [
  { key: "call", label: "Arama", icon: "phone" },
  { key: "email", label: "E-posta", icon: "mail" },
  { key: "meeting", label: "Toplantı", icon: "users" },
  { key: "proforma_sent", label: "Proforma", icon: "file" },
  { key: "site_visit", label: "Saha ziyareti", icon: "pin" },
];
export const ACTIVITY_LABEL = Object.fromEntries(ACTIVITY_TYPES.map((a) => [a.key, a.label])) as Record<
  ActivityType,
  string
>;

export const ORG_TYPES: { key: OrgType; label: string }[] = [
  { key: "club", label: "Kulüp" },
  { key: "investor", label: "Yatırımcı" },
  { key: "distributor", label: "Distribütör" },
  { key: "contractor", label: "Yüklenici" },
];
export const ORG_TYPE_LABEL = Object.fromEntries(ORG_TYPES.map((o) => [o.key, o.label])) as Record<OrgType, string>;

export const LEAD_SOURCES: { key: LeadSource; label: string }[] = [
  { key: "website_form", label: "Web formu" },
  { key: "instagram", label: "Instagram" },
  { key: "referral", label: "Referans" },
  { key: "fair", label: "Fuar" },
];
export const LEAD_SOURCE_LABEL = Object.fromEntries(LEAD_SOURCES.map((s) => [s.key, s.label])) as Record<
  LeadSource,
  string
>;

export const URGENCY_LABEL: Record<Urgency, string> = {
  asap: "ASAP",
  m13: "1-3 ay",
  m36: "3-6 ay",
  m612: "6-12 ay",
  "": "Belirsiz",
};

export const COURT_MODELS = [
  "Panoramik",
  "Süper Panoramik",
  "Klasik",
  "Plate Padel",
  "Single (tek kişilik)",
  "Roof Top Kanopi",
];

export const LOST_REASONS = [
  "Fiyat yüksek bulundu",
  "Rakip firma seçildi",
  "Proje ertelendi / iptal",
  "Bütçe / finansman yok",
  "Yanıt vermiyor",
  "Arsa / izin sorunu",
];

export const CURRENCIES: Currency[] = ["EUR", "USD", "GBP", "TRY"];
/** Static conversion to EUR for pipeline totals. Update when rates move materially. */
export const EUR_RATE: Record<Currency, number> = { EUR: 1, USD: 0.92, GBP: 1.17, TRY: 0.027 };

export const COUNTRY_NAME: Record<string, string> = {
  TR: "Türkiye",
  GB: "Birleşik Krallık",
  DE: "Almanya",
  ES: "İspanya",
  IT: "İtalya",
  FR: "Fransa",
  NL: "Hollanda",
  AT: "Avusturya",
  HR: "Hırvatistan",
  RS: "Sırbistan",
  SI: "Slovenya",
  SK: "Slovakya",
  PL: "Polonya",
  BG: "Bulgaristan",
  GR: "Yunanistan",
  CY: "Kıbrıs",
  BA: "Bosna-Hersek",
  DK: "Danimarka",
  IE: "İrlanda",
  PT: "Portekiz",
  US: "ABD",
  CA: "Kanada",
  AE: "BAE",
  SA: "Suudi Arabistan",
  QA: "Katar",
  RU: "Rusya",
  UA: "Ukrayna",
  HU: "Macaristan",
  BE: "Belçika",
  CH: "İsviçre",
  NO: "Norveç",
  SE: "İsveç",
  TN: "Tunus",
  EG: "Mısır",
  LB: "Lübnan",
  MY: "Malezya",
  TH: "Tayland",
  PH: "Filipinler",
  ID: "Endonezya",
  IN: "Hindistan",
  PK: "Pakistan",
  AU: "Avustralya",
  ME: "Karadağ",
  LU: "Lüksemburg",
  CN: "Çin",
  GH: "Gana",
  UG: "Uganda",
  VE: "Venezuela",
  CU: "Küba",
  LK: "Sri Lanka",
  MM: "Myanmar",
  AZ: "Azerbaycan",
  KZ: "Kazakistan",
};
export const countryName = (c: string) => (c ? COUNTRY_NAME[c] || c : "Belirsiz");
/** Regional-indicator flag for an ISO country code (empty for unknown). */
export const flagOf = (c: string) =>
  /^[A-Z]{2}$/.test(c) ? String.fromCodePoint(...[...c].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65)) : "";

const LANG_BY_COUNTRY: Record<string, string> = {
  TR: "tr",
  DE: "de",
  AT: "de",
  CH: "de",
  ES: "es",
  FR: "fr",
  BE: "fr",
  LU: "fr",
  IT: "it",
  PT: "pt",
  NL: "nl",
  PL: "pl",
  RU: "ru",
  UA: "uk",
  GR: "el",
  CY: "el",
  BG: "bg",
  HR: "hr",
  RS: "sr",
  BA: "bs",
  SI: "sl",
  SK: "sk",
  HU: "hu",
  AE: "ar",
  SA: "ar",
  QA: "ar",
  EG: "ar",
  LB: "ar",
  TN: "ar",
  AZ: "az",
};
export const languageFor = (country: string) => LANG_BY_COUNTRY[country] || "en";
export const LANGUAGE_NAME: Record<string, string> = {
  tr: "Türkçe",
  en: "İngilizce",
  de: "Almanca",
  es: "İspanyolca",
  fr: "Fransızca",
  it: "İtalyanca",
  pt: "Portekizce",
  nl: "Felemenkçe",
  pl: "Lehçe",
  ru: "Rusça",
  uk: "Ukraynaca",
  el: "Yunanca",
  bg: "Bulgarca",
  hr: "Hırvatça",
  sr: "Sırpça",
  bs: "Boşnakça",
  sl: "Slovence",
  sk: "Slovakça",
  hu: "Macarca",
  ar: "Arapça",
  az: "Azerice",
};
