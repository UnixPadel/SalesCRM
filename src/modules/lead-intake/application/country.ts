/**
 * Ülke çözümleme: form alanı serbest metin gelebilir ("Türkiye", "Turkey", "TR", "Allemagne", "Германия"). Bilinen adlar
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

/**
 * Yerel adlar (de, fr, ar, ru; TR/EN yukarıda): web sitesi 6 dilde yayında, eski kayıtlardaki serbest metin ülke
 * (`country_input`) bu dillerde gelir. Doğal yazımla tutulur, yükleme anında `fold` ile anahtara çevrilir.
 * Sonda: Türkçe/İngilizce adı yukarıda olmayan komşu ülkeler.
 */
const LOCALIZED: Record<string, readonly string[]> = {
  TR: ["Türkei", "Turquie", "تركيا", "Турция"],
  DE: ["Allemagne", "ألمانيا", "Германия"],
  GB: [
    "Vereinigtes Königreich",
    "Großbritannien",
    "Royaume-Uni",
    "Angleterre",
    "Grande-Bretagne",
    "المملكة المتحدة",
    "بريطانيا",
    "Великобритания",
    "Соединённое Королевство",
    "Англия",
  ],
  FR: ["Frankreich", "فرنسا", "Франция"],
  ES: ["Spanien", "Espagne", "إسبانيا", "Испания"],
  IT: ["Italien", "Italie", "إيطاليا", "Италия"],
  NL: ["Niederlande", "Holland", "Pays-Bas", "Hollande", "هولندا", "Нидерланды", "Голландия"],
  BE: ["Belgien", "Belgique", "بلجيكا", "Бельгия"],
  AT: ["Österreich", "Autriche", "النمسا", "Австрия"],
  CH: ["Schweiz", "Suisse", "سويسرا", "Швейцария"],
  SE: ["Schweden", "Suède", "السويد", "Швеция"],
  NO: ["Norwegen", "Norvège", "النرويج", "Норвегия"],
  DK: ["Dänemark", "Danemark", "الدنمارك", "Дания"],
  FI: ["Finnland", "Finlande", "فنلندا", "Финляндия"],
  PL: ["Polen", "Pologne", "بولندا", "Польша"],
  CZ: ["Tschechien", "Tschechische Republik", "Tchéquie", "République tchèque", "التشيك", "Чехия"],
  GR: ["Griechenland", "Grèce", "اليونان", "Греция"],
  PT: ["البرتغال", "Португалия"],
  IE: ["Irland", "Irlande", "أيرلندا", "Ирландия"],
  RO: ["Rumänien", "Roumanie", "رومانيا", "Румыния"],
  BG: ["Bulgarien", "Bulgarie", "بلغاريا", "Болгария"],
  HU: ["Ungarn", "Hongrie", "المجر", "Венгрия"],
  HR: ["Kroatien", "Croatie", "كرواتيا", "Хорватия"],
  RS: ["Serbien", "Serbie", "صربيا", "Сербия"],
  SK: ["Slowakei", "Slovaquie", "سلوفاكيا", "Словакия"],
  SI: ["Slowenien", "Slovénie", "سلوفينيا", "Словения"],
  LT: ["Litauen", "Lituanie", "ليتوانيا", "Литва"],
  LV: ["Lettland", "Lettonie", "لاتفيا", "Латвия"],
  EE: ["Estland", "Estonie", "إستونيا", "Эстония"],
  CY: ["Zypern", "Chypre", "قبرص", "Кипр"],
  MT: ["Malte", "مالطا", "Мальта"],
  LU: ["Luxemburg", "لوكسمبورغ", "Люксембург"],
  UA: ["أوكرانيا", "Украина"],
  RU: ["Russland", "Russie", "روسيا", "Россия", "Российская Федерация"],
  AZ: ["Aserbaidschan", "Azerbaïdjan", "أذربيجان", "Азербайджан"],
  GE: ["Georgien", "Géorgie", "جورجيا", "Грузия"],
  KZ: ["Kasachstan", "كازاخستان", "Казахстан"],
  UZ: ["Usbekistan", "Ouzbékistan", "أوزبكستان", "Узбекистан"],
  AE: [
    "Vereinigte Arabische Emirate",
    "Émirats arabes unis",
    "الإمارات",
    "الإمارات العربية المتحدة",
    "ОАЭ",
    "Объединённые Арабские Эмираты",
  ],
  SA: ["Saudi-Arabien", "Arabie saoudite", "السعودية", "المملكة العربية السعودية", "Саудовская Аравия"],
  QA: ["Katar", "قطر", "Катар"],
  KW: ["Koweït", "الكويت", "Кувейт"],
  OM: ["عمان", "سلطنة عمان", "Оман"],
  BH: ["Bahreïn", "البحرين", "Бахрейн"],
  IQ: ["Irak", "العراق", "Ирак"],
  IR: ["إيران", "Иран"],
  IL: ["Israël", "إسرائيل", "Израиль"],
  EG: ["Ägypten", "Égypte", "مصر", "Египет"],
  MA: ["Marokko", "Maroc", "المغرب", "Марокко"],
  TN: ["Tunesien", "Tunisie", "تونس", "Тунис"],
  DZ: ["Algerien", "Algérie", "الجزائر", "Алжир"],
  ZA: ["Südafrika", "Afrique du Sud", "جنوب أفريقيا", "ЮАР", "Южная Африка"],
  NG: ["Nigéria", "نيجيريا", "Нигерия"],
  KE: ["Kenia", "كينيا", "Кения"],
  US: ["Vereinigte Staaten", "États-Unis", "الولايات المتحدة", "أمريكا", "США", "Соединённые Штаты"],
  CA: ["Kanada", "كندا", "Канада"],
  MX: ["Mexiko", "Mexique", "المكسيك", "Мексика"],
  BR: ["Brasilien", "Brésil", "البرازيل", "Бразилия"],
  AR: ["Argentinien", "Argentine", "الأرجنتين", "Аргентина"],
  CL: ["Chili", "تشيلي", "Чили"],
  AU: ["Australien", "Australie", "أستراليا", "Австралия"],
  NZ: ["Neuseeland", "Nouvelle-Zélande", "نيوزيلندا", "Новая Зеландия"],
  IN: ["Indien", "Inde", "الهند", "Индия"],
  PK: ["باكستان", "Пакистан"],
  JP: ["Japon", "اليابان", "Япония"],
  KR: ["Südkorea", "Corée du Sud", "كوريا الجنوبية", "Южная Корея"],
  CN: ["Chine", "الصين", "Китай"],
  JO: ["Ürdün", "Jordan", "Jordanien", "Jordanie", "الأردن", "Иордания"],
  LB: ["Lübnan", "Lebanon", "Libanon", "Liban", "لبنان", "Ливан"],
  LY: ["Libya", "Libyen", "Libye", "ليبيا", "Ливия"],
  AM: ["Ermenistan", "Armenia", "Armenien", "Arménie", "أرمينيا", "Армения"],
  BY: ["Belarus", "Beyaz Rusya", "Weißrussland", "Biélorussie", "بيلاروسيا", "Беларусь", "Белоруссия"],
  MD: ["Moldova", "Moldau", "Moldawien", "Moldavie", "مولدوفا", "Молдова", "Молдавия"],
  AL: ["Arnavutluk", "Albania", "Albanien", "Albanie", "ألبانيا", "Албания"],
  MK: [
    "Kuzey Makedonya",
    "North Macedonia",
    "Nordmazedonien",
    "Macédoine du Nord",
    "مقدونيا الشمالية",
    "Северная Македония",
  ],
  BA: [
    "Bosna Hersek",
    "Bosnia and Herzegovina",
    "Bosnien und Herzegowina",
    "Bosnie-Herzégovine",
    "البوسنة والهرسك",
    "Босния и Герцеговина",
  ],
  ME: ["Karadağ", "Montenegro", "Monténégro", "الجبل الأسود", "Черногория"],
  KG: ["Kırgızistan", "Kyrgyzstan", "Kirgisistan", "Kirghizistan", "قيرغيزستان", "Киргизия", "Кыргызстан"],
  TM: ["Türkmenistan", "Turkmenistan", "Turkménistan", "تركمانستان", "Туркменистан"],
  TJ: ["Tacikistan", "Tajikistan", "Tadschikistan", "Tadjikistan", "طاجيكستان", "Таджикистан"],
};

/**
 * Küçük harf, Türkçe harfler ASCII'ye, aksanlar atılır; Arapça hemze/hareke ve Kiril ё/й biçimleri tek yazıma
 * iner. Harf (her alfabe) dışı → tek boşluk.
 */
const fold = (s: string): string =>
  s
    .toLowerCase()
    .replace(/ı/g, "i")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[\u0300-\u036f\u064b-\u065f\u0670\u0640]/g, "")
    .replace(/ة/g, "ه")
    .replace(/[ىی]/g, "ي")
    .replace(/[^\p{L} ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

for (const [code, names] of Object.entries(LOCALIZED)) {
  for (const name of names) NAMES[fold(name)] ??= code;
}

/** Baştaki tanım edatı ("the", "la", "l'", "die" …) olmadan da denenir: "la France", "die Schweiz". */
const ARTICLE = /^(the|la|le|les|l|die|der|das) /;

/** "TR" / "tr" / "Türkiye" / "Turkey" → "TR"; tanınmazsa null. */
export function countryCodeFrom(raw: string | null | undefined): string | null {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  if (/^[A-Za-z]{2}$/.test(text)) return text.toUpperCase();
  const f = fold(text);
  return NAMES[f] ?? NAMES[f.replace(ARTICLE, "")] ?? null;
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
