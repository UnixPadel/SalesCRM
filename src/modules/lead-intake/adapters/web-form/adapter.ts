/**
 * Web sitesi formu (unixpadel.com) → InboundLeadDto. Site, formu tarayıcıdan değil kendi sunucusundan
 * imzalayarak gönderir (signature.ts). Gövde sözleşmesi (sürüm 1, docs/runbooks/web-form.md):
 *   submission_id  zorunlu; site üretir (UUID). Yeniden denemede aynı kimlik → aynı lead.
 *   form_id        isteğe bağlı; form bazlı eşleme için.
 *   submitted_at   ISO-8601; yoksa null.
 *   page_url       formun bulunduğu sayfa; landing_url verilmemişse onun yerine geçer.
 *   fields         { alan_adı: değer } — form_field_mappings (sağlayıcı "web"); eşlenmeyen alan ek yanıt.
 *   attribution    { gclid, gbraid, wbraid, fbclid, fbc, fbp, utm_*, landing_url, click_at } — çerezlerden.
 *   consents       [{ type, granted, text_version, granted_at }]
 *   honeypot       bot tuzağı; doluysa controller lead açmadan 200 döner.
 *   is_test        test gönderimi.
 */
import { applyMappings, type RawField } from "../../../integration-settings/application";
import { PermanentError } from "../../../shared/kernel";
import {
  buildInboundLead,
  type InboundAttribution,
  type InboundConsent,
  type InboundLeadDto,
  type SourceAdapter,
} from "../../application";

export const WEB_PROVIDER = "web";
export const WEB_SECRET_NAMES = { hmacKey: "WEB_FORM_HMAC_KEY" } as const;
export const WEB_HONEYPOT_FIELD = "honeypot";

export interface WebFormAttributionPayload {
  gclid?: unknown;
  gbraid?: unknown;
  wbraid?: unknown;
  fbclid?: unknown;
  fbc?: unknown;
  fbp?: unknown;
  utm_source?: unknown;
  utm_medium?: unknown;
  utm_campaign?: unknown;
  utm_term?: unknown;
  utm_content?: unknown;
  landing_url?: unknown;
  click_at?: unknown;
}

export interface WebFormConsentPayload {
  type?: unknown;
  granted?: unknown;
  text_version?: unknown;
  granted_at?: unknown;
}

export interface WebFormPayload {
  submission_id?: unknown;
  form_id?: unknown;
  submitted_at?: unknown;
  page_url?: unknown;
  fields?: unknown;
  attribution?: unknown;
  consents?: unknown;
  honeypot?: unknown;
  is_test?: unknown;
  [k: string]: unknown;
}

const MAX_TEXT = 512;

const str = (v: unknown, max = MAX_TEXT): string | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === "object") return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};

const isoDate = (v: unknown): Date | null => {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

const truthy = (v: unknown): boolean =>
  v === true || (typeof v === "string" && ["true", "1", "on", "yes", "evet"].includes(v.trim().toLowerCase()));

export function webFormSubmissionId(body: unknown): string | null {
  return str((body as WebFormPayload | null)?.submission_id, 128);
}

/** Honeypot alanı dolu mu (bot). Alan hiç yoksa ya da boşsa insan sayılır. */
export function isHoneypotFilled(body: unknown): boolean {
  const v = (body as WebFormPayload | null)?.[WEB_HONEYPOT_FIELD];
  return typeof v === "string" ? v.trim() !== "" : v !== undefined && v !== null && v !== false;
}

export function webFormIsTest(body: unknown): boolean {
  return truthy((body as WebFormPayload | null)?.is_test);
}

function parseAttribution(raw: unknown, pageUrl: string | null): InboundAttribution {
  const a = (raw && typeof raw === "object" ? raw : {}) as WebFormAttributionPayload;
  return {
    gclid: str(a.gclid),
    gbraid: str(a.gbraid),
    wbraid: str(a.wbraid),
    fbclid: str(a.fbclid),
    fbc: str(a.fbc),
    fbp: str(a.fbp),
    utmSource: str(a.utm_source),
    utmMedium: str(a.utm_medium),
    utmCampaign: str(a.utm_campaign),
    utmTerm: str(a.utm_term),
    utmContent: str(a.utm_content),
    landingUrl: str(a.landing_url, 2048) ?? pageUrl,
    clickAt: isoDate(a.click_at),
  };
}

/** Onay türü koda indirgenir (küçük harf, [a-z0-9_]); boş kalan ya da nesne olmayan girdi atlanır. */
function parseConsents(raw: unknown): InboundConsent[] {
  if (!Array.isArray(raw)) return [];
  const out: InboundConsent[] = [];
  for (const c of raw as WebFormConsentPayload[]) {
    if (!c || typeof c !== "object") continue;
    const type = String(c.type ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 64);
    if (!type || !/^[a-z]/.test(type)) continue;
    out.push({
      type,
      granted: truthy(c.granted),
      textVersion: str(c.text_version, 64),
      grantedAt: isoDate(c.granted_at),
    });
  }
  return out;
}

function toRawFields(raw: unknown): RawField[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const out: RawField[] = [];
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const k = key.trim();
    if (!k || k === WEB_HONEYPOT_FIELD) continue;
    const v = value && typeof value === "object" && !Array.isArray(value) ? JSON.stringify(value) : value;
    out.push({ key: k, value: typeof v === "string" ? v.slice(0, 4000) : v });
  }
  return out;
}

export function webFormSourceAdapter(): SourceAdapter {
  return {
    provider: WEB_PROVIDER,
    async toInboundLead(payload, ctx): Promise<InboundLeadDto> {
      const p = payload as WebFormPayload | null;
      const submissionId = webFormSubmissionId(p);
      if (!submissionId) throw new PermanentError("web.submission_without_id", "submission_id yok.", {});
      const formId = str(p?.form_id, 128);
      const pageUrl = str(p?.page_url, 2048);
      const mapped = applyMappings(toRawFields(p?.fields), await ctx.mappingsFor(formId), "extra");
      return buildInboundLead({
        source: "web_form",
        provider: WEB_PROVIDER,
        platformLeadId: submissionId,
        formId,
        mapped,
        attribution: parseAttribution(p?.attribution, pageUrl),
        consents: parseConsents(p?.consents),
        isTest: webFormIsTest(p),
        submittedAt: isoDate(p?.submitted_at),
        defaultCountry: ctx.defaultCountry,
        extra: pageUrl ? { page_url: pageUrl } : {},
      });
    },
  };
}
