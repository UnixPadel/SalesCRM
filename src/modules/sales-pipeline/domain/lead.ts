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

export const EMPTY_CAMPAIGN: CampaignInfo = {
  campaignId: null,
  campaignName: null,
  adsetId: null,
  adsetName: null,
  adId: null,
  adName: null,
};
