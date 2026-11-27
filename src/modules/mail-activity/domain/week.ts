/**
 * Rapor haftası: Pazartesi 00:00 – Pazar 23:59, Europe/Istanbul. Türkiye 2016'dan beri yıl boyu UTC+3'tür (yaz saati
 * yok); sabit fark kullanılır. Hafta anahtarı ISO-8601 biçimindedir: "2026-W48" (haftanın Perşembesi hangi yıldaysa
 * hafta o yıla aittir).
 */
export const ISTANBUL_OFFSET_MS = 3 * 3_600_000;
const DAY_MS = 86_400_000;
export const WEEK_MS = 7 * DAY_MS;

export interface WeekRange {
  key: string;
  /** Pazartesi 00:00 İstanbul (dahil). */
  start: Date;
  /** Sonraki Pazartesi 00:00 İstanbul (hariç). */
  end: Date;
}

/** Yerel (İstanbul) gün başlangıcını UTC ms olarak sayan yardımcı: ISO yılının 1. haftasının Pazartesisi. */
function week1Monday(year: number): number {
  const jan4 = Date.UTC(year, 0, 4);
  return jan4 - ((new Date(jan4).getUTCDay() + 6) % 7) * DAY_MS;
}

export function weekOf(at: Date): string {
  const local = new Date(at.getTime() + ISTANBUL_OFFSET_MS);
  const weekday = (local.getUTCDay() + 6) % 7; // Pazartesi 0 … Pazar 6
  const thursday = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - weekday + 3);
  const year = new Date(thursday).getUTCFullYear();
  const n = Math.floor((thursday - week1Monday(year)) / WEEK_MS) + 1;
  return `${year}-W${String(n).padStart(2, "0")}`;
}

/** "2026-W48" → hafta aralığı; biçim bozuksa ya da o yılda böyle hafta yoksa null. */
export function parseWeek(key: string): WeekRange | null {
  const m = /^(\d{4})-W(\d{2})$/.exec(key.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const n = Number(m[2]);
  if (n < 1 || n > 53) return null;
  const start = new Date(week1Monday(year) + (n - 1) * WEEK_MS - ISTANBUL_OFFSET_MS);
  const canonical = `${m[1]}-W${m[2]}`;
  if (weekOf(start) !== canonical) return null;
  return { key: canonical, start, end: new Date(start.getTime() + WEEK_MS) };
}

export function weekRangeOf(at: Date): WeekRange {
  return parseWeek(weekOf(at)) as WeekRange;
}

/** Haftayı `by` hafta kaydırır (negatif: geriye). */
export function shiftWeek(range: WeekRange, by: number): WeekRange {
  return weekRangeOf(new Date(range.start.getTime() + by * WEEK_MS));
}
