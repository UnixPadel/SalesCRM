/**
 * Graph API istemcisi: tek sürüm (config), sistem kullanıcısı token'ı, hata sınıflandırması.
 * Token loglanmaz ve URL'ye yazılmaz (Authorization başlığı).
 */
import { PermanentError, TransientError, type Logger } from "../../../shared/kernel";

export interface GraphFieldData {
  name: string;
  values: unknown[];
}

export interface GraphLead {
  id: string;
  created_time?: string;
  form_id?: string;
  field_data?: GraphFieldData[];
  ad_id?: string;
  ad_name?: string;
  adset_id?: string;
  adset_name?: string;
  campaign_id?: string;
  campaign_name?: string;
  is_organic?: boolean;
  platform?: string;
  [k: string]: unknown;
}

export interface GraphClient {
  getLead(leadgenId: string): Promise<GraphLead>;
  /** Formun belirli bir andan sonra oluşmuş lead'leri (sayfalama içeride). */
  getFormLeads(formId: string, since: Date): Promise<GraphLead[]>;
  subscribePage(pageId: string, pageAccessToken?: string): Promise<{ success: boolean }>;
  getSubscribedApps(pageId: string, pageAccessToken?: string): Promise<unknown>;
}

export const LEAD_FIELDS =
  "id,created_time,form_id,field_data,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,is_organic,platform";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface GraphClientOptions {
  version: string;
  token: string;
  logger: Logger;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  maxPages?: number;
}

interface GraphErrorBody {
  error?: { message?: string; type?: string; code?: number; error_subcode?: number; fbtrace_id?: string };
}

const TRANSIENT_CODES = new Set([1, 2, 4, 17, 32, 341, 613]); // bilinmeyen, geçici, oran sınırları
const RETRY_STATUS = (s: number) => s === 429 || s >= 500;

export function createGraphClient(o: GraphClientOptions): GraphClient {
  const base = `https://graph.facebook.com/${o.version}`;
  const fetchImpl: FetchLike = o.fetchImpl ?? ((u, i) => fetch(u, i));
  const timeout = o.timeoutMs ?? 10_000;

  async function call<T>(
    method: "GET" | "POST",
    path: string,
    params: Record<string, string>,
    token = o.token,
  ): Promise<T> {
    if (!token) throw new PermanentError("meta.token_missing", "Sistem kullanıcısı token'ı tanımlı değil.");
    const url = new URL(`${base}/${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    let res: Response;
    try {
      res = await fetchImpl(url.toString(), {
        method,
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        signal: AbortSignal.timeout(timeout),
      });
    } catch (e: unknown) {
      throw new TransientError("meta.network", "Graph API'ye ulaşılamadı.", { path }, e);
    }
    const body: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const err = (body as GraphErrorBody | null)?.error ?? {};
      const details = {
        path,
        status: res.status,
        code: err.code ?? null,
        subcode: err.error_subcode ?? null,
        trace: err.fbtrace_id ?? null,
      };
      const message = err.message ?? `Graph API ${res.status}`;
      if (RETRY_STATUS(res.status) || (err.code !== undefined && TRANSIENT_CODES.has(err.code))) {
        throw new TransientError("meta.unavailable", message, details);
      }
      if (err.code === 190) throw new PermanentError("meta.token_invalid", message, details);
      if (err.code === 10 || err.code === 200 || err.code === 294) {
        throw new PermanentError("meta.permission", message, details);
      }
      throw new PermanentError("meta.bad_request", message, details);
    }
    return body as T;
  }

  return {
    getLead: (leadgenId) => call<GraphLead>("GET", leadgenId, { fields: LEAD_FIELDS }),

    async getFormLeads(formId, since) {
      const out: GraphLead[] = [];
      const filtering = JSON.stringify([
        { field: "time_created", operator: "GREATER_THAN", value: Math.floor(since.getTime() / 1000) },
      ]);
      let after: string | undefined;
      for (let page = 0; page < (o.maxPages ?? 20); page += 1) {
        const params: Record<string, string> = { fields: LEAD_FIELDS, filtering, limit: "100" };
        if (after) params["after"] = after;
        const res = await call<{ data?: GraphLead[]; paging?: { cursors?: { after?: string }; next?: string } }>(
          "GET",
          `${formId}/leads`,
          params,
        );
        out.push(...(res.data ?? []));
        if (!res.paging?.next || !res.paging.cursors?.after) break;
        after = res.paging.cursors.after;
      }
      return out;
    },

    subscribePage: (pageId, pageToken) =>
      call<{ success: boolean }>(
        "POST",
        `${pageId}/subscribed_apps`,
        { subscribed_fields: "leadgen" },
        pageToken ?? o.token,
      ),

    getSubscribedApps: (pageId, pageToken) => call("GET", `${pageId}/subscribed_apps`, {}, pageToken ?? o.token),
  };
}
