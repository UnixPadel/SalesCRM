/**
 * Meta kaynak adaptörü: inbox payload'ı iki biçimde gelir.
 *  - { kind: "change", ...LeadgenChange }  webhook bildirimi; lead'in tamamı Graph API'den çekilir.
 *  - { kind: "lead", lead: GraphLead }     yedek senkron; zaten tam lead, çağrı yok.
 * field_data → form_field_mappings; eşlenmeyen alan hata değil, "ek yanıt".
 */
import { applyMappings, type RawField } from "../../../integration-settings/application";
import { PermanentError } from "../../../shared/kernel";
import {
  buildInboundLead,
  type AdapterContext,
  type BackfillSource,
  type InboundLeadDto,
  type SourceAdapter,
  dedupeKeyFor,
} from "../../application";
import type { GraphClient, GraphLead } from "./graphClient";
import type { LeadgenChange } from "./webhook";

export const META_PROVIDER = "meta";

export type MetaInboxPayload = ({ kind: "change" } & LeadgenChange) | { kind: "lead"; lead: GraphLead };

export const changePayload = (c: LeadgenChange): MetaInboxPayload => ({ kind: "change", ...c });
export const leadPayload = (lead: GraphLead): MetaInboxPayload => ({ kind: "lead", lead });

/** Lead Ads Testing Tool lead'leri: değerler "test lead: dummy data for <alan>" biçimindedir. */
const TEST_VALUE = /^test lead: dummy data/i;

export function isMetaTestLead(lead: GraphLead): boolean {
  return (lead.field_data ?? []).some((f) => (f.values ?? []).some((v) => TEST_VALUE.test(String(v))));
}

export async function graphLeadToDto(lead: GraphLead, ctx: AdapterContext): Promise<InboundLeadDto> {
  if (!lead.id) throw new PermanentError("meta.lead_without_id", "Lead kimliği yok.", {});
  const formId = lead.form_id ? String(lead.form_id) : null;
  const mapping = await ctx.mappingsFor(formId);
  const fields: RawField[] = (lead.field_data ?? []).map((f) => ({
    key: f.name,
    value: Array.isArray(f.values) && f.values.length === 1 ? f.values[0] : (f.values ?? []),
  }));
  const mapped = applyMappings(fields, mapping, "extra");
  const submittedAt = lead.created_time ? new Date(lead.created_time) : null;
  const extra: Record<string, unknown> = {};
  if (lead.is_organic !== undefined) extra["is_organic"] = lead.is_organic;
  if (lead.platform) extra["platform"] = lead.platform;
  return buildInboundLead({
    source: "meta_form",
    provider: META_PROVIDER,
    platformLeadId: String(lead.id),
    formId,
    mapped,
    campaign: {
      campaignId: lead.campaign_id ?? null,
      campaignName: lead.campaign_name ?? null,
      adsetId: lead.adset_id ?? null,
      adsetName: lead.adset_name ?? null,
      adId: lead.ad_id ?? null,
      adName: lead.ad_name ?? null,
    },
    attribution: {},
    isTest: isMetaTestLead(lead),
    submittedAt: submittedAt && !Number.isNaN(submittedAt.getTime()) ? submittedAt : null,
    defaultCountry: ctx.defaultCountry,
    extra,
  });
}

export function metaSourceAdapter(graph: GraphClient): SourceAdapter {
  return {
    provider: META_PROVIDER,
    async toInboundLead(payload, ctx) {
      const p = payload as Partial<MetaInboxPayload> | null;
      if (p?.kind === "lead" && p.lead) return graphLeadToDto(p.lead, ctx);
      if (p?.kind === "change" && p.leadgenId) {
        const lead = await graph.getLead(p.leadgenId);
        if (!lead.form_id && p.formId) lead.form_id = p.formId;
        return graphLeadToDto(lead, ctx);
      }
      throw new PermanentError("meta.payload_unknown", "Inbox payload'ı tanınmadı.", { kind: p?.kind ?? null });
    },
  };
}

/** Saatlik yedek senkron: her aktif form için `since`'ten bu yana oluşan lead'ler, aynı inbox'a. */
export function metaBackfillSource(graph: GraphClient, activeFormIds: () => Promise<string[]>): BackfillSource {
  return {
    provider: META_PROVIDER,
    async fetchSince(since) {
      const out: { dedupeKey: string; payload: unknown }[] = [];
      for (const formId of await activeFormIds()) {
        for (const lead of await graph.getFormLeads(formId, since)) {
          if (!lead.form_id) lead.form_id = formId;
          out.push({ dedupeKey: dedupeKeyFor(META_PROVIDER, String(lead.id)), payload: leadPayload(lead) });
        }
      }
      return out;
    },
  };
}
