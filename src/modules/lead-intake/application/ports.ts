import type { ResolvedMapping } from "../../integration-settings/application";
import type { CreateLeadInput, CreateLeadResult } from "../../sales-pipeline/application";
import type { Result, RuleError } from "../../shared/kernel";
import type { InboundLeadDto, InboxEvent, NewInboxEvent } from "./dto";

export interface InboxRepository {
  /** Aynı dedupeKey varsa yazmaz ve "duplicate" döner (UNIQUE). */
  enqueue(event: NewInboxEvent): Promise<"inserted" | "duplicate">;
  /**
   * Sırası gelen satırları alır: `processing` yapar, `attempts` artırır, `next_attempt_at`'ı kilit süresi kadar
   * ileri atar (süreç çökerse satır yeniden alınır). Birden fazla instance'ta SKIP LOCKED ile çakışmaz.
   */
  claimDue(now: Date, limit: number, lockMs: number): Promise<InboxEvent[]>;
  markDone(id: string, leadId: string, now: Date): Promise<void>;
  markRetry(id: string, nextAttemptAt: Date, error: { code: string; message: string }): Promise<void>;
  markFailed(id: string, error: { code: string; message: string }, now: Date): Promise<void>;
  /** Payload'ı siler, satırı bırakır; silinen satır sayısı. */
  purgePayloads(olderThan: Date, now: Date): Promise<number>;
  findByDedupeKey(dedupeKey: string): Promise<InboxEvent | undefined>;
}

export interface AdapterContext {
  mappingsFor(formId: string | null): Promise<ResolvedMapping>;
  /** Ülkesiz telefon numaraları için (ISO-3166 alpha-2). */
  defaultCountry: string;
}

/** Kaynak adaptörü: inbox payload'ı → InboundLeadDto. Platform çağrısı gerekirse burada yapılır. */
export interface SourceAdapter {
  readonly provider: string;
  /** Fırlatır: TransientError (yeniden denenir) | PermanentError (failed). */
  toInboundLead(payload: unknown, ctx: AdapterContext): Promise<InboundLeadDto>;
}

/** Yedek senkron kaynağı: webhook kaçırmışsa platformdan son N saatin lead'lerini getirir. */
export interface BackfillSource {
  readonly provider: string;
  fetchSince(since: Date): Promise<{ dedupeKey: string; payload: unknown }[]>;
}

/** Faz 1'in CreateLead komutu; sales-pipeline/application'dan gelir (modüller arası tek kapı). */
export interface LeadCreator {
  execute(input: CreateLeadInput): Promise<Result<CreateLeadResult, RuleError>>;
}

export interface MappingSource {
  mappingsFor(provider: string, formId: string | null): Promise<ResolvedMapping>;
}
