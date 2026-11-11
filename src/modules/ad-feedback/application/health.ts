/**
 * Giden olay kuyruğunun sağlığı (Faz 7a) ve platformdaki akıbet sorgusu (7c). Yalnız yönetici panelinden çağrılır.
 *  - Özet: sağlayıcı × durum sayıları, atlama nedenleri, en eski bekleyen, son gönderim.
 *  - Liste: dead / failed (ya da istenen durum) satırları; lead ve aşama bilgisi sales-pipeline sorgusundan.
 *  - Yeniden kuyruğa alma: yalnız `dead` ve `failed`. dead → pending (deneme döngüsü baştan), failed → hemen dene.
 *    Listedeki satırlardan biri bile uygun değilse hiçbiri değişmez (`outbox.not_requeueable`).
 * Kişisel veri taşımaz: satır kimliği, lead kimliği, durum, yanıt kodu ve platform hata metni.
 */
import { NotFoundError, RuleError, err, ok, type Clock, type Logger, type Result } from "../../shared/kernel";
import type {
  OutboundDetail,
  OutboundListItem,
  OutboundStatus,
  OutboxListFilter,
  OutboxStats,
  PlatformRequestStatus,
} from "./dto";
import type { OutboxRepository, PlatformSender, StageContextSource } from "./ports";

export const REQUEUEABLE: readonly OutboundStatus[] = ["dead", "failed"];
export const isRequeueable = (status: OutboundStatus): boolean => REQUEUEABLE.includes(status);

export interface OutboxHealthDeps {
  outbox: OutboxRepository;
  context: StageContextSource;
  senders: readonly PlatformSender[];
  clock: Clock;
  logger: Logger;
}

export class OutboxHealth {
  constructor(private readonly deps: OutboxHealthDeps) {}

  stats(): Promise<OutboxStats> {
    return this.deps.outbox.stats();
  }

  async list(filter: OutboxListFilter): Promise<OutboundListItem[]> {
    const rows = await this.deps.outbox.list(filter);
    const byEvent = new Map(
      (await this.deps.context.outboundContext(rows.map((r) => r.stageEventId))).map((c) => [c.stageEventId, c]),
    );
    return rows.map((r) => {
      const c = byEvent.get(r.stageEventId);
      return { ...r, leadId: c?.leadId ?? null, stageCode: c?.stageCode ?? null, occurredAt: c?.occurredAt ?? null };
    });
  }

  /** Hangi sağlayıcının akıbet sorgusu var (ekranda düğmeyi açmak için). */
  statusProviders(): string[] {
    return this.deps.senders.filter((s) => typeof s.requestStatus === "function").map((s) => s.provider);
  }

  async requeue(ids: readonly string[], actorUserId: string): Promise<Result<{ requeued: number }, RuleError>> {
    const unique = [...new Set(ids)];
    if (!unique.length)
      return err(new RuleError("outbox.not_requeueable", "Yeniden kuyruğa alınacak satır seçilmedi."));
    const rows = await this.deps.outbox.findByIds(unique);
    const bad = unique.filter((id) => {
      const row = rows.find((r) => r.id === id);
      return !row || !isRequeueable(row.status);
    });
    if (bad.length) {
      return err(
        new RuleError("outbox.not_requeueable", "Yalnız başarısız ve kalıcı hatalı satırlar yeniden kuyruğa alınır.", {
          ids: bad,
        }),
      );
    }
    const requeued = await this.deps.outbox.requeue(unique, this.deps.clock.now());
    this.deps.logger.info("outbox: satırlar yeniden kuyruğa alındı", {
      requeued,
      ids: unique,
      requeuedBy: actorUserId,
    });
    return ok({ requeued });
  }

  /** 7c: gönderilmiş satırın platformdaki akıbeti. Yalnız istek kimliği saklanan ve sorgu destekleyen sağlayıcıda. */
  async requestStatus(id: string): Promise<Result<PlatformRequestStatus, RuleError | NotFoundError>> {
    const row: OutboundDetail | undefined = (await this.deps.outbox.findByIds([id]))[0];
    if (!row) return err(new NotFoundError("outbound_event", id));
    const sender = this.deps.senders.find((s) => s.provider === row.provider);
    if (!sender?.requestStatus || row.status !== "sent" || !row.requestId) {
      return err(
        new RuleError("status.unsupported", "Bu satır için platformdan durum sorgulanamaz.", {
          provider: row.provider,
          status: row.status,
          hasRequestId: Boolean(row.requestId),
        }),
      );
    }
    try {
      return ok(await sender.requestStatus(row.requestId));
    } catch (e) {
      return err(
        new RuleError("status.unavailable", "Platform durum sorgusu yanıt vermedi.", {
          error: e instanceof Error ? e.message : String(e),
        }),
      );
    }
  }
}
