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
  /** Fırsat alanları (Faz 6b). */
  courtCount: number | null;
  courtModel: string;
  /** YYYY-MM-DD ya da null. */
  expectedCloseDate: string | null;
  /** Kuruluş bağı (Faz 6d). */
  organizationId: string | null;
  createdAt: string;
  updatedAt: string;
}

export type OrganizationTypeDto = "club" | "investor" | "distributor" | "contractor" | "other";

export interface OrganizationDto {
  id: string;
  name: string;
  type: OrganizationTypeDto;
  country: string | null;
  website: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

/** POST /organizations (name zorunlu) ve PATCH /organizations/:id (yalnız gönderilenler). */
export interface OrganizationBody {
  name?: string;
  type?: OrganizationTypeDto;
  country?: string | null;
  website?: string | null;
  notes?: string | null;
}

export interface PersonDto {
  id: string;
  fullName: string;
  emailNormalized: string | null;
  phoneE164: string | null;
  country: string | null;
  company: string;
  organizationId: string | null;
  createdAt: string;
}

/** GET /organizations?q= — kuruluş + kişi sayısı + görünür lead özetleri. */
export interface OrganizationSummaryDto {
  organization: OrganizationDto;
  personCount: number;
  leadCount: number;
  openCount: number;
  wonCount: number;
  openTotalEur: number;
}

/** GET /persons?q=&organizationId= — kişi + kuruluş adı + görünür lead'leri. */
export interface PersonSummaryDto {
  person: PersonDto;
  organization: { id: string; name: string } | null;
  leads: LeadListDto[];
}

/** PATCH /leads/:id/contact — ad, e-posta, telefon; "" ya da null alanı boşaltır (ikisinden biri kalmalı). */
export interface UpdateContactBody {
  fullName?: string;
  email?: string | null;
  phone?: string | null;
}

/** GET /search?q= — üst menü araması. */
export interface SearchDto {
  leads: LeadDto[];
  persons: PersonDto[];
  organizations: OrganizationDto[];
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
  /** Bulunduğu aşamaya giriş anı (ISO); kolon "ort. gün" ve karttaki gün sayacı bundan. */
  stageEnteredAt: string;
  /** Son geçerli tutar (Teklif ya da Kazanıldı); yoksa null. */
  value: { amount: number; currency: string } | null;
}

/** Kolon istatistiği (kural 4), filtrelenmiş kümeden. */
export interface ColumnStatsDto {
  stage: StageCodeDto;
  count: number;
  totalEur: number;
  avgDays: number;
  /** Kuru bilinmediği için toplama katılamayan tutar sayısı. */
  unconverted: number;
}

/** GET /board?owner=me|pool|<id>&country=TR&rotting=1&includeTest=1 */
export interface BoardDto {
  leads: LeadListDto[];
  columns: ColumnStatsDto[];
}

/** PATCH /leads/:id — yalnız gönderilen anahtarlar değişir; "" ya da null temizler. */
export interface UpdateLeadBody {
  courtCount?: number | string | null;
  courtModel?: string | null;
  expectedCloseDate?: string | null;
  company?: string | null;
  city?: string | null;
  productInterest?: string | null;
  notes?: string | null;
  /** Kuruluş bağı; null bağı kaldırır. */
  organizationId?: string | null;
}

export interface LeadDetailDto {
  lead: LeadListDto;
  organization: OrganizationDto | null;
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

/** GET /reports?months=12 — raporlar (Faz 6c); aylar YYYY-MM, eskiden yeniye; tutarlar EUR. */
export interface ReportDto {
  months: string[];
  kpis: {
    openCount: number;
    openTotalEur: number;
    wonThisMonth: { count: number; totalEur: number };
    closedWon: number;
    closedLost: number;
    /** 0–1; kapanan yoksa null. */
    winRate: number | null;
  };
  wonByMonth: { month: string; count: number; totalEur: number }[];
  conversionByStage: { stage: StageCodeDto; reached: number; closed: number; won: number; rate: number | null }[];
  /** country: ISO-2 ya da "" (bilinmiyor). */
  openByCountry: { country: string; count: number; totalEur: number }[];
  /** code: lost_reasons.code ya da "unspecified". */
  lostReasons: { code: string; count: number }[];
  leadsBySource: { source: LeadSourceDto; count: number; won: number }[];
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
  /** Para birimi → EUR çarpanı (pano toplamları). */
  eurRates: Record<string, number>;
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
  courtCount?: number | string | null;
  courtModel?: string;
  expectedCloseDate?: string | null;
  organizationId?: string | null;
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
