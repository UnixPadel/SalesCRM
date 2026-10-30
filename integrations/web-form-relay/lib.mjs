/**
 * Web formu aktarıcısı (site tarafı referans uygulaması) — saf mantık. Bağımlılık yok; Node 20+.
 *
 * Akış: site formu POST → buildSubmission (alanlar, tıklama kimlikleri, onaylar, honeypot) → FileQueue.put
 * (önce diske: CRM kapalıysa gönderim kaybolmaz) → deliver (HMAC imzalı POST /forms/web) → başarıda dosya silinir,
 * aksi hâlde retry döngüsü (processQueue) yeniden dener. CRM aynı submission_id'yi iki kez görürse tek lead açar.
 *
 * Gövde sözleşmesi ve imza şeması: docs/runbooks/web-form.md (CRM tarafı: src/modules/lead-intake/adapters/web-form).
 */
import { createHmac, randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const HEADERS = { signature: "x-webform-signature", timestamp: "x-webform-timestamp" };

/** Formdan gelen ama lead alanı olmayan anahtarlar. */
export const ATTRIBUTION_KEYS = [
  "gclid",
  "gbraid",
  "wbraid",
  "fbclid",
  "fbc",
  "fbp",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "landing_url",
  "click_at",
];
const META_KEYS = ["form_id", "page_url", "is_test", "submission_id", "submitted_at"];
export const CONSENT_PREFIX = "consent_";

/** Varsayılan çerez eşlemesi (MarcaDM GTM kurulumu birinci taraf çerezlerde saklar). `_gcl_aw`: "GCL.<ts>.<gclid>". */
export const DEFAULT_COOKIE_MAP = {
  gclid: "_gcl_aw",
  gbraid: "_gcl_gb",
  wbraid: "_gcl_gs",
  fbc: "_fbc",
  fbp: "_fbp",
  utm_source: "utm_source",
  utm_medium: "utm_medium",
  utm_campaign: "utm_campaign",
  utm_term: "utm_term",
  utm_content: "utm_content",
  landing_url: "landing_url",
};

const text = (v) =>
  (v === null || v === undefined ? "" : Array.isArray(v) ? v.map(String).join(", ") : String(v)).trim();
const truthy = (v) => v === true || ["true", "1", "on", "yes", "evet"].includes(text(v).toLowerCase());

export function parseCookies(header) {
  const out = {};
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k) continue;
    try {
      out[k] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      out[k] = part.slice(i + 1).trim();
    }
  }
  return out;
}

/** Google'ın `_gcl_*` çerezleri "GCL.<timestamp>.<id>" biçimindedir; yalnız kimlik alınır. */
const cookieValue = (name, raw) => (raw && name.startsWith("_gcl_") ? raw.split(".").pop() : raw) || "";

/**
 * Site formu → CRM gövdesi (sürüm 1).
 * @param form  Form alanları (urlencoded ya da JSON çözülmüş): { ad: "…", email: "…", consent_kvkk: "on", website: "" }
 * @param ctx   { now: Date, id?: string, pageUrl?: string, cookies?: Record<string,string>, formId?: string,
 *                consentTextVersion?: string, honeypotField?: string, cookieMap?: Record<string,string> }
 */
export function buildSubmission(form, ctx) {
  const honeypotField = ctx.honeypotField ?? "website";
  const cookieMap = ctx.cookieMap ?? DEFAULT_COOKIE_MAP;
  const cookies = ctx.cookies ?? {};
  const fields = {};
  const attribution = {};
  const consents = [];
  let honeypot = "";
  for (const [rawKey, value] of Object.entries(form ?? {})) {
    const key = rawKey.trim();
    if (!key) continue;
    if (key === honeypotField) honeypot = text(value);
    else if (ATTRIBUTION_KEYS.includes(key)) {
      if (text(value)) attribution[key] = text(value);
    } else if (key.startsWith(CONSENT_PREFIX)) {
      const type = key.slice(CONSENT_PREFIX.length);
      if (type) consents.push({ type, granted: truthy(value), text_version: ctx.consentTextVersion ?? "" });
    } else if (!META_KEYS.includes(key)) fields[key] = Array.isArray(value) ? value.map(String) : text(value);
  }
  for (const [attrKey, cookieName] of Object.entries(cookieMap)) {
    if (!attribution[attrKey]) {
      const v = cookieValue(cookieName, cookies[cookieName]);
      if (v) attribution[attrKey] = v;
    }
  }
  const pageUrl = text(form?.page_url) || ctx.pageUrl || "";
  if (!attribution.landing_url && pageUrl) attribution.landing_url = pageUrl;
  return {
    submission_id: ctx.id ?? randomUUID(),
    form_id: text(form?.form_id) || ctx.formId || null,
    submitted_at: ctx.now.toISOString(),
    page_url: pageUrl || null,
    fields,
    attribution,
    consents,
    honeypot,
    is_test: truthy(form?.is_test),
  };
}

export function signBody(secret, timestampSeconds, body) {
  return createHmac("sha256", secret).update(`${timestampSeconds}.`).update(body).digest("hex");
}

/**
 * Tek dosyalık kuyruk: her gönderim `<dir>/<zaman>-<id>.json`. Kalıcı reddedilenler (400/401/413) `<dir>/failed/`
 * klasörüne taşınır; anahtar düzeltilince dosya geri taşınarak yeniden denenir.
 */
export class FileQueue {
  constructor(dir) {
    this.dir = dir;
    this.failedDir = join(dir, "failed");
    mkdirSync(this.failedDir, { recursive: true });
  }
  put(payload) {
    const name = `${payload.submitted_at.replace(/[:.]/g, "-")}-${payload.submission_id}.json`;
    const tmp = join(this.dir, `${name}.tmp`);
    writeFileSync(tmp, JSON.stringify({ payload, attempts: 0 }), "utf8");
    renameSync(tmp, join(this.dir, name));
    return name;
  }
  list() {
    return readdirSync(this.dir)
      .filter((n) => n.endsWith(".json"))
      .sort();
  }
  read(name) {
    return JSON.parse(readFileSync(join(this.dir, name), "utf8"));
  }
  bump(name, entry, error) {
    writeFileSync(
      join(this.dir, name),
      JSON.stringify({ ...entry, attempts: entry.attempts + 1, lastError: error }),
      "utf8",
    );
  }
  remove(name) {
    unlinkSync(join(this.dir, name));
  }
  fail(name, error) {
    const entry = this.read(name);
    writeFileSync(join(this.failedDir, name), JSON.stringify({ ...entry, lastError: error }), "utf8");
    unlinkSync(join(this.dir, name));
  }
  size() {
    return this.list().length;
  }
}

/**
 * CRM'e imzalı gönderim. Dönüş: { ok: true, status } | { ok: false, retryable, error }.
 * 200 → ok (CRM "duplicate" derse de ok: yeniden denemede aynı submission_id tek lead açar).
 */
export async function deliver(payload, opts) {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const body = JSON.stringify(payload);
  const ts = Math.floor((opts.now ?? Date.now)() / 1000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 8000);
  try {
    const res = await fetchImpl(opts.crmUrl, {
      method: "POST",
      body,
      headers: {
        "content-type": "application/json",
        [HEADERS.timestamp]: String(ts),
        [HEADERS.signature]: `sha256=${signBody(opts.secret, ts, body)}`,
      },
      signal: controller.signal,
    });
    if (res.status === 200) {
      const json = await res.json().catch(() => ({}));
      return { ok: true, status: json.status ?? "accepted" };
    }
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    const retryable = res.status === 429 || res.status === 503 || res.status >= 500;
    return { ok: false, retryable, error: `HTTP ${res.status} ${detail}` };
  } catch (e) {
    return { ok: false, retryable: true, error: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Kuyruğu eskiden yeniye boşaltır. Geçici hatada (CRM kapalı) döngü o dosyada durur: aynı anda tüm
 * kuyruğu CRM'e yığmaz, bir sonraki tikte kaldığı yerden sürer. Kalıcı hata dosyayı failed/'e taşır.
 */
export async function processQueue(queue, opts) {
  const log = opts.log ?? (() => {});
  const stats = { delivered: 0, failed: 0, pending: 0 };
  for (const name of queue.list()) {
    const entry = queue.read(name);
    const r = await deliver(entry.payload, opts);
    if (r.ok) {
      queue.remove(name);
      stats.delivered += 1;
      log("info", "relay: iletildi", {
        submissionId: entry.payload.submission_id,
        status: r.status,
        attempts: entry.attempts + 1,
      });
    } else if (r.retryable) {
      queue.bump(name, entry, r.error);
      log("warn", "relay: CRM'e ulaşılamadı, kuyrukta bekliyor", { error: r.error, queued: queue.size() });
      stats.pending = queue.size();
      break;
    } else {
      queue.fail(name, r.error);
      stats.failed += 1;
      log("error", "relay: CRM gönderimi reddetti, failed/ klasörüne taşındı", {
        submissionId: entry.payload.submission_id,
        error: r.error,
      });
    }
  }
  return stats;
}
