/**
 * Tek seferlik geriye doldurma (Faz 4): Faz 2'den beri biriken platform lead'lerinin aşama olayları için
 * eksik outbox satırlarını `pending` açar. Mevcut satıra (sent, dead, skipped, pending) dokunmaz; geri alınmış
 * ve test lead'i olayları hiç seçilmez. Açılan satırları normal dağıtıcı gönderir (filtreler yine uygulanır).
 */
import type { Clock, Logger } from "../../shared/kernel";
import type { BackfillEventSource, OutboxRepository } from "./ports";

export interface BackfillOutboxInput {
  provider: string;
  since: Date;
  sources: readonly ("meta_form" | "google_form" | "web_form")[];
  /** true: yalnız sayar, satır açmaz. */
  dryRun?: boolean;
}

export interface BackfillOutboxResult {
  candidates: number;
  enqueued: number;
  dryRun: boolean;
}

export class BackfillOutbox {
  constructor(
    private readonly deps: { outbox: OutboxRepository; events: BackfillEventSource; clock: Clock; logger: Logger },
  ) {}

  async run(input: BackfillOutboxInput): Promise<BackfillOutboxResult> {
    const events = await this.deps.events.stageEventsSince(input.since, input.sources);
    const ids = events.map((e) => e.stageEventId);
    const dryRun = input.dryRun ?? false;
    const enqueued = dryRun ? 0 : await this.deps.outbox.enqueueMissing(ids, input.provider, this.deps.clock.now());
    this.deps.logger.info("geriye doldurma", {
      provider: input.provider,
      since: input.since.toISOString(),
      sources: input.sources,
      candidates: ids.length,
      enqueued,
      dryRun,
    });
    return { candidates: ids.length, enqueued, dryRun };
  }
}
