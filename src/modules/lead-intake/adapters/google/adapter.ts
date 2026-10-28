/**
 * Google Ads lead form uzantısı webhook'u. Gövde: lead_id, user_column_data[] (column_id, column_name,
 * string_value), form_id, campaign_id, adgroup_id, creative_id, gcl_id, is_test, google_key.
 *  - google_key sabit zamanlı karşılaştırılır; uyuşmazsa controller 401 döner.
 *  - column_id → form_field_mappings; tanınmayan sütunlar yok sayılır.
 *  - gcl_id → lead_attribution.gclid; is_test → test lead.
 */
import { applyMappings, type RawField } from "../../../integration-settings/application";
import { PermanentError, safeEqual } from "../../../shared/kernel";
import { buildInboundLead, type InboundLeadDto, type SourceAdapter } from "../../application";

export const GOOGLE_PROVIDER = "google";
export const GOOGLE_SECRET_NAMES = { webhookKey: "GOOGLE_LEAD_FORM_KEY" } as const;

export interface GoogleColumn {
  column_id?: unknown;
  column_name?: unknown;
  string_value?: unknown;
}

export interface GoogleLeadPayload {
  lead_id?: unknown;
  user_column_data?: unknown;
  api_version?: unknown;
  form_id?: unknown;
  campaign_id?: unknown;
  adgroup_id?: unknown;
  creative_id?: unknown;
  gcl_id?: unknown;
  is_test?: unknown;
  google_key?: unknown;
  [k: string]: unknown;
}

/** Gövdedeki anahtar beklenenle aynı mı (sabit zamanlı). Beklenen boşsa her zaman false. */
export function verifyGoogleKey(body: unknown, expectedKey: string): boolean {
  if (!expectedKey) return false;
  const got = (body as GoogleLeadPayload | null)?.google_key;
  return typeof got === "string" && safeEqual(got, expectedKey);
}

/** Inbox'a yazmadan önce anahtar gövdeden çıkarılır: secret diske yazılmaz. */
export function stripGoogleKey(body: GoogleLeadPayload): GoogleLeadPayload {
  const { google_key: _omitted, ...rest } = body;
  void _omitted;
  return rest;
}

export function googleLeadId(body: unknown): string | null {
  const id = (body as GoogleLeadPayload | null)?.lead_id;
  return id === null || id === undefined || String(id).trim() === "" ? null : String(id).trim();
}

const str = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));

export function googleSourceAdapter(): SourceAdapter {
  return {
    provider: GOOGLE_PROVIDER,
    async toInboundLead(payload, ctx): Promise<InboundLeadDto> {
      const p = payload as GoogleLeadPayload | null;
      const leadId = googleLeadId(p);
      if (!leadId) throw new PermanentError("google.lead_without_id", "lead_id yok.", {});
      const formId = str(p?.form_id);
      const columns = Array.isArray(p?.user_column_data) ? (p.user_column_data as GoogleColumn[]) : [];
      const fields: RawField[] = columns
        .filter((c) => typeof c?.column_id === "string" && c.column_id)
        .map((c) => ({
          key: String(c.column_id),
          label: typeof c.column_name === "string" ? c.column_name : undefined,
          value: c.string_value ?? "",
        }));
      const mapped = applyMappings(fields, await ctx.mappingsFor(formId), "ignore");
      return buildInboundLead({
        source: "google_form",
        provider: GOOGLE_PROVIDER,
        platformLeadId: leadId,
        formId,
        mapped,
        campaign: { campaignId: str(p?.campaign_id), adsetId: str(p?.adgroup_id), adId: str(p?.creative_id) },
        attribution: { gclid: str(p?.gcl_id) },
        isTest: p?.is_test === true || p?.is_test === "true",
        submittedAt: null,
        defaultCountry: ctx.defaultCountry,
        extra: mapped.unmapped.length ? { ignored_columns: mapped.unmapped } : {},
      });
    },
  };
}
