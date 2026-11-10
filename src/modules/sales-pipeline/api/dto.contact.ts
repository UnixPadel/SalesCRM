/**
 * Faz 7g temas kaydı sözleşmesi (iş emri §4.5). Tarayıcı da tip olarak içe aktarır; Node bağımlılığı yoktur.
 * Tek yönlü: `dto.ts`'i alır, `dto.ts` bunu almaz.
 */
import type { ActivityDto, ActivityOutcomeDto, ActivityTypeDto, LeadDto, StageCodeDto } from "./dto";

/** POST /leads/:id/contacts */
export interface LogContactBody {
  /** Tamamlanacak plan (bu lead'in açık işi). */
  activityId?: string | null;
  type: ActivityTypeDto;
  outcome: ActivityOutcomeDto;
  customerReplied?: boolean;
  /** ISO; verilmezse şimdi. */
  occurredAt?: string;
  note?: string;
  next?: { type: ActivityTypeDto; dueAt: string; subject?: string; notes?: string } | null;
  /** Çubuktaki tek dokunuşla kayıt: plan ve takip sunucu varsayılanı; durum ve aşama yok sayılır. */
  quick?: boolean;
  /** undefined = dokunma; null = "Durum girilmedi". */
  customerStatus?: string | null;
  stage?: {
    target: StageCodeDto;
    value?: { amount: number; currency: string } | null;
    lostReasonCode?: string | null;
  } | null;
}

export interface LogContactResultDto {
  logId: string;
  activity: ActivityDto;
  next: ActivityDto | null;
  stage: { changeId: string } | null;
  assignedTo: string | null;
  undoUntil: string;
  lead: LeadDto;
}

export type StageLineModeDto = "fixed" | "checked" | "unchecked" | "checked_if_replied";

export interface ContactDefaultsDto {
  next: { type: ActivityTypeDto; dueAt: string; subject: string } | null;
  stage: { target: StageCodeDto; mode: StageLineModeDto } | null;
}

/** GET /leads/:id/contact-form */
export interface ContactFormDto {
  lead: {
    id: string;
    fullName: string;
    currentStage: StageCodeDto;
    assignedUserId: string | null;
    customerStatus: string | null;
    createdAt: string;
  };
  /** Vade sırasıyla. */
  openActivities: { id: string; type: ActivityTypeDto; subject: string; dueAt: string }[];
  completableId: string | null;
  /** 5 kanal + açık "Teklif gönderimi"/"Saha ziyareti" planı varsa onun türü. */
  channels: ActivityTypeDto[];
  defaultType: ActivityTypeDto;
  defaults: Partial<Record<ActivityTypeDto, Record<ActivityOutcomeDto, ContactDefaultsDto>>>;
  canSetStatus: boolean;
  /** Havuz lead'i kaydedince satışçıya atanır (diyalog bunu söyler). */
  assignsOnSave: boolean;
  now: string;
  timeZone: string;
}

export interface UndoLogContactResultDto {
  undone: true;
  stageUndone: boolean;
}

/** PUT /leads/:id/customer-status */
export interface CustomerStatusBody {
  status: string | null;
}

/** GET /activities/history */
export interface ContactHistoryItemDto {
  activity: ActivityDto;
  lead: {
    id: string;
    fullName: string;
    company: string;
    currentStage: StageCodeDto;
    assignedUserId: string | null;
  };
  next: { id: string; type: ActivityTypeDto; dueAt: string } | null;
}

export interface ContactHistoryDto {
  items: ContactHistoryItemDto[];
  /** Sonraki sayfa imleci ("<iso>|<id>"); son sayfada null. */
  nextBefore: string | null;
}
