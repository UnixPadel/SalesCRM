/**
 * Gelen kutusunun sağlığı (Faz 7a). Yalnız yönetici panelinden çağrılır.
 *  - Özet: sağlayıcı × durum sayıları, son 24 saatte alınan, en eski bekleyen, payload temizliği.
 *  - Başarısız satırlar: payload'sız (kişisel veri taşımaz); hata kodu ve metni, deneme sayısı, lead bağı.
 *  - Yeniden işleme: yalnız `failed` ve payload'ı silinmemiş satır → `pending` (deneme döngüsü baştan).
 *    Seçilenlerden biri bile uygun değilse hiçbiri değişmez (`inbox.not_requeueable`).
 */
import { RuleError, err, ok, type Clock, type Logger, type Result } from "../../shared/kernel";
import type { InboxFailedItem, InboxStats } from "./dto";
import type { InboxRepository } from "./ports";

const DAY = 24 * 60 * 60_000;

export interface InboxHealthDeps {
  inbox: InboxRepository;
  clock: Clock;
  logger: Logger;
  /** Payload saklama süresi (gün); temizlik bekleyen satır sayısı buna göre hesaplanır. */
  retentionDays: number;
}

export class InboxHealth {
  constructor(private readonly deps: InboxHealthDeps) {}

  stats(): Promise<InboxStats> {
    const now = this.deps.clock.now();
    return this.deps.inbox.stats(
      new Date(now.getTime() - DAY),
      new Date(now.getTime() - this.deps.retentionDays * DAY),
    );
  }

  listFailed(limit = 100): Promise<InboxFailedItem[]> {
    return this.deps.inbox.listFailed(Math.max(1, Math.min(500, limit)));
  }

  async requeue(ids: readonly string[], actorUserId: string): Promise<Result<{ requeued: number }, RuleError>> {
    const unique = [...new Set(ids)];
    if (!unique.length) return err(new RuleError("inbox.not_requeueable", "Yeniden işlenecek satır seçilmedi."));
    const ready = new Set(await this.deps.inbox.requeueable(unique));
    const bad = unique.filter((id) => !ready.has(id));
    if (bad.length) {
      return err(
        new RuleError("inbox.not_requeueable", "Yalnız başarısız ve içeriği silinmemiş satırlar yeniden işlenir.", {
          ids: bad,
        }),
      );
    }
    const requeued = await this.deps.inbox.requeue(unique, this.deps.clock.now());
    this.deps.logger.info("inbox: satırlar yeniden işleme alındı", { requeued, ids: unique, requeuedBy: actorUserId });
    return ok({ requeued });
  }
}
