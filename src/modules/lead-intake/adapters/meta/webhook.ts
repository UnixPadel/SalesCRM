/**
 * Meta webhook doğrulama: GET (hub.challenge) ve POST (X-Hub-Signature-256, ham gövde, sabit zamanlı).
 * Bu dosya HTTP çerçevesini bilmez; controller sorgu, başlık ve ham gövdeyi verir.
 */
import { hmacSha256Hex, safeEqual } from "../../../shared/kernel";

export interface VerifyQuery {
  "hub.mode"?: unknown;
  "hub.verify_token"?: unknown;
  "hub.challenge"?: unknown;
}

/** Doğruysa geri yazılacak challenge metni; değilse null (403). */
export function verifyChallenge(query: VerifyQuery, verifyToken: string): string | null {
  if (!verifyToken) return null;
  const mode = String(query["hub.mode"] ?? "");
  const token = String(query["hub.verify_token"] ?? "");
  const challenge = query["hub.challenge"];
  if (mode !== "subscribe" || typeof challenge !== "string" || !challenge) return null;
  return safeEqual(token, verifyToken) ? challenge : null;
}

/** `sha256=<hex>` başlığı ham gövdenin app secret ile HMAC'i olmalı. Başlık yoksa ya da biçim bozuksa false. */
export function verifySignature(rawBody: Buffer | string, header: string | undefined, appSecret: string): boolean {
  if (!appSecret || !header) return false;
  const [scheme, hex] = header.trim().toLowerCase().split("=");
  if (scheme !== "sha256" || !hex) return false;
  return safeEqual(hex, hmacSha256Hex(appSecret, rawBody));
}

export interface LeadgenChange {
  leadgenId: string;
  formId: string | null;
  pageId: string | null;
  adId: string | null;
  adgroupId: string | null;
  createdTime: number | null;
}

/** Webhook gövdesindeki `leadgen` değişikliklerini çıkarır; başka alanlar yok sayılır. */
export function extractLeadgenChanges(body: unknown): LeadgenChange[] {
  const out: LeadgenChange[] = [];
  const b = body as { object?: unknown; entry?: unknown };
  if (!b || b.object !== "page" || !Array.isArray(b.entry)) return out;
  for (const entry of b.entry as { changes?: unknown }[]) {
    if (!Array.isArray(entry?.changes)) continue;
    for (const change of entry.changes as { field?: unknown; value?: Record<string, unknown> }[]) {
      if (change?.field !== "leadgen" || !change.value) continue;
      const v = change.value;
      const leadgenId = str(v["leadgen_id"]);
      if (!leadgenId) continue;
      out.push({
        leadgenId,
        formId: str(v["form_id"]) || null,
        pageId: str(v["page_id"]) || null,
        adId: str(v["ad_id"]) || null,
        adgroupId: str(v["adgroup_id"]) || null,
        createdTime: typeof v["created_time"] === "number" ? v["created_time"] : null,
      });
    }
  }
  return out;
}

const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v));
