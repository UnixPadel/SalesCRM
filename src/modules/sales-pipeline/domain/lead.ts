import { RuleError, err, ok, type Result } from "../../shared/kernel";
import type { StageCode } from "./stage";

export const LEAD_SOURCES = ["meta_form", "google_form", "web_form", "manual", "import"] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];
export const isLeadSource = (v: unknown): v is LeadSource =>
  typeof v === "string" && (LEAD_SOURCES as readonly string[]).includes(v);

/** Platformun verdiği lead kimliği; metin tutulur (bazı platformlarda 15–17 hane, JS number bozar). */
export class PlatformLeadId {
  private constructor(readonly value: string) {}
  static parse(raw: unknown): Result<PlatformLeadId, RuleError> {
    const v = String(raw ?? "").trim();
    if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(v)) {
      return err(new RuleError("platform_lead_id.invalid", "Platform lead kimliği geçersiz.", { value: raw }));
    }
    return ok(new PlatformLeadId(v));
  }
  toString(): string {
    return this.value;
  }
}

export interface Person {
  id: string;
  fullName: string;
  emailNormalized: string | null;
  phoneE164: string | null;
  country: string | null;
  company: string;
  createdAt: Date;
}

export interface CampaignInfo {
  campaignId: string | null;
  campaignName: string | null;
  adsetId: string | null;
  adsetName: string | null;
  adId: string | null;
  adName: string | null;
}

export interface Lead {
  id: string;
  source: LeadSource;
  platformLeadId: string | null;
  formId: string | null;
  personId: string;
  fullName: string;
  email: string | null;
  phoneE164: string | null;
  country: string | null;
  city: string;
  company: string;
  productInterest: string;
  campaign: CampaignInfo;
  /** null = ortak havuz */
  assignedUserId: string | null;
  currentStage: StageCode;
  isTest: boolean;
  notes: string;
  extraAnswers: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export type StageEventOrigin = "manual" | "auto_fill" | "system";

export interface StageEvent {
  id: string;
  leadId: string;
  /** Aynı "sonraki aşama" tıkının ürettiği satırları gruplar; geri al bu grubu hedefler. */
  changeId: string;
  stageCode: StageCode;
  occurredAt: Date;
  sequence: number;
  actorUserId: string | null;
  origin: StageEventOrigin;
  value: { amount: number; currency: string } | null;
  lostReasonCode: string | null;
  qualificationAnswers: Record<string, boolean> | null;
  undoneAt: Date | null;
}

/** Tıklama kimlikleri ve UTM (lead_attribution, 1:1). Alan adları sektör standardı parametre adlarıdır. */
export interface LeadAttribution {
  gclid: string | null;
  gbraid: string | null;
  wbraid: string | null;
  fbclid: string | null;
  fbc: string | null;
  fbp: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmTerm: string | null;
  utmContent: string | null;
  landingUrl: string | null;
  clickAt: Date | null;
}

export const EMPTY_ATTRIBUTION: LeadAttribution = {
  gclid: null,
  gbraid: null,
  wbraid: null,
  fbclid: null,
  fbc: null,
  fbp: null,
  utmSource: null,
  utmMedium: null,
  utmCampaign: null,
  utmTerm: null,
  utmContent: null,
  landingUrl: null,
  clickAt: null,
};

export const hasAttribution = (a: Partial<LeadAttribution>): boolean =>
  Object.values(a).some((v) => v !== null && v !== undefined && v !== "");

/**
 * KVKK / iletişim onayı (lead_consents). `type` kısıtlı bir koddur (ör. "kvkk", "marketing");
 * `textVersion` onay anındaki aydınlatma metninin sürümüdür; metnin kendisi saklanmaz.
 */
export interface LeadConsent {
  id: string;
  leadId: string;
  type: string;
  granted: boolean;
  textVersion: string;
  grantedAt: Date;
}

export interface ConsentInput {
  type: string;
  granted: boolean;
  textVersion?: string | null;
  /** Onayın formda verildiği an; yoksa lead'in oluşturulma anı. */
  grantedAt?: Date | null;
}

const CONSENT_TYPE_RE = /^[a-z][a-z0-9_]{0,63}$/;

/** Onay girdilerini doğrular; tipi geçersiz olan ilk kayıt için RuleError döner. */
export function parseConsents(inputs: readonly ConsentInput[]): Result<ConsentInput[], RuleError> {
  const out: ConsentInput[] = [];
  for (const c of inputs) {
    const type = String(c.type ?? "").trim();
    if (!CONSENT_TYPE_RE.test(type)) {
      return err(new RuleError("consent.type_invalid", "Onay türü geçersiz.", { type: c.type }));
    }
    if (typeof c.granted !== "boolean") {
      return err(new RuleError("consent.granted_invalid", "Onay değeri true/false olmalı.", { type }));
    }
    out.push({
      type,
      granted: c.granted,
      textVersion: String(c.textVersion ?? "")
        .trim()
        .slice(0, 64),
      grantedAt: c.grantedAt ?? null,
    });
  }
  return ok(out);
}

export const EMPTY_CAMPAIGN: CampaignInfo = {
  campaignId: null,
  campaignName: null,
  adsetId: null,
  adsetName: null,
  adId: null,
  adName: null,
};
