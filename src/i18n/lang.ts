/**
 * Arayüz dilleri ve biçim yerelleri. React'siz: biçimleyiciler (`components/ui`) ve saf yardımcılar da okur.
 * Etkin dili `LangProvider` bildirir (çocuklar çizilmeden önce), böylece `fmtDate` gibi çağrılar dil almaz.
 */
export type Lang = "tr" | "en" | "ar";

/** Seçicide görünen sıra; adlar kendi dilinde yazılır (kullanıcı bilmediği bir dilde de kendi dilini bulur). */
export const LANGS: readonly { code: Lang; name: string; dir: "ltr" | "rtl" }[] = [
  { code: "tr", name: "Türkçe", dir: "ltr" },
  { code: "en", name: "English", dir: "ltr" },
  { code: "ar", name: "العربية", dir: "rtl" },
];

export const isLang = (v: unknown): v is Lang => LANGS.some((l) => l.code === v);
export const dirOf = (lang: Lang): "ltr" | "rtl" => LANGS.find((l) => l.code === lang)?.dir ?? "ltr";

/**
 * Tarih ve sayı yereli. Arapçada rakamlar Latin kalır (`nu-latn`): telefon, tutar ve Excel numaraları
 * arayüzün geri kalanıyla aynı rakamlarla okunur.
 */
const LOCALE: Record<Lang, string> = { tr: "tr-TR", en: "en-GB", ar: "ar-u-nu-latn" };
export const localeOf = (lang: string): string => (isLang(lang) ? LOCALE[lang] : LOCALE.en);

let active: Lang = "tr";
export const setActiveLang = (l: Lang) => {
  active = l;
};
export const activeLang = (): Lang => active;
export const activeLocale = (): string => LOCALE[active];
