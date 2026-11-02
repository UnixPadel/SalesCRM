/**
 * API sözleşmesi: arayüz yalnız bu tipleri bilir. Tarihler ISO metin; para { amount, currency }.
 * Bu dosya tarayıcı tarafından da import edilir (tip olarak); Node'a bağımlılığı yoktur.
 */
export type StageCodeDto = "NEW" | "CONTACTED" | "QUALIFIED" | "PROPOSAL" | "WON" | "LOST";
export type LeadSourceDto = "meta_form" | "google_form" | "web_form" | "manual" | "import";
export type StageEventOriginDto = "manual" | "auto_fill" | "system";

export interface LeadDto {
  id: string;
  source: LeadSourceDto;
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
  campaign: {
    campaignId: string | null;
    campaignName: string | null;
    adsetId: string | null;
    adsetName: string | null;
    adId: string | null;
    adName: string | null;
  };
  assignedUserId: string | null;
  currentStage: StageCodeDto;
  isTest: boolean;
  notes: string;
  extraAnswers: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface StageEventDto {
  id: string;
  leadId: string;
  changeId: string;
  stageCode: StageCodeDto;
  occurredAt: string;
  sequence: number;
  actorUserId: string | null;
  origin: StageEventOriginDto;
  value: { amount: number; currency: string } | null;
  lostReasonCode: string | null;
  qualificationAnswers: Record<string, boolean> | null;
  undoneAt: string | null;
}

export type ActivityTypeDto = "call" | "email" | "meeting" | "proposal_sent" | "site_visit";

export interface ActivityDto {
  id: string;
  leadId: string;
  type: ActivityTypeDto;
  subject: string;
  dueAt: string;
  /** null = açık. */
  doneAt: string | null;
  notes: string;
  autoCreated: boolean;
  createdByUserId: string | null;
  createdAt: string;
}

/** Liste ve detaydaki lead: aktivite özetiyle. Komut yanıtları yalın LeadDto döner. */
export interface LeadListDto extends LeadDto {
  openActivities: number;
  nextActivity: { id: string; type: ActivityTypeDto; subject: string; dueAt: string } | null;
  /** Açık aşamada, açık aktivitesi yok (kural 1). */
  rotting: boolean;
}

export interface LeadDetailDto {
  lead: LeadListDto;
  events: StageEventDto[];
  activities: ActivityDto[];
  allowedTransitions: StageCodeDto[];
  undo: { available: boolean; reason?: string; untilIso?: string };
}

export interface AddActivityBody {
  type: ActivityTypeDto;
  subject?: string;
  /** ISO tarih-saat. */
  dueAt: string;
  notes?: string;
}

export interface SetActivityDoneBody {
  done: boolean;
}

export interface TodayItemDto {
  activity: ActivityDto;
  lead: {
    id: string;
    fullName: string;
    company: string;
    country: string | null;
    currentStage: StageCodeDto;
    assignedUserId: string | null;
  };
}

/** "Bugün" sayfası: üç küme, her biri vade sırasıyla. */
export interface TodayDto {
  overdue: TodayItemDto[];
  today: TodayItemDto[];
  upcoming: TodayItemDto[];
}

export interface ReferenceDto {
  stages: {
    code: StageCodeDto;
    nameTr: string;
    nameEn: string;
    isTerminal: boolean;
    requiresValue: boolean;
    requiresReason: boolean;
  }[];
  lostReasons: { code: string; nameTr: string; nameEn: string }[];
  qualificationQuestions: string[];
  currencies: string[];
  undoWindowMinutes: number;
}

export interface CreateLeadBody {
  fullName: string;
  email?: string;
  phone?: string;
  country?: string;
  city?: string;
  company?: string;
  productInterest?: string;
  notes?: string;
  /** Yalnız admin: belirli bir satışçıya ata ya da null ile havuza bırak. */
  assignedUserId?: string | null;
  isTest?: boolean;
}

export interface ChangeStageBody {
  target: StageCodeDto;
  value?: { amount: number; currency: string } | null;
  lostReasonCode?: string | null;
  qualificationAnswers?: Record<string, boolean> | null;
}

export interface AssignBody {
  toUserId: string | null;
}

/** Hata gövdesi: `code` arayüz çevirisi için, `message` Türkçe varsayılan, `details` alan bazlı bilgi. */
export interface ApiErrorDto {
  error: string;
  code: string;
  details?: Record<string, unknown>;
}

export interface NotificationDto {
  id: string;
  type: "lead_assigned";
  leadId: string | null;
  title: string;
  /** { leadName, company, country, source, isTest } */
  body: Record<string, unknown>;
  createdAt: string;
  readAt: string | null;
}

export interface NotificationsDto {
  items: NotificationDto[];
  unreadCount: number;
}
