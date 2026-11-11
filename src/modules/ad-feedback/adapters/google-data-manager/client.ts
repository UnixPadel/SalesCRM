/**
 * Data Manager API istemcisi: POST https://datamanager.googleapis.com/v1/events:ingest (ADR-0012).
 * Token yalnız Authorization başlığında. Yanıt sınıflandırması dağıtıcının SendResult'ına:
 *  2xx → ok · 429 (RESOURCE_EXHAUSTED), 5xx, zaman aşımı, ağ, token alınamadı → retry · 400/401/403/404 → dead.
 * Google tüm isteği bir bütün olarak reddeder; dağıtıcı 400'de olayları tek tek yeniden dener.
 */
import type { Logger } from "../../../shared/kernel";
import type { PlatformRequestStatus, SendResult } from "../../application";
import type { GoogleIngestRequest } from "../../builders/google";
import type { FetchLike, TokenProvider } from "./auth";
import { translateRequestStatus } from "./status";

export const GOOGLE_DM_INGEST_URL = "https://datamanager.googleapis.com/v1/events:ingest";
export const GOOGLE_DM_STATUS_URL = "https://datamanager.googleapis.com/v1/requestStatus:retrieve";

export interface DataManagerClientOptions {
  tokens: TokenProvider;
  logger: Logger;
  fetchImpl?: FetchLike | undefined;
  timeoutMs?: number | undefined;
  ingestUrl?: string | undefined;
  statusUrl?: string | undefined;
}

export interface DataManagerClient {
  ingest(request: GoogleIngestRequest): Promise<SendResult>;
  /** Faz 7c: isteğin eşzamansız işleme sonucu. Ağ hatası ya da 2xx dışı yanıtta fırlatır. */
  retrieveStatus(requestId: string): Promise<PlatformRequestStatus>;
}

interface GoogleErrorBody {
  error?: { code?: number; message?: string; status?: string; details?: unknown[] };
  requestId?: string;
  fieldWarnings?: unknown[];
}

export function createDataManagerClient(o: DataManagerClientOptions): DataManagerClient {
  const fetchImpl: FetchLike = o.fetchImpl ?? ((u, i) => fetch(u, i));
  const timeout = o.timeoutMs ?? 15_000;
  const url = o.ingestUrl ?? GOOGLE_DM_INGEST_URL;
  return {
    async ingest(request) {
      let token: string;
      try {
        token = await o.tokens.accessToken();
      } catch (e) {
        return { kind: "retry", code: null, error: e instanceof Error ? e.message : String(e) };
      }
      let res: Response;
      try {
        res = await fetchImpl(url, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(request),
          signal: AbortSignal.timeout(timeout),
        });
      } catch (e) {
        const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
        o.logger.warn("data manager: ağ hatası ya da zaman aşımı", { error: msg });
        return { kind: "retry", code: null, error: msg };
      }
      const json = (await res.json().catch(() => null)) as GoogleErrorBody | null;
      if (res.ok) {
        o.logger.info("data manager: istek kabul edildi", {
          status: res.status,
          requestId: json?.requestId ?? null,
          events: request.events.length,
          validateOnly: request.validateOnly === true,
          fieldWarnings: json?.fieldWarnings?.length ?? 0,
        });
        return { kind: "ok", code: res.status, requestId: json?.requestId ?? null };
      }
      const err = json?.error ?? {};
      const message = `${err.message ?? `HTTP ${res.status}`}${err.status ? ` (${err.status})` : ""}`;
      const transient = res.status === 429 || res.status >= 500;
      o.logger.warn("data manager: istek reddedildi", {
        status: res.status,
        googleStatus: err.status ?? null,
        transient,
      });
      return transient
        ? { kind: "retry", code: res.status, error: message }
        : { kind: "dead", code: res.status, error: message };
    },

    async retrieveStatus(requestId) {
      const token = await o.tokens.accessToken();
      const res = await fetchImpl(`${o.statusUrl ?? GOOGLE_DM_STATUS_URL}?requestId=${encodeURIComponent(requestId)}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        signal: AbortSignal.timeout(timeout),
      });
      const json = (await res.json().catch(() => null)) as GoogleErrorBody | null;
      if (!res.ok) {
        const e = json?.error ?? {};
        o.logger.warn("data manager: durum sorgusu reddedildi", { status: res.status, googleStatus: e.status ?? null });
        throw new Error(`${e.message ?? `HTTP ${res.status}`}${e.status ? ` (${e.status})` : ""}`);
      }
      return translateRequestStatus(requestId, json);
    },
  };
}
