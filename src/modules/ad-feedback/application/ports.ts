import type { ResolvedStageMapping } from "../../integration-settings/application";
import type { OutboundStageEvent } from "../../sales-pipeline/application";
import type { DeadRow, OutboundRow, PrepareResult, PreparedEvent, SendResult, SkipReason } from "./dto";

/** outbound_conversion_events: dağıtıcıya ait iş kaydı. */
export interface OutboxRepository {
  /**
   * Sırası gelen `pending`/`failed` satırları alır: `attempts` artar, `next_attempt_at` kilit süresi kadar ileri
   * atılır (süreç çökerse satır yeniden alınır). Birden fazla instance'ta SKIP LOCKED ile çakışmaz.
   */
  claimDue(now: Date, limit: number, lockMs: number): Promise<OutboundRow[]>;
  markSent(ids: readonly string[], responseCode: number, now: Date): Promise<void>;
  markRetry(id: string, nextAttemptAt: Date, responseCode: number | null, error: string): Promise<void>;
  markDead(id: string, responseCode: number | null, error: string, now: Date): Promise<void>;
  markSkipped(id: string, reason: SkipReason, now: Date): Promise<void>;
  /** `finished_at >= since` olan dead satırlar (günlük rapor). */
  listDead(since: Date): Promise<DeadRow[]>;
  /** Geriye doldurma: verilen aşama olayları için satırı olmayanlara `pending` açar; açılan sayı. Mevcut satıra dokunmaz. */
  enqueueMissing(stageEventIds: readonly string[], provider: string, notBefore: Date): Promise<number>;
}

/** sales-pipeline: geriye doldurma için aşama olayları (kaynaklara göre, `since` sonrası). */
export interface BackfillEventSource {
  stageEventsSince(
    since: Date,
    sources: readonly ("meta_form" | "google_form" | "web_form")[],
  ): Promise<{ stageEventId: string; leadId: string; occurredAt: Date }[]>;
}

/** sales-pipeline'ın application sorgusu (modüller arası tek kapı). */
export interface StageContextSource {
  outboundContext(stageEventIds: readonly string[]): Promise<OutboundStageEvent[]>;
}

/** integration-settings: aşama eşlemesi ve acil durdurma. */
export interface OutboundPolicySource {
  stageMappingsFor(provider: string): Promise<ResolvedStageMapping>;
  outboundEnabled(provider: string): Promise<boolean>;
}

/** Platform adaptörü: bağlam → payload (saf) ve toplu gönderim (ağ). */
export interface PlatformSender {
  readonly provider: string;
  /** Platforma özgü ön koşul yoksa (ör. eşleştirme anahtarı) `skip` döner. */
  prepare(context: OutboundStageEvent, eventName: string, row: OutboundRow): PrepareResult;
  send(events: readonly PreparedEvent[]): Promise<SendResult>;
}

export interface ReportMessage {
  to: string;
  subject: string;
  text: string;
}

/** Dead-letter raporu için e-posta portu (sales-pipeline'ın EmailSender'ı ile aynı biçim). */
export interface ReportMailer {
  send(message: ReportMessage): Promise<void>;
}
