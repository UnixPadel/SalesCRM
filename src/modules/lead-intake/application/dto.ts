/**
 * InboundLeadDto: her kaynak adaptörünün ürettiği ortak biçim. Faz 1'in CreateLead arayüzüne
 * birebir çevrilir (createLeadFromAd). Platforma özel hiçbir şey taşımaz; platform kimliği metindir.
 */
export type InboundSource = "meta_form" | "google_form";

export interface InboundCampaign {
  campaignId?: string | null;
  campaignName?: string | null;
  adsetId?: string | null;
  adsetName?: string | null;
  adId?: string | null;
  adName?: string | null;
}

export interface InboundAttribution {
  gclid?: string | null;
  gbraid?: string | null;
  wbraid?: string | null;
  fbclid?: string | null;
  clickAt?: Date | null;
}

export interface InboundLeadDto {
  source: InboundSource;
  /** Adaptör anahtarı ("meta", "google"); inbox satırı ve ayar/eşleme tabloları bu anahtarı kullanır. */
  provider: string;
  platformLeadId: string;
  formId: string | null;
  fullName: string;
  email: string | null;
  phone: string | null;
  /** ISO-3166 alpha-2 ya da null (adaptör çözemedi; ham değer extraAnswers'ta kalır). */
  country: string | null;
  city: string;
  company: string;
  productInterest: string;
  notes: string;
  campaign: InboundCampaign;
  attribution: InboundAttribution;
  isTest: boolean;
  /** Eşlenmeyen / "ek yanıt" alanları. */
  extraAnswers: Record<string, unknown>;
  /** Platformdaki gönderim zamanı; bilinmiyorsa null. */
  submittedAt: Date | null;
}

export type InboxKind = "webhook" | "backfill";
export type InboxStatus = "pending" | "processing" | "done" | "failed";

export interface NewInboxEvent {
  id: string;
  provider: string;
  kind: InboxKind;
  /** provider + platform lead kimliği; aynı bildirim iki kez gelirse tek satır. */
  dedupeKey: string;
  payload: unknown;
  receivedAt: Date;
  nextAttemptAt: Date;
}

export interface InboxEvent {
  id: string;
  provider: string;
  kind: InboxKind;
  dedupeKey: string;
  /** Şifre çözülmüş payload; temizlik işi sildiyse null. */
  payload: unknown;
  receivedAt: Date;
  status: InboxStatus;
  /** Bu kayıt için şimdiye kadar yapılan deneme sayısı (claim ile artar). */
  attempts: number;
  nextAttemptAt: Date;
  lastErrorCode: string | null;
  lastError: string | null;
  leadId: string | null;
  processedAt: Date | null;
}

export const dedupeKeyFor = (provider: string, platformLeadId: string): string => `${provider}:${platformLeadId}`;
