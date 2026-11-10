/**
 * Faz 7g satış takip okuma sözleşmesi (iş emri §4.5): temas özeti, uyarılar, Temas geçmişi, Özet rapor, referans
 * listeleri. Tarayıcı da tip olarak içe aktarır; `dto.ts` yeniden dışa açar (bu dosya yalnız `dto.codes.ts`'i alır). Alan adları domain ile aynıdır.
 */
import type { ActivityOutcomeDto, ActivityTypeDto, LeadSourceDto, StageCodeDto } from "./dto.codes";

export interface ChannelFactsDto {
  count: number;
  firstAt: string;
  lastAt: string;
  firstReplyAt: string | null;
  firstReplyEstimated: boolean;
}

export type ContactStateDto = "contacted" | "legacy" | "never";

export interface ContactSummaryDto {
  state: ContactStateDto;
  count: number;
  firstAt: string | null;
  firstAtEstimated: boolean;
  lastAt: string | null;
  lastAtEstimated: boolean;
  lastOutcome: ActivityOutcomeDto | null;
  lastType: ActivityTypeDto | null;
  replied: boolean;
  firstReplyAt: string | null;
  channels: Partial<Record<ActivityTypeDto, ChannelFactsDto>>;
  proposalContactAt: string | null;
}

export interface ProposalFactsDto {
  given: boolean;
  at: string | null;
  via: "stage" | "contact" | null;
}

export interface DataWarningDto {
  code: string;
  severity: "warn" | "info";
  checked: boolean;
  params?: Record<string, string>;
}

/** Liste ve panodaki lead'e eklenen izleme bilgisi. Uyarılar izleyene göre süzülmüştür. */
export interface LeadTrackingDto {
  contact: ContactSummaryDto;
  proposal: ProposalFactsDto;
  warnings: DataWarningDto[];
  hot: boolean;
  courtTotal: number | null;
  roofAreaM2: number | null;
}

export interface TrackingCountsDto {
  lead: number;
  mailSent: number;
  whatsappSent: number;
  neverReached: number;
  legacyNoContact: number;
  contacted: number;
  replied: number;
  proposalGiven: number;
  buyers: number;
  reachRate: number | null;
  replyRate: number | null;
  proposalRate: number | null;
}

export interface OwnerRowDto extends TrackingCountsDto {
  /** null = ortak havuz. */
  ownerId: string | null;
}

export type StatusKeyDto =
  "interested" | "not_interested" | "project_phase" | "collecting_prices" | "buyer_ready" | "none";

/** GET /reports/tracking */
export interface TrackingReportDto {
  scope: {
    from: string | null;
    to: string | null;
    source: LeadSourceDto | null;
    campaign: string | null;
    owner: string | null;
    scope: "excel" | null;
    repScoped: boolean;
    counts: { all: number; excel: number };
  };
  header: { firstLeadAt: string | null; lastLeadAt: string | null; reportDate: string };
  basics: {
    total: number;
    mailSent: number;
    whatsappSent: number;
    neverReached: number;
    legacyNoContact: number;
    replied: number;
    proposalGiven: number;
    buyers: number;
    share: Record<"mailSent" | "whatsappSent" | "neverReached" | "replied" | "proposalGiven" | "buyers", number>;
  };
  byOwner: OwnerRowDto[];
  byOwnerTotal: TrackingCountsDto;
  poolBreakdown: (TrackingCountsDto & { excelOwner: string | null })[];
  statusByOwner: { ownerId: string | null; counts: Record<StatusKeyDto, number>; total: number }[];
  statusTotal: { counts: Record<StatusKeyDto, number>; total: number };
  products: {
    code: "standard" | "panoramic" | "full_panoramic" | "roof";
    preferred: number;
    amongProposals: number;
    shareOfProposals: number | null;
    amongBuyers: number;
    totalQty: number | null;
    totalAreaM2: number | null;
  }[];
  closingPotential: number;
  byInstallTimeline: {
    timeline: "m0_3" | "m3_6" | "m6_12" | "researching" | null;
    lead: number;
    neverReached: number;
    legacyNoContact: number;
    replied: number;
    proposalGiven: number;
    neverRate: number | null;
  }[];
  campaigns: string[];
}

/** /reference'a Faz 7g'de eklenen listeler (arayüz kural yazmaz, kodu buradan okur). */
export interface TrackingReferenceDto {
  activityTypes: ActivityTypeDto[];
  contactChannels: ActivityTypeDto[];
  activityOutcomes: ActivityOutcomeDto[];
  outcomeDisplayOrder: ActivityOutcomeDto[];
  replyOutcomes: ActivityOutcomeDto[];
  contactRules: {
    repliedFlagOutcomes: ActivityOutcomeDto[];
    repliedDefaultTypes: ActivityTypeDto[];
    statusOutcomes: ActivityOutcomeDto[];
    statusSuggestsLost: string[];
    noNextTargets: StageCodeDto[];
    noteMax: number;
    minContactDate: string;
    futureToleranceMinutes: number;
  };
  timeZone: string;
  customerStatuses: { code: string; tone: string; icon: string }[];
  installSites: string[];
  installTimelines: { code: string; heat: string }[];
  customerProfiles: string[];
  courtCountBands: string[];
  products: { code: string; kind: "court" | "roof" }[];
  productQtyMax: number;
  warningCodes: { code: string; severity: "warn" | "info"; repVisible: boolean }[];
  importIssueCodes: string[];
  permissions: { repsEditProducts: boolean };
}

/** Lead detayında geri alınabilir temas kayıtları (pencere içindekiler). */
export interface ContactLogRefDto {
  id: string;
  activityId: string | null;
  createdAt: string;
  undoUntil: string;
  canUndo: boolean;
}
