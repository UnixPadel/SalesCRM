import type {
  Activity,
  ActivityOutcome,
  ActivityType,
  ContactLog,
  CourtCountBand,
  CustomerProfile,
  CustomerStatus,
  InstallSite,
  InstallTimeline,
  Lead,
  Organization,
  OrganizationType,
  LeadAttribution,
  LeadConsent,
  LeadSource,
  Person,
  StageCode,
  StageEvent,
  StageEventOrigin,
} from "../domain";

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
  court_count: number | null;
  court_model: string;
  /** SELECT'te ::text ile okunur (YYYY-MM-DD); sürücünün yerel saate çevirmesi günü kaydırabilirdi. */
  expected_close_date: string | null;
  organization_id: string | null;
  /** Faz 7g (migration 0012). numeric sütunlar iki sürücüde de metin gelir; smallint sayı. */
  customer_status: string | null;
  qty_standard: number | string | null;
  qty_panoramic: number | string | null;
  qty_full_panoramic: number | string | null;
  roof_wanted: boolean;
  roof_width_m: number | string | null;
  roof_length_m: number | string | null;
  install_site: string | null;
  install_timeline: string | null;
  customer_profile: string | null;
  court_count_band: string | null;
  ad_surface: string | null;
  checked_warnings: string[] | string | null;
  contact_history_unknown: boolean;
  created_at: Date | string;
  updated_at: Date | string;
}

const date = (v: Date | string): Date => (v instanceof Date ? v : new Date(v));
const json = <T>(v: T | string): T => (typeof v === "string" ? (JSON.parse(v) as T) : v);
const num = (v: number | string | null): number | null => (v === null ? null : Number(v));

/** text[]: sürücü dizi döndürür; dönmezse Postgres dizi metni ("{a,b}") ayrıştırılır (kodlar tırnaksız). */
function textArray(v: string[] | string | null): string[] {
  if (v === null) return [];
  if (Array.isArray(v)) return v.map(String);
  const inner = v.replace(/^\{|\}$/g, "");
  return inner ? inner.split(",").map((s) => s.replace(/^"|"$/g, "")) : [];
}

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
    courtCount: r.court_count === null ? null : Number(r.court_count),
    courtModel: r.court_model,
    expectedCloseDate: r.expected_close_date,
    organizationId: r.organization_id,
    customerStatus: r.customer_status as CustomerStatus | null,
    products: {
      standard: num(r.qty_standard),
      panoramic: num(r.qty_panoramic),
      fullPanoramic: num(r.qty_full_panoramic),
      roof: { wanted: r.roof_wanted, widthM: num(r.roof_width_m), lengthM: num(r.roof_length_m) },
    },
    installSite: r.install_site as InstallSite | null,
    installTimeline: r.install_timeline as InstallTimeline | null,
    customerProfile: r.customer_profile as CustomerProfile | null,
    courtCountBand: r.court_count_band as CourtCountBand | null,
    adSurface: r.ad_surface,
    checkedWarnings: textArray(r.checked_warnings),
    contactHistoryUnknown: r.contact_history_unknown,
    createdAt: date(r.created_at),
    updatedAt: date(r.updated_at),
  };
}

export interface AttributionRow extends Record<string, unknown> {
  gclid: string | null;
  gbraid: string | null;
  wbraid: string | null;
  fbclid: string | null;
  fbc: string | null;
  fbp: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_term: string | null;
  utm_content: string | null;
  landing_url: string | null;
  click_at: Date | string | null;
}

export const attributionFromRow = (r: AttributionRow): LeadAttribution => ({
  gclid: r.gclid,
  gbraid: r.gbraid,
  wbraid: r.wbraid,
  fbclid: r.fbclid,
  fbc: r.fbc,
  fbp: r.fbp,
  utmSource: r.utm_source,
  utmMedium: r.utm_medium,
  utmCampaign: r.utm_campaign,
  utmTerm: r.utm_term,
  utmContent: r.utm_content,
  landingUrl: r.landing_url,
  clickAt: r.click_at === null ? null : date(r.click_at),
});

export interface ConsentRow extends Record<string, unknown> {
  id: string;
  lead_id: string;
  consent_type: string;
  granted: boolean;
  text_version: string;
  granted_at: Date | string;
}

export const consentFromRow = (r: ConsentRow): LeadConsent => ({
  id: r.id,
  leadId: r.lead_id,
  type: r.consent_type,
  granted: r.granted,
  textVersion: r.text_version,
  grantedAt: date(r.granted_at),
});

export interface PersonRow extends Record<string, unknown> {
  id: string;
  full_name: string;
  email_normalized: string | null;
  phone_e164: string | null;
  country: string | null;
  company: string;
  organization_id: string | null;
  merged_into_id: string | null;
  created_at: Date | string;
}

export const personFromRow = (r: PersonRow): Person => ({
  id: r.id,
  fullName: r.full_name,
  emailNormalized: r.email_normalized,
  phoneE164: r.phone_e164,
  country: r.country,
  company: r.company,
  organizationId: r.organization_id,
  mergedIntoId: r.merged_into_id,
  createdAt: date(r.created_at),
});

export interface OrganizationRow extends Record<string, unknown> {
  id: string;
  name: string;
  type: string;
  country: string | null;
  website: string;
  notes: string;
  legacy_id: string | null;
  archived_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export const organizationFromRow = (r: OrganizationRow): Organization => ({
  id: r.id,
  name: r.name,
  type: r.type as OrganizationType,
  country: r.country,
  website: r.website,
  notes: r.notes,
  legacyId: r.legacy_id,
  archivedAt: r.archived_at === null ? null : date(r.archived_at),
  createdAt: date(r.created_at),
  updatedAt: date(r.updated_at),
});

export interface ActivityRow extends Record<string, unknown> {
  id: string;
  lead_id: string;
  type: string;
  subject: string;
  due_at: Date | string;
  done_at: Date | string | null;
  notes: string;
  auto_created: boolean;
  created_by_change_id: string | null;
  created_by_user_id: string | null;
  legacy_id: string | null;
  outcome: string | null;
  customer_replied: boolean;
  result_note: string;
  done_by_user_id: string | null;
  date_estimated: boolean;
  log_id: string | null;
  next_of_log_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export const activityFromRow = (r: ActivityRow): Activity => ({
  id: r.id,
  leadId: r.lead_id,
  type: r.type as ActivityType,
  subject: r.subject,
  dueAt: date(r.due_at),
  doneAt: r.done_at === null ? null : date(r.done_at),
  notes: r.notes,
  autoCreated: r.auto_created,
  createdByChangeId: r.created_by_change_id,
  createdByUserId: r.created_by_user_id,
  legacyId: r.legacy_id,
  outcome: r.outcome as ActivityOutcome | null,
  customerReplied: r.customer_replied,
  resultNote: r.result_note,
  doneByUserId: r.done_by_user_id,
  dateEstimated: r.date_estimated,
  logId: r.log_id,
  nextOfLogId: r.next_of_log_id,
  createdAt: date(r.created_at),
  updatedAt: date(r.updated_at),
});

export interface ContactLogRow extends Record<string, unknown> {
  id: string;
  lead_id: string;
  actor_user_id: string;
  created_at: Date | string;
  completed_activity_id: string | null;
  prev_type: string | null;
  prev_subject: string | null;
  status_changed: boolean;
  status_before: string | null;
  status_after: string | null;
  stage_change_id: string | null;
  assigned_on_log: boolean;
}

export const contactLogFromRow = (r: ContactLogRow): ContactLog => ({
  id: r.id,
  leadId: r.lead_id,
  actorUserId: r.actor_user_id,
  createdAt: date(r.created_at),
  completedActivityId: r.completed_activity_id,
  prevType: r.prev_type as ActivityType | null,
  prevSubject: r.prev_subject,
  statusChanged: r.status_changed,
  statusBefore: r.status_before as CustomerStatus | null,
  statusAfter: r.status_after as CustomerStatus | null,
  stageChangeId: r.stage_change_id,
  assignedOnLog: r.assigned_on_log,
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
