import type { ResolvedMapping } from "../../integration-settings/application";
import type { CreateLeadInput, CreateLeadResult } from "../../sales-pipeline/application";
import type { Result, RuleError } from "../../shared/kernel";
import type { InboundLeadDto, InboxEvent, InboxFailedItem, InboxStats, NewInboxEvent } from "./dto";

export interface InboxRepository {
  /** Aynı dedupeKey varsa yazmaz ve "duplicate" döner (UNIQUE). */
  enqueue(event: NewInboxEvent): Promise<"inserted" | "duplicate">;
  /**
   * Sırası gelen satırları alır: `processing` yapar, `attempts` artırır, `next_attempt_at`'ı kilit süresi kadar
   * ileri atar (süreç çökerse satır yeniden alınır). Birden fazla instance'ta SKIP LOCKED ile çakışmaz.
   */
  claimDue(now: Date, limit: number, lockMs: number): Promise<InboxEvent[]>;
  markDone(id: string, leadId: string, now: Date): Promise<void>;
  /** Lead açılmadan kapatır (bot gönderimi vb.): `done`, lead yok, `last_error_code` = sebep kodu. */
  markIgnored(id: string, code: string, now: Date): Promise<void>;
  markRetry(id: string, nextAttemptAt: Date, error: { code: string; message: string }): Promise<void>;
  markFailed(id: string, error: { code: string; message: string }, now: Date): Promise<void>;
  /** Payload'ı siler, satırı bırakır; silinen satır sayısı. */
  purgePayloads(olderThan: Date, now: Date): Promise<number>;
  findByDedupeKey(dedupeKey: string): Promise<InboxEvent | undefined>;
  /** Faz 7a: sayılar; `daySince` sonrası alınanlar, `purgeBefore` öncesi payload'ı duranlar. */
  stats(daySince: Date, purgeBefore: Date): Promise<InboxStats>;
  /** En yeniden eskiye başarısız satırlar (payload okunmaz). */
  listFailed(limit: number): Promise<InboxFailedItem[]>;
  /** Verilenlerden yeniden işlenebilir olanların kimlikleri (`failed` ve payload'ı duruyor). */
  requeueable(ids: readonly string[]): Promise<string[]>;
  /** `failed` + payload'lı satır → `pending`, deneme 0, sıra şimdi. Tek ifade; değişen satır sayısı. */
  requeue(ids: readonly string[], now: Date): Promise<number>;
}

export interface AdapterContext {
  mappingsFor(formId: string | null): Promise<ResolvedMapping>;
  /** Ülkesiz telefon numaraları için (ISO-3166 alpha-2). */
  defaultCountry: string;
  /** Bildirimin inbox'a düştüğü an; payload gönderim zamanı taşımıyorsa `submittedAt` için en yakın değer. */
  receivedAt: Date;
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

/* ---- Web sitesi çekme modu (docs/runbooks/web-form.md "Çekme modu") ---- */

/** Sitenin `/pending` yanıtındaki bir öğe; doğrulanmamış ham veri. */
export interface PulledItem {
  submissionId: unknown;
  payload: unknown;
}

export type PullAckStatus = "inserted" | "duplicate";

/**
 * Talepleri kendi tarafında saklayan kaynak (site). Onaylanana kadar aynı öğeyi en eskiden yeniye yeniden verir.
 * Hata: `PullSourceError` fırlatır.
 */
export interface PullSource {
  pending(limit: number): Promise<{ items: PulledItem[]; more: boolean }>;
  ack(items: readonly { submissionId: string; status: PullAckStatus }[]): Promise<{ acked: number; unknown: string[] }>;
}

/**
 * Çekme kaynağının hatası. `transient`: ağ, zaman aşımı, 429, 5xx → sonraki turda yeniden denenir.
 * `config`: 401 (imza/anahtar), 400 (sözleşme), 503 not_configured, bozuk yanıt → yine denenir ama yönetici bakmalı.
 */
export class PullSourceError extends Error {
  constructor(
    readonly code: string,
    readonly kind: "transient" | "config",
    readonly httpStatus: number | null = null,
  ) {
    super(code);
    this.name = "PullSourceError";
  }
}

export type WebPullErrorKind = "transient" | "config" | "inbox";

/** Çekme turunun durumu; sağlık paneli için kalıcı yazılır (secret ve kişisel veri yok). */
export interface WebPullStatus {
  /** Son turun başladığı an (ISO). */
  lastRunAt: string | null;
  /** Son başarılı çekmenin bittiği an (ISO). */
  lastPullAt: string | null;
  /** Son tur hatasız bitti mi. */
  lastRunOk: boolean | null;
  lastErrorCode: string | null;
  lastErrorKind: WebPullErrorKind | null;
  lastErrorAt: string | null;
  /** Son turdaki sayılar. */
  lastRound: WebPullRound | null;
}

export interface WebPullRound {
  pages: number;
  fetched: number;
  inserted: number;
  duplicate: number;
  /** Geçerli `submission_id` taşımayan öğe (onaylanamaz). */
  invalid: number;
  acked: number;
  /** Sitenin tanımadığı onay kimlikleri. */
  unknown: number;
}

export interface WebPullStatusStore {
  load(): Promise<WebPullStatus | null>;
  save(status: WebPullStatus): Promise<void>;
}
