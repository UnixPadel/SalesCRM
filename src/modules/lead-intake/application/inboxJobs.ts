/**
 * Inbox işleri (Genel plan, inbox deseni):
 *  - AcceptInboundEvent: webhook controller'ı doğruladıktan sonra çağırır; yazar ve döner (200 hemen).
 *  - ProcessInbox: sırası gelen satırları adaptörden geçirip CreateLeadFromAd'a verir. Geçici hata →
 *    config'teki aralıklarla yeniden deneme; kalıcı hata ya da aralıklar bitti → failed.
 *  - RunBackfill: her yedek senkron kaynağından son N saatin lead'lerini aynı inbox'a yazar.
 *  - PurgeInboxPayloads: N günden eski payload'ları siler.
 */
import { isAppError, MINUTE, type Clock, type IdGenerator, type Logger } from "../../shared/kernel";
import type { CreateLeadFromAd } from "./createLeadFromAd";
import { dedupeKeyFor, type InboxKind } from "./dto";
import type { AdapterContext, BackfillSource, InboxRepository, MappingSource, SourceAdapter } from "./ports";

export interface AcceptInput {
  provider: string;
  kind: InboxKind;
  platformLeadId: string;
  payload: unknown;
}

export class AcceptInboundEvent {
  constructor(
    private readonly inbox: InboxRepository,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly logger: Logger,
  ) {}

  async execute(input: AcceptInput): Promise<{ id: string; dedupeKey: string; status: "inserted" | "duplicate" }> {
    const now = this.clock.now();
    const id = this.ids.next();
    const dedupeKey = dedupeKeyFor(input.provider, input.platformLeadId);
    const status = await this.inbox.enqueue({
      id,
      provider: input.provider,
      kind: input.kind,
      dedupeKey,
      payload: input.payload,
      receivedAt: now,
      nextAttemptAt: now,
    });
    this.logger.info(status === "inserted" ? "inbox: bildirim alındı" : "inbox: aynı bildirim yine geldi", {
      inboxId: id,
      provider: input.provider,
      kind: input.kind,
      platformLeadId: input.platformLeadId,
    });
    return { id, dedupeKey, status };
  }
}

export interface ProcessInboxDeps {
  inbox: InboxRepository;
  adapters: readonly SourceAdapter[];
  mappings: MappingSource;
  createLead: CreateLeadFromAd;
  clock: Clock;
  logger: Logger;
  retryMinutes: readonly number[];
  defaultCountry: string;
  /** İşlenirken tutulan kilit; süreç çökerse bu süre sonra satır yeniden alınır. */
  lockMs?: number;
  batchSize?: number;
}

export interface ProcessInboxStats {
  claimed: number;
  done: number;
  retried: number;
  failed: number;
}

export class ProcessInbox {
  private readonly byProvider: ReadonlyMap<string, SourceAdapter>;
  constructor(private readonly deps: ProcessInboxDeps) {
    this.byProvider = new Map(deps.adapters.map((a) => [a.provider, a]));
  }

  async runOnce(): Promise<ProcessInboxStats> {
    const { inbox, clock, logger } = this.deps;
    const stats: ProcessInboxStats = { claimed: 0, done: 0, retried: 0, failed: 0 };
    const due = await inbox.claimDue(clock.now(), this.deps.batchSize ?? 20, this.deps.lockMs ?? 10 * MINUTE);
    stats.claimed = due.length;
    for (const event of due) {
      const log = logger.child({ inboxId: event.id, provider: event.provider, attempt: event.attempts });
      try {
        const leadId = await this.handle(event.provider, event.payload, event.dedupeKey);
        await inbox.markDone(event.id, leadId, clock.now());
        stats.done += 1;
      } catch (e: unknown) {
        const error = isAppError(e) || e instanceof UnexpectedError ? e : new UnexpectedError(e);
        const delay = error.kind === "transient" ? this.deps.retryMinutes[event.attempts - 1] : undefined;
        if (delay !== undefined) {
          const next = new Date(clock.now().getTime() + delay * MINUTE);
          await inbox.markRetry(event.id, next, { code: error.code, message: error.message });
          log.warn("inbox: geçici hata, yeniden denenecek", { code: error.code, nextAttemptAt: next.toISOString() });
          stats.retried += 1;
        } else {
          const code = error.kind === "transient" ? "intake.retries_exhausted" : error.code;
          await inbox.markFailed(event.id, { code, message: error.message }, clock.now());
          log.error("inbox: kalıcı hata, failed", { code, error });
          stats.failed += 1;
        }
      }
    }
    return stats;
  }

  private async handle(provider: string, payload: unknown, dedupeKey: string): Promise<string> {
    const adapter = this.byProvider.get(provider);
    if (!adapter) throw new UnexpectedError(new Error(`adaptör yok: ${provider}`), "intake.unknown_provider");
    if (payload === null || payload === undefined) {
      throw new UnexpectedError(new Error("payload silinmiş"), "intake.payload_purged");
    }
    const ctx: AdapterContext = {
      mappingsFor: (formId) => this.deps.mappings.mappingsFor(provider, formId),
      defaultCountry: this.deps.defaultCountry,
    };
    const dto = await adapter.toInboundLead(payload, ctx);
    if (dedupeKeyFor(dto.provider, dto.platformLeadId) !== dedupeKey) {
      this.deps.logger.warn("inbox: adaptör farklı platform kimliği döndü", { dedupeKey, got: dto.platformLeadId });
    }
    const r = await this.deps.createLead.execute(dto);
    if (!r.ok) throw r.error;
    return r.value.leadId;
  }
}

/** Beklenmeyen istisna (kod hatası, bilinmeyen sağlayıcı): kalıcı sayılır, satır failed olur. */
class UnexpectedError extends Error {
  readonly kind = "permanent" as const;
  readonly code: string;
  constructor(cause: unknown, code = "intake.unexpected") {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = "UnexpectedError";
    this.code = code;
  }
}

export class RunBackfill {
  constructor(
    private readonly deps: {
      sources: readonly BackfillSource[];
      inbox: InboxRepository;
      ids: IdGenerator;
      clock: Clock;
      logger: Logger;
      lookbackMs: number;
    },
  ) {}

  async runOnce(): Promise<Record<string, { fetched: number; inserted: number; error?: string }>> {
    const out: Record<string, { fetched: number; inserted: number; error?: string }> = {};
    const now = this.deps.clock.now();
    const since = new Date(now.getTime() - this.deps.lookbackMs);
    for (const source of this.deps.sources) {
      const log = this.deps.logger.child({ provider: source.provider, job: "backfill" });
      try {
        const items = await source.fetchSince(since);
        let inserted = 0;
        for (const item of items) {
          const status = await this.deps.inbox.enqueue({
            id: this.deps.ids.next(),
            provider: source.provider,
            kind: "backfill",
            dedupeKey: item.dedupeKey,
            payload: item.payload,
            receivedAt: now,
            nextAttemptAt: now,
          });
          if (status === "inserted") inserted += 1;
        }
        out[source.provider] = { fetched: items.length, inserted };
        log.info("yedek senkron bitti", { fetched: items.length, inserted, since: since.toISOString() });
      } catch (e: unknown) {
        const code = isAppError(e) ? e.code : "backfill.unexpected";
        out[source.provider] = { fetched: 0, inserted: 0, error: code };
        log.warn("yedek senkron başarısız; bir sonraki turda yeniden", { code, error: e });
      }
    }
    return out;
  }
}

export class PurgeInboxPayloads {
  constructor(private readonly deps: { inbox: InboxRepository; clock: Clock; logger: Logger; retentionMs: number }) {}

  async runOnce(): Promise<number> {
    const now = this.deps.clock.now();
    const n = await this.deps.inbox.purgePayloads(new Date(now.getTime() - this.deps.retentionMs), now);
    if (n > 0) this.deps.logger.info("inbox: eski payload'lar silindi", { count: n });
    return n;
  }
}
