/**
 * Web sitesinin çekme API'si v1 istemcisi (site sunar; docs/runbooks/web-form.md "Çekme modu"). Push ile aynı imza
 * şeması ve aynı anahtar (WEB_FORM_HMAC_KEY):
 *   X-Webform-Timestamp: <Unix saniye>
 *   X-Webform-Signature: sha256=<hex HMAC-SHA256(anahtar, "<timestamp>." + ham gövde)>
 * Gövde imzalandığı bayt dizisiyle gönderilir. Uçlar `<taban>/pending` ve `<taban>/ack`; taban `?rest_route=` içeriyorsa
 * yol o değerin sonuna eklenir, değilse adres yoluna.
 *   /pending {"op":"pending","limit":n}           → {"ok":true,"items":[{"submission_id","payload"}],"more":bool}
 *   /ack     {"op":"ack","items":[{submission_id,status}]} → {"ok":true,"acked":n,"unknown":[…]}
 * Hatalar `PullSourceError` olarak fırlatılır; yanıt gövdesi (kişisel veri) loglanmaz.
 */
import { PullSourceError, type PulledItem, type PullAckStatus, type PullSource } from "../../application";
import { WEB_PROVIDER } from "./adapter";
import { WEB_FORM_HEADERS, signWebForm } from "./signature";

export type PullFetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface WebPullClientOptions {
  /** Taban adres (WEB_PULL_URL), ör. https://www.unixpadel.com/?rest_route=/unixpadel/v1/crm */
  baseUrl: string;
  secret: string;
  fetchImpl?: PullFetchLike;
  /** Testler: imza zaman damgası için şimdi (ms). */
  now?: () => number;
  timeoutMs?: number;
}

/** `<taban>/pending` ve `<taban>/ack`: rest_route değerinin ya da yolun sonuna eklenir; sorgu dizesi korunur. */
export function webPullEndpoint(baseUrl: string, op: "pending" | "ack"): string {
  const base = baseUrl.trim();
  const m = /([?&]rest_route=)([^&#]*)/.exec(base);
  if (m) {
    const value = m[2]!.replace(/(\/|%2F)+$/i, "");
    return base.slice(0, m.index) + m[1] + value + "/" + op + base.slice(m.index + m[0].length);
  }
  const u = new URL(base);
  u.pathname = `${u.pathname.replace(/\/+$/, "")}/${op}`;
  return u.toString();
}

/** Sözleşmedeki imza başlıkları; `body` tam olarak gönderilecek metindir. */
export function signPullRequest(secret: string, nowMs: number, body: string): Record<string, string> {
  const ts = Math.floor(nowMs / 1000);
  return {
    "content-type": "application/json",
    [WEB_FORM_HEADERS.timestamp]: String(ts),
    [WEB_FORM_HEADERS.signature]: `sha256=${signWebForm(secret, ts, body)}`,
  };
}

const SUBMISSION_ID_MAX = 128;

/**
 * Sözleşme öğesi → inbox kaydı. `submission_id` üst seviyededir; adaptör onu payload içinde aradığı için payload'a
 * yazılır (push gövdesiyle aynı biçim, aynı dedupe anahtarı). Kimliksiz öğe null (onaylanamaz).
 */
export function webPullItemToInbox(item: PulledItem): { platformLeadId: string; payload: unknown } | null {
  const raw = item.submissionId;
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const id = String(raw).trim();
  if (id.length > SUBMISSION_ID_MAX || !/^[A-Za-z0-9._:-]+$/.test(id)) return null;
  const p = item.payload;
  const base = p && typeof p === "object" && !Array.isArray(p) ? (p as Record<string, unknown>) : {};
  return { platformLeadId: id, payload: { ...base, submission_id: id } };
}

const REASONS = new Set(["missing", "malformed", "stale", "mismatch"]);

function errorFor(status: number, body: unknown): PullSourceError {
  const b = (body && typeof body === "object" ? body : {}) as { reason?: unknown; error?: unknown };
  if (status === 401) {
    const reason = typeof b.reason === "string" && REASONS.has(b.reason) ? b.reason : "unknown";
    return new PullSourceError(`unauthorized.${reason}`, "config", status);
  }
  if (status === 400) return new PullSourceError("bad_request", "config", status);
  if (status === 429) return new PullSourceError("rate_limited", "transient", status);
  if (status === 503 && b.error === "not_configured") return new PullSourceError("not_configured", "config", status);
  if (status >= 500) return new PullSourceError(`http_${status}`, "transient", status);
  return new PullSourceError(`http_${status}`, "config", status);
}

export function createWebPullClient(opts: WebPullClientOptions): PullSource & { readonly provider: string } {
  const fetchImpl: PullFetchLike = opts.fetchImpl ?? ((i, init) => fetch(i, init));
  const now = opts.now ?? Date.now;
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const urls = { pending: webPullEndpoint(opts.baseUrl, "pending"), ack: webPullEndpoint(opts.baseUrl, "ack") };

  async function call(op: "pending" | "ack", payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const body = JSON.stringify(payload);
    const signal = AbortSignal.timeout(timeoutMs);
    let res: Response;
    try {
      res = await fetchImpl(urls[op], {
        method: "POST",
        headers: signPullRequest(opts.secret, now(), body),
        body,
        signal,
      });
    } catch (e) {
      const timeout = (e as { name?: string })?.name === "TimeoutError" || signal.aborted;
      throw new PullSourceError(timeout ? "timeout" : "network", "transient");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(await res.text());
    } catch {
      parsed = null;
    }
    if (res.status !== 200) throw errorFor(res.status, parsed);
    if (!parsed || typeof parsed !== "object" || (parsed as { ok?: unknown }).ok !== true) {
      throw new PullSourceError("bad_response", "config", res.status);
    }
    return parsed as Record<string, unknown>;
  }

  return {
    provider: WEB_PROVIDER,
    async pending(limit) {
      const r = await call("pending", { op: "pending", limit: Math.min(100, Math.max(1, Math.floor(limit))) });
      if (!Array.isArray(r["items"])) throw new PullSourceError("bad_response", "config", 200);
      const items: PulledItem[] = (r["items"] as unknown[]).map((it) => {
        const o = (it && typeof it === "object" ? it : {}) as { submission_id?: unknown; payload?: unknown };
        return { submissionId: o.submission_id, payload: o.payload };
      });
      return { items, more: r["more"] === true };
    },
    async ack(items: readonly { submissionId: string; status: PullAckStatus }[]) {
      const r = await call("ack", {
        op: "ack",
        items: items.map((i) => ({ submission_id: i.submissionId, status: i.status })),
      });
      const unknown = Array.isArray(r["unknown"]) ? (r["unknown"] as unknown[]).map(String) : [];
      const acked = typeof r["acked"] === "number" ? r["acked"] : 0;
      return { acked, unknown };
    },
  };
}
