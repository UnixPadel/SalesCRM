/**
 * Giden olay (outbox) satırı ve dağıtım sonuçları. Platformdan bağımsız; sağlayıcı yalnız metindir.
 * Durumlar (outbound_conversion_events.status): pending → sent | dead | skipped; geçici hata → failed (yeniden denenecek).
 */
import type { OutboundStageEvent } from "../../sales-pipeline/application";

export type OutboundStatus = "pending" | "sent" | "failed" | "dead" | "skipped";

/** Gönderim filtreleri (Genel plan): neden satırda kalır, admin görür. */
export type SkipReason =
  | "manual_source"
  | "test_lead"
  | "no_consent"
  | "mapping_missing"
  | "mapping_disabled"
  | "emergency_stop"
  | "undone"
  | "no_match_key"
  /** Platformun yükleme penceresi geçti (ör. tıklamadan 90 gün); adaptör `prepare` içinde belirler. */
  | "expired";

export interface OutboundRow {
  id: string;
  stageEventId: string;
  provider: string;
  status: OutboundStatus;
  /** Bu satır için şimdiye kadar yapılan deneme sayısı (claim ile artar). */
  attempts: number;
  nextAttemptAt: Date;
  skipReason: string | null;
  lastResponseCode: number | null;
  lastError: string | null;
  sentAt: Date | null;
  createdAt: Date;
}

/** Yönetim paneli satırı: iş kaydı + bitiş zamanı + platformun istek kimliği (varsa). */
export interface OutboundDetail extends OutboundRow {
  finishedAt: Date | null;
  requestId: string | null;
}

/** Liste öğesi: satır + sales-pipeline'dan lead ve aşama (olay silinmişse null). */
export interface OutboundListItem extends OutboundDetail {
  leadId: string | null;
  stageCode: string | null;
  occurredAt: Date | null;
}

export interface OutboxListFilter {
  statuses: readonly OutboundStatus[];
  provider?: string | undefined;
  limit: number;
}

/** Kuyruk özeti (Faz 7a sağlık paneli). */
export interface OutboxStats {
  counts: { provider: string; status: OutboundStatus; count: number }[];
  skipReasons: { provider: string; reason: string; count: number }[];
  /** Sırası gelmiş ya da bekleyen (pending/failed) en eski satırın sırası. */
  oldestDueAt: Date | null;
  lastSentAt: Date | null;
}

/** Dead-letter raporu satırı. */
export interface DeadRow {
  id: string;
  stageEventId: string;
  provider: string;
  attempts: number;
  lastResponseCode: number | null;
  lastError: string | null;
  finishedAt: Date | null;
}

/** Adaptörün gönderime hazırladığı olay; `payload` platforma özel, dağıtıcı içine bakmaz. */
export interface PreparedEvent {
  row: OutboundRow;
  context: OutboundStageEvent;
  eventName: string;
  payload: unknown;
}

export type PrepareResult = { kind: "ready"; event: PreparedEvent } | { kind: "skip"; reason: SkipReason };

/**
 * Toplu gönderim sonucu. `ok`: 2xx; `retry`: 429, 5xx, zaman aşımı, ağ; `dead`: 400 ve doğrulama hatası
 * (toplu istekte dağıtıcı olayları tek tek yeniden dener, yalnız hatalı olan dead olur).
 */
export type SendResult =
  | { kind: "ok"; code: number; requestId?: string | null }
  | { kind: "retry"; code: number | null; error: string }
  | { kind: "dead"; code: number | null; error: string };

export interface DispatchStats {
  claimed: number;
  sent: number;
  retried: number;
  dead: number;
  skipped: number;
}

/** Platformun eşzamansız işleme sonucu (sağlayıcıdan bağımsız biçim; Faz 7c). */
export type PlatformRequestState = "processing" | "success" | "partial" | "failure" | "unknown";
export interface PlatformRequestStatus {
  requestId: string;
  state: PlatformRequestState;
  /** Hedef (ör. reklam hesabı) başına satır; tek hedefte tek öğe. */
  destinations: { state: PlatformRequestState; recordCount: number; errorCount: number; warningCount: number }[];
}
