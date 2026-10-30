/**
 * Günlük dead-letter raporu: son 24 saatte `dead` olan giden olaylar, sağlayıcı başına sayı ve satır listesi,
 * e-postayla alıcılara. Kişisel veri yok: yalnız kimlikler, kodlar ve hata metni.
 */
import type { Clock, Logger } from "../../shared/kernel";
import type { DeadRow } from "./dto";
import type { OutboxRepository, ReportMailer } from "./ports";

export interface DeadLetterReportDeps {
  outbox: OutboxRepository;
  mailer: ReportMailer;
  recipients: readonly string[];
  clock: Clock;
  logger: Logger;
  /** Rapor penceresi (saat); varsayılan 24. */
  windowHours?: number;
  /** Bağlantılar için (admin, Faz 6'da sağlık paneli); boşsa yalnız kimlik yazılır. */
  publicBaseUrl?: string;
}

export function renderDeadLetterReport(rows: readonly DeadRow[], since: Date, until: Date): string {
  const byProvider = new Map<string, number>();
  for (const r of rows) byProvider.set(r.provider, (byProvider.get(r.provider) ?? 0) + 1);
  const lines = [
    `Giden olay dead-letter raporu`,
    `Pencere: ${since.toISOString()} – ${until.toISOString()}`,
    `Toplam: ${rows.length}`,
    ...[...byProvider].map(([p, n]) => `  ${p}: ${n}`),
    "",
    "Satırlar (outbox id · aşama olayı · sağlayıcı · deneme · kod · hata):",
    ...rows.map(
      (r) =>
        `- ${r.id} · ${r.stageEventId} · ${r.provider} · ${r.attempts} · ${r.lastResponseCode ?? "-"} · ${(r.lastError ?? "").slice(0, 200)}`,
    ),
    "",
    "Yeniden kuyruğa almak için (Faz 6 ekranına kadar): UPDATE outbound_conversion_events SET status = 'pending', attempts = 0, next_attempt_at = now() WHERE id = '<id>';",
  ];
  return lines.join("\n");
}

export class DeadLetterReport {
  constructor(private readonly deps: DeadLetterReportDeps) {}

  async runOnce(): Promise<{ dead: number; mailed: number }> {
    const until = this.deps.clock.now();
    const since = new Date(until.getTime() - (this.deps.windowHours ?? 24) * 3_600_000);
    const rows = await this.deps.outbox.listDead(since);
    if (!rows.length) {
      this.deps.logger.info("dead-letter raporu: satır yok", { since: since.toISOString() });
      return { dead: 0, mailed: 0 };
    }
    if (!this.deps.recipients.length) {
      this.deps.logger.warn("dead-letter raporu: alıcı tanımsız, yalnız loglandı", { dead: rows.length });
      return { dead: rows.length, mailed: 0 };
    }
    const text = renderDeadLetterReport(rows, since, until);
    const subject = `[CRM] Giden olay dead-letter: ${rows.length} satır`;
    let mailed = 0;
    for (const to of this.deps.recipients) {
      try {
        await this.deps.mailer.send({ to, subject, text });
        mailed += 1;
      } catch (e) {
        this.deps.logger.error("dead-letter raporu gönderilemedi", { error: e });
      }
    }
    this.deps.logger.info("dead-letter raporu gönderildi", { dead: rows.length, mailed });
    return { dead: rows.length, mailed };
  }
}
