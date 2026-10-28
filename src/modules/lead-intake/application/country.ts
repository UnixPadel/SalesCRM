/**
 * Ülke çözümleme: form alanı serbest metin gelebilir ("Türkiye", "Turkey", "TR"). Bilinen adlar
 * ISO-3166 alpha-2'ye çevrilir; çözülemezse telefon numarasının ülkesi, o da yoksa null.
 */
import { PhoneNumber } from "../../shared/normalization";

const NAMES: Record<string, string> = {
  // TR / EN adlar; anahtarlar küçük harf, aksansız
  turkiye: "TR",
  turkey: "TR",
  almanya: "DE",
  germany: "DE",
  deutschland: "DE",
  "birlesik krallik": "GB",
  ingiltere: "GB",
  "united kingdom": "GB",
  uk: "GB",
  england: "GB",
  "great britain": "GB",
  fransa: "FR",
  france: "FR",
  ispanya: "ES",
  spain: "ES",
  espana: "ES",
  italya: "IT",
  italy: "IT",
  italia: "IT",
  hollanda: "NL",
  netherlands: "NL",
  "the netherlands": "NL",
  nederland: "NL",
  belcika: "BE",
  belgium: "BE",
  avusturya: "AT",
  austria: "AT",
  isvicre: "CH",
  switzerland: "CH",
  isvec: "SE",
  sweden: "SE",
  norvec: "NO",
  norway: "NO",
  danimarka: "DK",
  denmark: "DK",
  finlandiya: "FI",
  finland: "FI",
  polonya: "PL",
  poland: "PL",
  cekya: "CZ",
  "cek cumhuriyeti": "CZ",
  czechia: "CZ",
  "czech republic": "CZ",
  yunanistan: "GR",
  greece: "GR",
  portekiz: "PT",
  portugal: "PT",
  irlanda: "IE",
  ireland: "IE",
  romanya: "RO",
  romania: "RO",
  bulgaristan: "BG",
  bulgaria: "BG",
  macaristan: "HU",
  hungary: "HU",
  hirvatistan: "HR",
  croatia: "HR",
  sirbistan: "RS",
  serbia: "RS",
  slovakya: "SK",
  slovakia: "SK",
  slovenya: "SI",
  slovenia: "SI",
  litvanya: "LT",
  lithuania: "LT",
  letonya: "LV",
  latvia: "LV",
  estonya: "EE",
  estonia: "EE",
  kibris: "CY",
  cyprus: "CY",
  malta: "MT",
  luksemburg: "LU",
  luxembourg: "LU",
  ukrayna: "UA",
  ukraine: "UA",
  rusya: "RU",
  russia: "RU",
  azerbaycan: "AZ",
  azerbaijan: "AZ",
  gurcistan: "GE",
  georgia: "GE",
  kazakistan: "KZ",
  kazakhstan: "KZ",
  ozbekistan: "UZ",
  uzbekistan: "UZ",
  "birlesik arap emirlikleri": "AE",
  bae: "AE",
  "united arab emirates": "AE",
  uae: "AE",
  "suudi arabistan": "SA",
  "saudi arabia": "SA",
  katar: "QA",
  qatar: "QA",
  kuveyt: "KW",
  kuwait: "KW",
  umman: "OM",
  oman: "OM",
  bahreyn: "BH",
  bahrain: "BH",
  irak: "IQ",
  iraq: "IQ",
  iran: "IR",
  israil: "IL",
  israel: "IL",
  misir: "EG",
  egypt: "EG",
  fas: "MA",
  morocco: "MA",
  tunus: "TN",
  tunisia: "TN",
  cezayir: "DZ",
  algeria: "DZ",
  "guney afrika": "ZA",
  "south africa": "ZA",
  nijerya: "NG",
  nigeria: "NG",
  kenya: "KE",
  "amerika birlesik devletleri": "US",
  abd: "US",
  "united states": "US",
  "united states of america": "US",
  usa: "US",
  kanada: "CA",
  canada: "CA",
  meksika: "MX",
  mexico: "MX",
  brezilya: "BR",
  brazil: "BR",
  arjantin: "AR",
  argentina: "AR",
  sili: "CL",
  chile: "CL",
  avustralya: "AU",
  australia: "AU",
  "yeni zelanda": "NZ",
  "new zealand": "NZ",
  hindistan: "IN",
  india: "IN",
  pakistan: "PK",
  japonya: "JP",
  japan: "JP",
  "guney kore": "KR",
  "south korea": "KR",
  cin: "CN",
  china: "CN",
};

const fold = (s: string): string =>
  s
    .toLowerCase()
    .replace(/ı/g, "i")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** "TR" / "tr" / "Türkiye" / "Turkey" → "TR"; tanınmazsa null. */
export function countryCodeFrom(raw: string | null | undefined): string | null {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  if (/^[A-Za-z]{2}$/.test(text)) return text.toUpperCase();
  return NAMES[fold(text)] ?? null;
}

/** Ülke alanı → kod; olmazsa telefonun ülkesi (varsayılan ülkeyle çözülerek); o da yoksa null. */
export function resolveCountry(
  raw: string | null | undefined,
  phone: string | null,
  defaultCountry: string,
): string | null {
  const fromField = countryCodeFrom(raw);
  if (fromField) return fromField;
  if (phone) {
    const parsed = PhoneNumber.parse(phone, defaultCountry);
    if (parsed.ok && parsed.value.country) return parsed.value.country;
  }
  return null;
}
