/**
 * Google Data Manager API eşleştirme anahtarı normalleştirmesi (resmi biçimlendirme kılavuzu, ADR-0012):
 *  - e-posta: küçük harf; baştaki, sondaki ve aradaki tüm boşluklar silinir; gmail.com ve googlemail.com'da
 *    @ öncesi noktalar ve `+` ile sonrası silinir; diğer alan adlarında nokta ve `+` korunur; sonra SHA-256 hex
 *  - telefon: E.164, `+` DAHİL ("+18005550100"); sonra SHA-256 hex
 * Meta'dan fark: Meta telefonda `+` istemez; aynı numara iki platformda farklı hash üretir (test bunu doğrular).
 */
import { createHash } from "node:crypto";

export const sha256HexGoogle = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex");

const GOOGLE_MAIL_DOMAINS = new Set(["gmail.com", "googlemail.com"]);

export function normalizeEmailForGoogle(raw: string | null | undefined): string | null {
  const v = String(raw ?? "")
    .toLowerCase()
    .replace(/\s+/g, "");
  const at = v.lastIndexOf("@");
  if (at <= 0 || at === v.length - 1) return null;
  let local = v.slice(0, at);
  const domain = v.slice(at + 1);
  if (GOOGLE_MAIL_DOMAINS.has(domain)) {
    const plus = local.indexOf("+");
    if (plus >= 0) local = local.slice(0, plus);
    local = local.replace(/\./g, "");
    if (!local) return null;
  }
  return `${local}@${domain}`;
}

/** E.164: baştaki `+`, ardından 7–15 rakam. Girdi E.164 ya da serbest biçim olabilir; "00" öneki `+` sayılır. */
export function normalizePhoneForGoogle(raw: string | null | undefined): string | null {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return null;
  let digits = trimmed.replace(/\D+/g, "");
  if (trimmed.startsWith("00")) digits = digits.replace(/^00/, "");
  digits = digits.replace(/^0+/, "");
  if (digits.length < 7 || digits.length > 15) return null;
  return `+${digits}`;
}

export const hashEmailForGoogle = (raw: string | null | undefined): string | null => {
  const n = normalizeEmailForGoogle(raw);
  return n ? sha256HexGoogle(n) : null;
};

export const hashPhoneForGoogle = (raw: string | null | undefined): string | null => {
  const n = normalizePhoneForGoogle(raw);
  return n ? sha256HexGoogle(n) : null;
};
