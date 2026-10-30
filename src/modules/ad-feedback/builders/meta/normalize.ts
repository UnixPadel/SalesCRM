/**
 * Meta eşleştirme anahtarı normalleştirmesi (Conversions API `user_data`):
 *  - e-posta: küçük harf, tüm boşluklar silinir, sonra SHA-256 (hex, küçük harf)
 *  - telefon: yalnız rakam, ülke kodu dahil, `+` ve biçim karakterleri yok, baştaki sıfırlar atılır, sonra SHA-256
 * Saf fonksiyonlar; platform bağımlılığı yok. Bilinen örnek değerler testte.
 */
import { createHash } from "node:crypto";

export const sha256Hex = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex");

export function normalizeEmailForMeta(raw: string | null | undefined): string | null {
  const v = String(raw ?? "")
    .toLowerCase()
    .replace(/\s+/g, "");
  return v.includes("@") ? v : null;
}

/** E.164 ("+905321234567") ya da serbest biçim → "905321234567". 7 haneden kısa değer anahtar sayılmaz. */
export function normalizePhoneForMeta(raw: string | null | undefined): string | null {
  const digits = String(raw ?? "")
    .replace(/\D+/g, "")
    .replace(/^0+/, "");
  return digits.length >= 7 && digits.length <= 15 ? digits : null;
}

export const hashEmailForMeta = (raw: string | null | undefined): string | null => {
  const n = normalizeEmailForMeta(raw);
  return n ? sha256Hex(n) : null;
};

export const hashPhoneForMeta = (raw: string | null | undefined): string | null => {
  const n = normalizePhoneForMeta(raw);
  return n ? sha256Hex(n) : null;
};
