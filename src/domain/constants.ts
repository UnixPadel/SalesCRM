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
/**
 * Ülke adları arayüz dilini izler. Türkçede tablodaki adlar önceliklidir; tabloda olmayan her ISO kodu (OM, NZ, AM,
 * IQ…) ile İngilizce ve Arapçadaki bütün adlar tarayıcının ülke adlarından gelir. Dili `LangProvider` bildirir.
 */
export type CountryLang = "tr" | "en" | "ar";
let countryLang: CountryLang = "tr";
export const setCountryLang = (l: CountryLang) => {
  countryLang = l;
};
const UNKNOWN_COUNTRY: Record<CountryLang, string> = { tr: "Belirsiz", en: "Unknown", ar: "غير محدد" };
const regionNames = (l: CountryLang) => {
  try {
    return new Intl.DisplayNames([l], { type: "region", fallback: "none" });
  } catch {
    return null;
  }
};
const REGION_NAMES: Record<CountryLang, Intl.DisplayNames | null> = {
  tr: regionNames("tr"),
  en: regionNames("en"),
  ar: regionNames("ar"),
};
export const countryName = (c: string, lang: CountryLang = countryLang): string => {
  if (!c) return UNKNOWN_COUNTRY[lang];
  const code = c.toUpperCase();
  if (lang === "tr" && COUNTRY_NAME[code]) return COUNTRY_NAME[code];
  if (!/^[A-Z]{2}$/.test(code)) return c;
  try {
    return REGION_NAMES[lang]?.of(code) || COUNTRY_NAME[code] || c;
  } catch {
    return COUNTRY_NAME[code] || c;
  }
};
/** ISO 3166-1 alfa-2: dünyadaki bütün ülke ve bölge kodları. Seçim listeleri bunlardan kurulur. */
export const ALL_COUNTRY_CODES: readonly string[] = (
  "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ " +
  "CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR " +
  "GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO " +
  "JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR " +
  "MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO " +
  "RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV " +
  "TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW"
).split(" ");
/** Seçim listeleri için bütün ülkeler: [kod, ad], seçili dilde ada göre sıralı. */
export const countryOptions = (lang: CountryLang = countryLang): [string, string][] =>
  ALL_COUNTRY_CODES
    .map((code): [string, string] => [code, countryName(code, lang)])
    .sort((x, y) => x[1].localeCompare(y[1], lang));
/** Regional-indicator flag for an ISO country code (empty for unknown). */
export const flagOf = (c: string) =>
  /^[A-Z]{2}$/.test(c) ? String.fromCodePoint(...[...c].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65)) : "";
