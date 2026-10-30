/**
 * Servis hesabı erişim token'ı, kütüphanesiz (ADR-0012): anahtar JSON'undaki private_key ile RS256 imzalı JWT
 * (iss = client_email, scope = datamanager, aud = token_uri) → https://oauth2.googleapis.com/token → access_token.
 * Token süresinin 60 sn öncesine kadar önbellekte tutulur. Anahtar ve token hiçbir zaman loglanmaz.
 */
import { createSign } from "node:crypto";
import type { Logger } from "../../../shared/kernel";

export const GOOGLE_DM_SCOPE = "https://www.googleapis.com/auth/datamanager";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

export interface TokenProvider {
  /** Geçerli bir Bearer token döner; yoksa fırlatır (çağıran geçici hata sayar). */
  accessToken(): Promise<string>;
}

/** Anahtar JSON metni ya da base64 JSON; eksik alanlar hata. */
export function parseServiceAccountKey(raw: string): ServiceAccountKey {
  const text = raw.trim().startsWith("{") ? raw.trim() : Buffer.from(raw.trim(), "base64").toString("utf8");
  let json: Partial<ServiceAccountKey>;
  try {
    json = JSON.parse(text) as Partial<ServiceAccountKey>;
  } catch {
    throw new Error("Servis hesabı anahtarı JSON değil.");
  }
  if (!json.client_email || !json.private_key)
    throw new Error("Servis hesabı anahtarında client_email/private_key yok.");
  const key: ServiceAccountKey = { client_email: json.client_email, private_key: json.private_key };
  if (json.token_uri) key.token_uri = json.token_uri;
  return key;
}

const b64url = (input: Buffer | string): string =>
  (typeof input === "string" ? Buffer.from(input, "utf8") : input)
    .toString("base64")
    .replace(/=+$/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

/** RS256 JWT (saf). Test edilebilir olsun diye zaman dışarıdan. */
export function signServiceAccountJwt(key: ServiceAccountKey, nowSeconds: number, scope = GOOGLE_DM_SCOPE): string {
  const aud = key.token_uri ?? "https://oauth2.googleapis.com/token";
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({ iss: key.client_email, scope, aud, iat: nowSeconds, exp: nowSeconds + 3600 }),
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  return `${header}.${payload}.${b64url(signer.sign(key.private_key))}`;
}

export interface ServiceAccountTokenOptions {
  key: ServiceAccountKey;
  logger: Logger;
  fetchImpl?: FetchLike | undefined;
  now?: (() => number) | undefined;
  timeoutMs?: number | undefined;
}

export function createServiceAccountTokenProvider(o: ServiceAccountTokenOptions): TokenProvider {
  const fetchImpl: FetchLike = o.fetchImpl ?? ((u, i) => fetch(u, i));
  const now = o.now ?? Date.now;
  const tokenUri = o.key.token_uri ?? "https://oauth2.googleapis.com/token";
  let cached: { token: string; expiresAt: number } | null = null;
  let inFlight: Promise<string> | null = null;

  const refresh = async (): Promise<string> => {
    const assertion = signServiceAccountJwt(o.key, Math.floor(now() / 1000));
    const body = new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion });
    const res = await fetchImpl(tokenUri, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      signal: AbortSignal.timeout(o.timeoutMs ?? 10_000),
    });
    const json = (await res.json().catch(() => null)) as {
      access_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    } | null;
    if (!res.ok || !json?.access_token) {
      o.logger.warn("google token alınamadı", { status: res.status, error: json?.error ?? null });
      throw new Error(`Google erişim token'ı alınamadı (HTTP ${res.status}${json?.error ? `, ${json.error}` : ""}).`);
    }
    cached = { token: json.access_token, expiresAt: now() + ((json.expires_in ?? 3600) - 60) * 1000 };
    o.logger.info("google token yenilendi", { expiresInSeconds: json.expires_in ?? 3600 });
    return cached.token;
  };

  return {
    async accessToken() {
      if (cached && cached.expiresAt > now()) return cached.token;
      if (!inFlight) inFlight = refresh().finally(() => (inFlight = null));
      return inFlight;
    },
  };
}
