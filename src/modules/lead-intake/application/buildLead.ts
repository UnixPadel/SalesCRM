/**
 * Eşlenmiş alanlardan InboundLeadDto üretir; adaptörler ortak işi (ülke çözümü, ek yanıtlar) burada bırakır.
 */
import type { MappedFields } from "../../integration-settings/application";
import { countryCodeFrom, resolveCountry } from "./country";
import type { InboundAttribution, InboundCampaign, InboundLeadDto, InboundSource } from "./dto";

export interface BuildLeadInput {
  source: InboundSource;
  provider: string;
  platformLeadId: string;
  formId: string | null;
  mapped: MappedFields;
  campaign?: InboundCampaign;
  attribution?: InboundAttribution;
  isTest: boolean;
  submittedAt: Date | null;
  defaultCountry: string;
  /** Adaptörün eklemek istediği ek yanıtlar (ör. ham ülke metni, platform meta verisi). */
  extra?: Record<string, unknown>;
}

export function buildInboundLead(input: BuildLeadInput): InboundLeadDto {
  const m = input.mapped;
  const phone = m.phone || null;
  const country = resolveCountry(m.country, phone, input.defaultCountry);
  const extraAnswers: Record<string, unknown> = { ...m.extra, ...(input.extra ?? {}) };
  // Ülke metni çözülemediyse (telefondan bulunsa bile) ham değer ek yanıtta kalsın: admin görsün.
  if (m.country && countryCodeFrom(m.country) === null) extraAnswers["country_raw"] = m.country;
  return {
    source: input.source,
    provider: input.provider,
    platformLeadId: input.platformLeadId,
    formId: input.formId,
    fullName: m.fullName,
    email: m.email || null,
    phone,
    country,
    city: m.city,
    company: m.company,
    productInterest: m.productInterest,
    notes: m.notes,
    campaign: input.campaign ?? {},
    attribution: input.attribution ?? {},
    isTest: input.isTest,
    extraAnswers,
    submittedAt: input.submittedAt,
  };
}
