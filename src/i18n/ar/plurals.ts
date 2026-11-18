/**
 * Arapça sayı uyumu (ICU çoğul blokları). Arapçada altı kategori vardır: 1 tekil, 2 ikil, 3–10 çoğul,
 * 11–99 tekil mansub, 100 ve üstü tekil mecrur. Sık geçen adlar burada bir kez yazılır.
 */
const forms = (v: string, one: string, two: string, few: string, many: string, other: string) =>
  `{${v}, plural, one {${one}} two {${two}} few {# ${few}} many {# ${many}} other {# ${other}}}`;

export const LEADS = `{n, plural, =0 {لا يوجد عملاء محتملون} one {عميل محتمل واحد} two {عميلان محتملان} few {# عملاء محتملين} many {# عميلًا محتملًا} other {# عميل محتمل}}`;
export const DAYS = forms("n", "يوم واحد", "يومين", "أيام", "يومًا", "يوم");
export const MONTHS = forms("n", "شهر واحد", "شهرين", "أشهر", "شهرًا", "شهر");
export const MINUTES = forms("n", "دقيقة واحدة", "دقيقتين", "دقائق", "دقيقة", "دقيقة");
