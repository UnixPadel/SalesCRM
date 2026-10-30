/**
 * Conversions API istemcisi: POST https://graph.facebook.com/<sürüm>/<DATASET_ID>/events, token Authorization
 * başlığında (URL'de ve gövdede değil; loglara sızmasın). Yanıt sınıflandırması dağıtıcının SendResult'ına:
 *  2xx → ok · 429, 5xx, Graph geçici kodları, zaman aşımı, ağ → retry · 400 ve diğer 4xx → dead.
 */
import type { Logger } from "../../../shared/kernel";
import type { SendResult } from "../../application";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface CapiClientOptions {
  graphVersion: string;
  token: string;
  logger: Logger;
  fetchImpl?: FetchLike | undefined;
  timeoutMs?: number | undefined;
}

export interface CapiClient {
  /** `body` builder'ın ürettiği JSON metni (lead_id sayı olarak). */
  sendEvents(datasetId: string, body: string): Promise<SendResult>;
}

interface GraphErrorBody {
  error?: { message?: string; type?: string; code?: number; error_subcode?: number; fbtrace_id?: string };
}

const TRANSIENT_CODES = new Set([1, 2, 4, 17, 32, 341, 613]);

export function createCapiClient(o: CapiClientOptions): CapiClient {
  const fetchImpl: FetchLike = o.fetchImpl ?? ((u, i) => fetch(u, i));
  const timeout = o.timeoutMs ?? 15_000;
  return {
    async sendEvents(datasetId, body) {
      if (!o.token) return { kind: "retry", code: null, error: "Conversions API token'ı tanımlı değil." };
      if (!datasetId) return { kind: "retry", code: null, error: "Veri seti kimliği tanımlı değil." };
      const url = `https://graph.facebook.com/${o.graphVersion}/${encodeURIComponent(datasetId)}/events`;
      let res: Response;
      try {
        res = await fetchImpl(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${o.token}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body,
          signal: AbortSignal.timeout(timeout),
        });
      } catch (e) {
        const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
        o.logger.warn("capi: ağ hatası ya da zaman aşımı", { error: msg });
        return { kind: "retry", code: null, error: msg };
      }
      const json = (await res.json().catch(() => null)) as (GraphErrorBody & { events_received?: number }) | null;
      if (res.ok) {
        o.logger.info("capi: olaylar alındı", { status: res.status, received: json?.events_received ?? null });
        return { kind: "ok", code: res.status };
      }
      const err = json?.error ?? {};
      const message = `${err.message ?? `HTTP ${res.status}`}${err.code !== undefined ? ` (code ${err.code}${err.error_subcode ? `/${err.error_subcode}` : ""})` : ""}`;
      const transient =
        res.status === 429 || res.status >= 500 || (err.code !== undefined && TRANSIENT_CODES.has(err.code));
      o.logger.warn("capi: istek reddedildi", {
        status: res.status,
        code: err.code ?? null,
        subcode: err.error_subcode ?? null,
        trace: err.fbtrace_id ?? null,
        transient,
      });
      return transient
        ? { kind: "retry", code: res.status, error: message }
        : { kind: "dead", code: res.status, error: message };
    },
  };
}
