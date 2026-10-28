import type { Lead, LeadSource, Person, StageCode, StageEvent, StageEventOrigin } from "../domain";

/** Satır ↔ domain nesnesi çevirisi. Sütun adları db/migrations/0001 ile birebir. */

export interface LeadRow extends Record<string, unknown> {
  id: string;
  source: string;
  platform_lead_id: string | null;
  form_id: string | null;
  person_id: string;
  full_name: string;
  email: string | null;
  phone_e164: string | null;
  country: string | null;
  city: string;
  company: string;
  product_interest: string;
  campaign_id: string | null;
  campaign_name: string | null;
  adset_id: string | null;
  adset_name: string | null;
  ad_id: string | null;
  ad_name: string | null;
  assigned_user_id: string | null;
  current_stage: string;
  is_test: boolean;
  notes: string;
  extra_answers: Record<string, unknown> | string;
  created_at: Date | string;
  updated_at: Date | string;
}

const date = (v: Date | string): Date => (v instanceof Date ? v : new Date(v));
const json = <T>(v: T | string): T => (typeof v === "string" ? (JSON.parse(v) as T) : v);

export function leadFromRow(r: LeadRow): Lead {
  return {
    id: r.id,
    source: r.source as LeadSource,
    platformLeadId: r.platform_lead_id,
    formId: r.form_id,
    personId: r.person_id,
    fullName: r.full_name,
    email: r.email,
    phoneE164: r.phone_e164,
    country: r.country,
    city: r.city,
    company: r.company,
    productInterest: r.product_interest,
    campaign: {
      campaignId: r.campaign_id,
      campaignName: r.campaign_name,
      adsetId: r.adset_id,
      adsetName: r.adset_name,
      adId: r.ad_id,
      adName: r.ad_name,
    },
    assignedUserId: r.assigned_user_id,
    currentStage: r.current_stage as StageCode,
    isTest: r.is_test,
    notes: r.notes,
    extraAnswers: json(r.extra_answers),
    createdAt: date(r.created_at),
    updatedAt: date(r.updated_at),
  };
}

export interface PersonRow extends Record<string, unknown> {
  id: string;
  full_name: string;
  email_normalized: string | null;
  phone_e164: string | null;
  country: string | null;
  company: string;
  created_at: Date | string;
}

export const personFromRow = (r: PersonRow): Person => ({
  id: r.id,
  fullName: r.full_name,
  emailNormalized: r.email_normalized,
  phoneE164: r.phone_e164,
  country: r.country,
  company: r.company,
  createdAt: date(r.created_at),
});

export interface StageEventRow extends Record<string, unknown> {
  id: string;
  lead_id: string;
  change_id: string;
  stage_code: string;
  occurred_at: Date | string;
  sequence: number;
  actor_user_id: string | null;
  origin: string;
  value_amount: string | number | null;
  currency: string | null;
  lost_reason_code: string | null;
  qualification_answers: Record<string, boolean> | string | null;
  undone_at: Date | string | null;
}

export const stageEventFromRow = (r: StageEventRow): StageEvent => ({
  id: r.id,
  leadId: r.lead_id,
  changeId: r.change_id,
  stageCode: r.stage_code as StageCode,
  occurredAt: date(r.occurred_at),
  sequence: Number(r.sequence),
  actorUserId: r.actor_user_id,
  origin: r.origin as StageEventOrigin,
  value:
    r.value_amount === null || r.currency === null ? null : { amount: Number(r.value_amount), currency: r.currency },
  lostReasonCode: r.lost_reason_code,
  qualificationAnswers: r.qualification_answers === null ? null : json(r.qualification_answers),
  undoneAt: r.undone_at === null ? null : date(r.undone_at),
});
