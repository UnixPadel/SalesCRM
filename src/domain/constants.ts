// Arayüz sabitleri. Aşama, kaynak ve kayıp nedeni sözlükleri API'den gelir (stage_definitions, lost_reasons);
// eski JSON panonun STAGE / USERS / EUR_RATE tabloları Faz 6d ile kaldırıldı (kurlar: EUR_RATES ayarı).

export const MAIL_DOMAIN = "unixpadel.com";

export const COURT_MODELS = [
  "Panoramik",
  "Süper Panoramik",
  "Klasik",
  "Plate Padel",
  "Single (tek kişilik)",
  "Roof Top Kanopi",
];

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
