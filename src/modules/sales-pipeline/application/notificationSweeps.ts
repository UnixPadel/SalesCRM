/**
 * Zamana bağlı bildirimler (2026-11-23). Olaydan doğmazlar; zamanlayıcı birkaç dakikada bir tarar:
 *
 *   - `activity_due`      planlı işin saati geldi (son 24 saatte vadesi dolan açık iş) → lead'in sorumlusuna.
 *   - `activity_overdue`  iş 24 saattir yapılmadı (vadesi 24–72 saat önce dolmuş) → sorumluya ikinci kez.
 *   - `hot_untouched`     sıcak lead'e `hotRepHours` saattir dokunulmadı → sorumluya.
 *   - `hot_untouched_manager`  aynı lead `hotManagerHours` saati de geçti → yöneticilere.
 *
 * "Dokunma": temas kaydı, tamamlanan iş ya da elle aşama değişikliği (en yenisi; hiçbiri yoksa lead'in açılışı).
 * İleri tarihli planlı işi olan lead bekliyor sayılmaz. Süre takvim saatidir (hafta sonu ve gece dahil).
 *
 * Her bildirim bir anahtarla yazılır (iş + vade, lead + son dokunma): aynı durum için kişi bir kez uyarılır; iş
 * ertelenir ya da lead'e dokunulursa sayaç yeniden başlar. Pencereler geriye doğru sınırlıdır ki ilk çalıştırmada
 * (ya da sunucu uzun süre kapalı kaldıysa) eski kayıtlar için bildirim yağmasın.
 */
import type { Clock, IdGenerator, Logger } from "../../shared/kernel";
import { RESUBMIT_SUBJECT } from "./createLead";
import type { NotificationDelivery, NotificationType } from "./notifications";

const HOUR = 3_600_000;
/** İşin vadesinden bu kadar sonra "gecikti" bildirimi gider. */
export const OVERDUE_AFTER_HOURS = 24;
/** Vadesi bundan eski işler için bildirim açılmaz. */
export const OVERDUE_LOOKBACK_HOURS = 72;
/** Son dokunması bundan eski sıcak lead'ler için bildirim açılmaz (eski kayıt yağmasın). */
export const HOT_LOOKBACK_DAYS = 14;

export interface DueActivityRow {
  activityId: string;
  activityType: string;
  subject: string;
  dueAt: Date;
  autoCreated: boolean;
  leadId: string;
  userId: string;
  leadName: string;
  company: string;
  country: string | null;
}

export interface IdleHotLeadRow {
  leadId: string;
  userId: string;
  leadName: string;
  company: string;
  country: string | null;
  lastTouchAt: Date;
}

export interface SweepSource {
  /** Açık (bitmemiş) işler: vade `(after, until]`; lead açık aşamada, sorumlusu var, test değil. */
  dueActivities(after: Date, until: Date): Promise<DueActivityRow[]>;
  /** Sıcak, açık, sorumlusu olan, ileri tarihli işi olmayan lead'ler: son dokunma `(after, until]`. */
  idleHotLeads(after: Date, until: Date, now: Date): Promise<IdleHotLeadRow[]>;
}

export interface NotificationSweepsDeps {
  source: SweepSource;
  delivery: NotificationDelivery;
  /** Yönetici kullanıcı kimlikleri (bekleyen sıcak lead'in ikinci adımı). */
  managers(): Promise<readonly string[]>;
  clock: Clock;
  ids: IdGenerator;
  logger: Logger;
  hotRepHours: number;
  hotManagerHours: number;
}

export class NotificationSweeps {
  constructor(private readonly deps: NotificationSweepsDeps) {}

  /** Bir tur; yazılan bildirim sayısı döner. */
  async run(): Promise<number> {
    const now = this.deps.clock.now();
    const sent = (await this.activities(now)) + (await this.hotLeads(now));
    if (sent) this.deps.logger.info("zamanlı bildirimler yazıldı", { sent });
    return sent;
  }

  private async activities(now: Date): Promise<number> {
    const { source } = this.deps;
    const ago = (h: number) => new Date(now.getTime() - h * HOUR);
    let sent = 0;
    for (const a of await source.dueActivities(ago(OVERDUE_AFTER_HOURS), now)) {
      // "Formu tekrar doldurdu" işi açıldığı an vadelidir ve kendi bildirimi vardır; ikinci bir "iş zamanı" gitmez.
      if (a.autoCreated && a.subject === RESUBMIT_SUBJECT) continue;
      sent += await this.activity("activity_due", a, now);
    }
    for (const a of await source.dueActivities(ago(OVERDUE_LOOKBACK_HOURS), ago(OVERDUE_AFTER_HOURS))) {
      sent += await this.activity("activity_overdue", a, now);
    }
    return sent;
  }

  private async activity(type: "activity_due" | "activity_overdue", a: DueActivityRow, now: Date): Promise<number> {
    return this.write(type, a.userId, a, now, `${type}:${a.activityId}:${a.dueAt.toISOString()}`, {
      subject: a.subject,
      activityType: a.activityType,
      dueAt: a.dueAt.toISOString(),
    });
  }

  private async hotLeads(now: Date): Promise<number> {
    const { source, hotRepHours, hotManagerHours, managers } = this.deps;
    const floor = new Date(now.getTime() - HOT_LOOKBACK_DAYS * 24 * HOUR);
    const hours = (l: IdleHotLeadRow) => Math.floor((now.getTime() - l.lastTouchAt.getTime()) / HOUR);
    let sent = 0;
    if (hotRepHours > 0) {
      for (const l of await source.idleHotLeads(floor, new Date(now.getTime() - hotRepHours * HOUR), now)) {
        const key = `hot_untouched:${l.leadId}:${l.lastTouchAt.toISOString()}`;
        sent += await this.write("hot_untouched", l.userId, l, now, key, { hours: hours(l) });
      }
    }
    if (hotManagerHours > 0) {
      const idle = await source.idleHotLeads(floor, new Date(now.getTime() - hotManagerHours * HOUR), now);
      const ids = idle.length ? await managers() : [];
      for (const l of idle) {
        const key = `hot_untouched_manager:${l.leadId}:${l.lastTouchAt.toISOString()}`;
        // Lead'in sahibi yöneticiyse kendi bildirimini zaten aldı.
        for (const m of ids.filter((id) => id !== l.userId)) {
          sent += await this.write("hot_untouched_manager", m, l, now, key, { hours: hours(l), ownerId: l.userId });
        }
      }
    }
    return sent;
  }

  private async write(
    type: NotificationType,
    userId: string,
    lead: { leadId: string; leadName: string; company: string; country: string | null },
    now: Date,
    dedupeKey: string,
    extra: Record<string, unknown>,
  ): Promise<number> {
    const { delivery, ids, logger } = this.deps;
    try {
      const written = await delivery.deliver({
        id: ids.next(),
        userId,
        type,
        leadId: lead.leadId,
        title: `${TITLE[type] ?? type}: ${lead.leadName}`,
        body: JSON.stringify({ leadName: lead.leadName, company: lead.company, country: lead.country, ...extra }),
        createdAt: now,
        readAt: null,
        dedupeKey,
      });
      return written ? 1 : 0;
    } catch (error) {
      logger.error("zamanlı bildirim yazılamadı", { leadId: lead.leadId, userId, type, error });
      return 0;
    }
  }
}

const TITLE: Partial<Record<NotificationType, string>> = {
  activity_due: "İş zamanı geldi",
  activity_overdue: "Geciken iş",
  hot_untouched: "Sıcak lead bekliyor",
  hot_untouched_manager: "Sıcak lead'e dokunulmadı",
};

/** Testler: satırları elle verilen kaynak (pencere süzgecini kendisi uygular). */
export class InMemorySweepSource implements SweepSource {
  activities: DueActivityRow[] = [];
  hot: IdleHotLeadRow[] = [];
  async dueActivities(after: Date, until: Date) {
    return this.activities.filter((a) => a.dueAt > after && a.dueAt <= until);
  }
  async idleHotLeads(after: Date, until: Date) {
    return this.hot.filter((l) => l.lastTouchAt > after && l.lastTouchAt <= until);
  }
}
