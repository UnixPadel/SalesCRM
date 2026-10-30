/**
 * Giden olay dağıtıcısı (Genel plan outbox deseni; ADR-0003, ADR-0011). Platformdan bağımsız.
 *
 * Her dakika: sırası gelmiş `pending`/`failed` satırları al (10 dk bekleme `next_attempt_at`'ta, kuyruğa
 * yazılırken konur) → sales-pipeline'dan bağlam → filtreler (`skipped` + neden) → sağlayıcı başına toplu
 * gönderim → yanıt sınıflandırması: 2xx `sent`; 400 / doğrulama `dead` (toplu istekte tek tek yeniden denenir,
 * yalnız hatalı olan dead olur); 429 / 5xx / zaman aşımı → 1, 5, 30, 120, 720 dk sonra yeniden, sonra `dead`.
 */
import type { Clock, Logger } from "../../shared/kernel";
import type { OutboundStageEvent } from "../../sales-pipeline/application";
import type { DispatchStats, OutboundRow, PreparedEvent, SendResult, SkipReason } from "./dto";
import type { OutboundPolicySource, OutboxRepository, PlatformSender, StageContextSource } from "./ports";

export interface DispatchOutboxDeps {
  outbox: OutboxRepository;
  context: StageContextSource;
  policy: OutboundPolicySource;
  senders: readonly PlatformSender[];
  clock: Clock;
  logger: Logger;
  /** Geçici hatada yeniden deneme aralıkları (dakika); liste bitince `dead`. */
  retryMinutes: readonly number[];
  /** KVKK onayı aranan tür; web formu lead'inde verilmiş onay yoksa `no_consent`. */
  consentRequiredType: string;
  /** Tek tikte alınacak en çok satır ve sağlayıcıya tek istekte gidecek en çok olay. */
  claimLimit?: number;
  batchSize?: number;
  /** Alınan satırın kilit süresi; bu süre içinde başka instance almaz. */
  lockMs?: number;
}

const MINUTE = 60_000;

/**
 * Onay kuralı: platform formu lead'lerinde onay platformun formunda alınmış sayılır; web formu lead'inde
 * aranan türde verilmiş onay şart. Her kaynakta aranan türün son kaydı "verilmedi" ise gönderilmez.
 */
export function consentAllows(ctx: OutboundStageEvent, requiredType: string): boolean {
  const ofType = ctx.consents
    .filter((c) => c.type === requiredType)
    .sort((a, b) => a.grantedAt.getTime() - b.grantedAt.getTime());
  const latest = ofType[ofType.length - 1];
  if (latest && !latest.granted) return false;
  if (ctx.lead.source === "web_form") return Boolean(latest?.granted);
  return true;
}

/** Filtre sırası sabittir: ilk eşleşen neden yazılır. `null` → gönderilebilir. */
export function skipReasonFor(
  ctx: OutboundStageEvent,
  opts: { enabled: boolean; mappingEnabled: boolean | undefined; consentRequiredType: string },
): SkipReason | null {
  if (!opts.enabled) return "emergency_stop";
  if (ctx.undoneAt) return "undone";
  if (ctx.lead.isTest) return "test_lead";
  if (ctx.lead.source === "manual" || ctx.lead.source === "import") return "manual_source";
  if (!consentAllows(ctx, opts.consentRequiredType)) return "no_consent";
  if (opts.mappingEnabled === undefined) return "mapping_missing";
  if (!opts.mappingEnabled) return "mapping_disabled";
  return null;
}

export class DispatchOutbox {
  private readonly claimLimit: number;
  private readonly batchSize: number;
  private readonly lockMs: number;

  constructor(private readonly deps: DispatchOutboxDeps) {
    this.claimLimit = deps.claimLimit ?? 200;
    this.batchSize = deps.batchSize ?? 100;
    this.lockMs = deps.lockMs ?? 5 * MINUTE;
  }

  async runOnce(): Promise<DispatchStats> {
    const { outbox, logger } = this.deps;
    const now = this.deps.clock.now();
    const stats: DispatchStats = { claimed: 0, sent: 0, retried: 0, dead: 0, skipped: 0 };
    const rows = await outbox.claimDue(now, this.claimLimit, this.lockMs);
    stats.claimed = rows.length;
    if (!rows.length) return stats;

    const contexts = new Map<string, OutboundStageEvent>();
    for (const c of await this.deps.context.outboundContext(rows.map((r) => r.stageEventId)))
      contexts.set(c.stageEventId, c);

    const byProvider = new Map<string, OutboundRow[]>();
    for (const r of rows) byProvider.set(r.provider, [...(byProvider.get(r.provider) ?? []), r]);

    for (const [provider, providerRows] of byProvider) {
      const sender = this.deps.senders.find((s) => s.provider === provider);
      if (!sender) {
        for (const r of providerRows) {
          await outbox.markDead(r.id, null, `sağlayıcı adaptörü yok: ${provider}`, now);
          stats.dead += 1;
        }
        logger.error("dağıtıcı: sağlayıcı adaptörü yok", { provider, rows: providerRows.length });
        continue;
      }
      const enabled = await this.deps.policy.outboundEnabled(provider);
      const mappings = await this.deps.policy.stageMappingsFor(provider);
      const ready: PreparedEvent[] = [];

      for (const row of providerRows) {
        const ctx = contexts.get(row.stageEventId);
        if (!ctx) {
          await outbox.markDead(row.id, null, "aşama olayı ya da lead bulunamadı", now);
          stats.dead += 1;
          continue;
        }
        const mapping = mappings.get(ctx.stageCode);
        const reason = skipReasonFor(ctx, {
          enabled,
          mappingEnabled: mapping?.enabled,
          consentRequiredType: this.deps.consentRequiredType,
        });
        if (reason) {
          await outbox.markSkipped(row.id, reason, now);
          stats.skipped += 1;
          continue;
        }
        const prepared = sender.prepare(ctx, mapping!.platformEventName, row);
        if (prepared.kind === "skip") {
          await outbox.markSkipped(row.id, prepared.reason, now);
          stats.skipped += 1;
          continue;
        }
        ready.push(prepared.event);
      }

      for (let i = 0; i < ready.length; i += this.batchSize) {
        await this.sendBatch(sender, ready.slice(i, i + this.batchSize), now, stats);
      }
    }

    logger.info("dağıtıcı turu", { ...stats, providers: [...byProvider.keys()] });
    return stats;
  }

  private async sendBatch(
    sender: PlatformSender,
    batch: readonly PreparedEvent[],
    now: Date,
    stats: DispatchStats,
  ): Promise<void> {
    const result = await this.safeSend(sender, batch);
    if (result.kind === "ok") {
      await this.deps.outbox.markSent(
        batch.map((e) => e.row.id),
        result.code,
        now,
      );
      stats.sent += batch.length;
      return;
    }
    if (result.kind === "dead" && batch.length > 1) {
      // Toplu istek reddedildi: hatalı olayı bulmak için tek tek gönder.
      this.deps.logger.warn("dağıtıcı: toplu istek reddedildi, olaylar tek tek deneniyor", {
        provider: sender.provider,
        size: batch.length,
        code: result.code,
      });
      for (const e of batch) await this.sendBatch(sender, [e], now, stats);
      return;
    }
    for (const e of batch) {
      if (result.kind === "dead") {
        await this.deps.outbox.markDead(e.row.id, result.code, result.error, now);
        stats.dead += 1;
      } else {
        await this.scheduleRetry(e.row, result, now, stats);
      }
    }
    this.deps.logger.warn("dağıtıcı: gönderim başarısız", {
      provider: sender.provider,
      kind: result.kind,
      code: result.code,
      size: batch.length,
    });
  }

  private async scheduleRetry(
    row: OutboundRow,
    result: Extract<SendResult, { kind: "retry" }>,
    now: Date,
    stats: DispatchStats,
  ): Promise<void> {
    // row.attempts bu denemeyi de sayar (claim artırdı).
    const delay = this.deps.retryMinutes[row.attempts - 1];
    if (delay === undefined) {
      await this.deps.outbox.markDead(row.id, result.code, `${result.error} (yeniden deneme hakkı bitti)`, now);
      stats.dead += 1;
      return;
    }
    await this.deps.outbox.markRetry(row.id, new Date(now.getTime() + delay * MINUTE), result.code, result.error);
    stats.retried += 1;
  }

  private async safeSend(sender: PlatformSender, batch: readonly PreparedEvent[]): Promise<SendResult> {
    try {
      return await sender.send(batch);
    } catch (e) {
      return { kind: "retry", code: null, error: e instanceof Error ? e.message : String(e) };
    }
  }
}
