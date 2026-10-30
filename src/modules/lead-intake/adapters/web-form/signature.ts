/**
 * Web formu isteklerinin kimliği: HMAC-SHA256 imza + zaman damgası (yeniden oynatmaya karşı).
 * İmzalanan metin `<timestamp>.<ham gövde>`; başlıklar X-Webform-Timestamp (Unix saniye) ve
 * X-Webform-Signature ("sha256=<hex>"). Anahtar yalnız site sunucusunda ve CRM'de bulunur;
 * tarayıcıya inmez (docs/runbooks/web-form.md). Site tarafı aynı şemayı uygular (integrations/web-form-relay).
 */
import { hmacSha256Hex, safeEqual } from "../../../shared/kernel";

export const WEB_FORM_HEADERS = {
  signature: "x-webform-signature",
  timestamp: "x-webform-timestamp",
} as const;

/** İmzanın geçerli sayıldığı pencere (saniye); saat kayması ve yeniden deneme gecikmesi için geniş tutuldu. */
export const WEB_FORM_TOLERANCE_SECONDS = 300;

export function signWebForm(secret: string, timestampSeconds: number, rawBody: Buffer | string): string {
  const body = typeof rawBody === "string" ? Buffer.from(rawBody, "utf8") : rawBody;
  return hmacSha256Hex(secret, Buffer.concat([Buffer.from(`${timestampSeconds}.`, "utf8"), body]));
}

export type SignatureFailure = "missing" | "malformed" | "stale" | "mismatch";
export type SignatureCheck = { ok: true } | { ok: false; reason: SignatureFailure };

export interface SignatureHeaders {
  signature: string | undefined;
  timestamp: string | undefined;
}

export function verifyWebFormSignature(
  rawBody: Buffer | string,
  headers: SignatureHeaders,
  secret: string,
  nowMs: number,
  toleranceSeconds: number = WEB_FORM_TOLERANCE_SECONDS,
): SignatureCheck {
  if (!secret) return { ok: false, reason: "missing" };
  if (!headers.signature || !headers.timestamp) return { ok: false, reason: "missing" };
  const ts = Number(headers.timestamp.trim());
  if (!Number.isInteger(ts) || ts <= 0) return { ok: false, reason: "malformed" };
  const [scheme, hex] = headers.signature.trim().toLowerCase().split("=");
  if (scheme !== "sha256" || !hex || !/^[0-9a-f]{64}$/.test(hex)) return { ok: false, reason: "malformed" };
  if (Math.abs(nowMs / 1000 - ts) > toleranceSeconds) return { ok: false, reason: "stale" };
  if (!safeEqual(hex, signWebForm(secret, ts, rawBody))) return { ok: false, reason: "mismatch" };
  return { ok: true };
}
