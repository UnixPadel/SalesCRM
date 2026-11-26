/**
 * Eşlenmiş alanlardan InboundLeadDto üretir; adaptörler ortak işi (ülke çözümü, ek yanıtlar) burada bırakır.
 */
import type { MappedFields } from "../../integration-settings/application";
import { countryCodeFrom, readIntakePhone } from "./country";
import { normalizeFormAnswers } from "./formAnswers";
import type { InboundAttribution, InboundCampaign, InboundConsent, InboundLeadDto, InboundSource } from "./dto";

export interface BuildLeadInput {
  source: InboundSource;
  provider: string;
  platformLeadId: string;
  formId: string | null;
  mapped: MappedFields;
  campaign?: InboundCampaign;
  attribution?: InboundAttribution;
  consents?: InboundConsent[];
  isTest: boolean;
  submittedAt: Date | null;
  defaultCountry: string;
  /** Adaptörün eklemek istediği ek yanıtlar (ör. ham ülke metni, platform meta verisi). */
  extra?: Record<string, unknown>;
  /** Reklam yüzeyi, opak kod (Faz 7g). */
  adSurface?: string | null;
}

export function buildInboundLead(input: BuildLeadInput): InboundLeadDto {
  const m = input.mapped;
  const formCountry = countryCodeFrom(m.country);
  // Telefon formdaki ülkeyle okunur; ülke yoksa numaranın kendisi ülkeyi gösterebilir (yalnız gerçek kanıtla).
  const read = m.phone ? readIntakePhone(m.phone, formCountry, input.defaultCountry, { keepPossible: !m.email }) : null;
  const phone = read?.value || null;
  const country = formCountry ?? read?.country ?? null;
  const extraAnswers: Record<string, unknown> = { ...m.extra, ...(input.extra ?? {}) };
  // Ülke metni çözülemediyse (telefondan bulunsa bile) ham değer ek yanıtta kalsın: admin görsün.
  if (m.country && formCountry === null) extraAnswers["country_raw"] = m.country;
  // Faz 7g (D5, D6): ülke formda yoksa telefondan geldiğini işaretle; form cevaplarını kodlara çevir.
  if (country && formCountry === null) extraAnswers["country_source"] = "phone";
  // Ülke kodsuz yerel numaraya eklenen kod işaretlenir (bilgi uyarısı); kod numaranın okunduğu ülkenindir.
  if (read?.addedDialCode) extraAnswers["dial_code_assumed"] = read.addedDialCode;
  const answers = normalizeFormAnswers({}, m.extra);
  if (answers.unmatched.length) extraAnswers["unmatched_answers"] = answers.unmatched;
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
    consents: input.consents ?? [],
    isTest: input.isTest,
    extraAnswers,
    submittedAt: input.submittedAt,
    profile: {
      installSite: answers.installSite,
      installTimeline: answers.installTimeline,
      customerProfile: answers.customerProfile,
      courtCountBand: answers.courtCountBand,
    },
    courtCount: answers.courtCount,
    adSurface: input.adSurface ?? null,
  };
}
