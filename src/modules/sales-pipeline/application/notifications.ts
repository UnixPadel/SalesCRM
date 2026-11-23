/**
 * Bildirimler: domain olaylarına abone olur, aşama motorunu çağırmaz (Genel plan). Bildirim, e-posta ve push
 * hatası lead akışını bozmaz; loglanır (olaylar transaction sonrası yayınlanır).
 *
 * Olaydan doğanlar (bu dosya):
 *   - `LeadCreated`: atanan satışçıya zil + e-posta (Faz 2).
 *   - `LeadAssigned`: lead başka birine verildiyse yeni sorumluya zil (2026-11-23; elle atama ve devir).
 *   - `LeadFormResubmitted`: açık lead'in sahibine "formu tekrar doldurdu".
 * Zamana bağlı olanlar (iş vadesi, bekleyen sıcak lead) `notificationSweeps.ts`'tedir.
 * Her yeni bildirim, kişinin abone tarayıcılarına Web Push olarak da gider (`push.ts`).
 */
import type { Clock, IdGenerator, Logger } from "../../shared/kernel";
import { isHotLead, type DomainEvent, type DomainEventPublisher, type Lead, type UnitOfWork } from "../domain";
import type { Actor } from "./types";

export const NOTIFICATION_TYPES = [
  "lead_assigned",
  "lead_transferred",
  "form_resubmitted",
  "activity_due",
  "activity_overdue",
  "hot_untouched",
  "hot_untouched_manager",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export interface Notification {
  id: string;
  userId: string;
  type: NotificationType;
  leadId: string | null;
  /** Düz metin başlık (e-posta ve yedek görünüm için, TR). Arayüz `type` + `body` ile kendi dilinde yazar. */
  title: string;
  /** JSON: { leadName, company, country, source, isTest } + türe göre { subject, activityType, hours, ownerId, fromUserId } */
  body: string;
  createdAt: Date;
  readAt: Date | null;
  /** Aynı kişiye aynı anahtarla ikinci bildirim yazılmaz (zamanlı işler); yoksa tekilleştirme yapılmaz. */
  dedupeKey?: string | null | undefined;
}

export interface NotificationStore {
  /** false: aynı `dedupeKey` ile bildirim zaten var, satır yazılmadı. */
  insert(n: Notification): Promise<boolean>;
  listForUser(userId: string, limit: number): Promise<Notification[]>;
  unreadCount(userId: string): Promise<number>;
  /** Yalnız sahibi okundu yapabilir; satır yoksa ya da başkasınınsa false. */
  markRead(id: string, userId: string, now: Date): Promise<boolean>;
  markAllRead(userId: string, now: Date): Promise<number>;
}

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

export interface DirectoryUser {
  id: string;
  name: string;
  email: string | null;
}

/** Kullanıcı rehberi (ad, e-posta): şirket kullanıcı tablosu; bootstrap bağlar. */
export interface UserDirectory {
  findById(userId: string): Promise<DirectoryUser | undefined>;
}

/** Anlık kanal (Web Push); bildirim satırı yazıldıktan sonra çağrılır. */
export interface PushSender {
  send(n: Notification): Promise<void>;
}

/** Bildirimi yazar; yeni satırsa push'a da verir. Push hatası yutulur ve loglanır. */
export class NotificationDelivery {
  constructor(
    private readonly deps: { notifications: NotificationStore; push?: PushSender | null | undefined; logger: Logger },
  ) {}

  /** true: bildirim yazıldı (tekrar değil). */
  async deliver(n: Notification): Promise<boolean> {
    const { notifications, push, logger } = this.deps;
    if (!(await notifications.insert(n))) return false;
    logger.info("bildirim yazıldı", { leadId: n.leadId, userId: n.userId, type: n.type });
    if (push) {
      await push
        .send(n)
        .catch((error: unknown) => logger.warn("push gönderilemedi", { userId: n.userId, type: n.type, error }));
    }
    return true;
  }
}

export interface LeadNotifierDeps {
  uow: UnitOfWork;
  notifications: NotificationStore;
  /** Web Push; yoksa yalnız zil (ve e-posta). */
  push?: PushSender | null | undefined;
  /** null: e-posta kapalı (SMTP yapılandırılmadı); yalnız uygulama içi. */
  email: EmailSender | null;
  users: UserDirectory;
  clock: Clock;
  ids: IdGenerator;
  logger: Logger;
  /** Bağlantı kökü (https://crm…); boşsa e-postada bağlantı yerine lead kimliği yazılır. */
  publicBaseUrl: string;
}

export const leadLink = (baseUrl: string, leadId: string): string =>
  baseUrl ? `${baseUrl}/#/lead/${leadId}` : `#/lead/${leadId}`;

export class LeadNotifier implements DomainEventPublisher {
  private readonly delivery: NotificationDelivery;

  constructor(private readonly deps: LeadNotifierDeps) {
    this.delivery = new NotificationDelivery(deps);
  }

  async publish(events: readonly DomainEvent[]): Promise<void> {
    // Yeni lead'in ilk ataması `LeadCreated` ile bildirilir; aynı partideki `LeadAssigned` ikinci bildirim açmaz.
    const created = new Set(events.filter((e) => e.type === "LeadCreated").map((e) => e.leadId));
    for (const e of events) {
      // Kişinin kendi yaptığı işlem (kendi açtığı lead, havuzdan üstlenme) için bildirim gitmez.
      if (e.type === "LeadCreated" && e.assignedUserId && e.assignedUserId !== e.actorUserId) {
        const userId = e.assignedUserId;
        await this.guard(e.leadId, userId, async () => {
          const lead = await this.notify(e.leadId, userId, "lead_assigned");
          if (lead) await this.sendEmail(lead, userId);
        });
      } else if (e.type === "LeadAssigned" && e.to && e.to !== e.actorUserId && !created.has(e.leadId)) {
        const userId = e.to;
        const extra = e.from ? { fromUserId: e.from } : {};
        await this.guard(e.leadId, userId, () =>
          this.notify(e.leadId, userId, e.from ? "lead_transferred" : "lead_assigned", extra),
        );
      } else if (e.type === "LeadFormResubmitted" && e.assignedUserId) {
        const userId = e.assignedUserId;
        await this.guard(e.leadId, userId, () => this.notify(e.leadId, userId, "form_resubmitted"));
      }
    }
  }

  private guard(leadId: string, userId: string, fn: () => Promise<unknown>): Promise<unknown> {
    return fn().catch((error: unknown) => this.deps.logger.error("bildirim yazılamadı", { leadId, userId, error }));
  }

  private async notify(
    leadId: string,
    userId: string,
    type: NotificationType,
    extra: Record<string, unknown> = {},
  ): Promise<Lead | undefined> {
    const { uow, clock, ids } = this.deps;
    const lead = await uow.run((repos) => repos.leads.findById(leadId));
    if (!lead) return undefined;
    await this.delivery.deliver({
      id: ids.next(),
      userId,
      type,
      leadId: lead.id,
      title: `${TITLE[type] ?? titlePrefix(lead)}: ${lead.fullName}`,
      body: JSON.stringify({ ...bodyOf(lead), ...extra }),
      createdAt: clock.now(),
      readAt: null,
    });
    return lead;
  }

  private async sendEmail(lead: Lead, userId: string): Promise<void> {
    const { email, users, logger, publicBaseUrl } = this.deps;
    if (!email) return;
    const user = await users.findById(userId).catch(() => undefined);
    if (!user?.email) {
      logger.warn("e-posta bildirimi: kullanıcının e-postası yok", { leadId: lead.id, userId });
      return;
    }
    const lines = [
      `Merhaba ${user.name || ""},`.trim(),
      "",
      `Size yeni bir lead atandı: ${lead.fullName}${lead.company ? ` (${lead.company})` : ""}.`,
      `Ülke: ${lead.country ?? "-"} · Kaynak: ${lead.source}${lead.isTest ? " · TEST" : ""}`,
      "",
      `Lead'i açın: ${leadLink(publicBaseUrl, lead.id)}`,
      "",
      "Bu ileti Unixpadel CRM tarafından otomatik gönderildi.",
    ];
    try {
      await email.send({ to: user.email, subject: `${titlePrefix(lead)}: ${lead.fullName}`, text: lines.join("\n") });
      logger.info("e-posta bildirimi gönderildi", { leadId: lead.id, userId });
    } catch (err: unknown) {
      logger.warn("e-posta bildirimi gönderilemedi", { leadId: lead.id, userId, error: err });
    }
  }
}

/** Düz metin başlık öneki (TR; yedek görünüm). `lead_assigned` lead'e göre "Yeni lead" / "Sıcak lead" alır. */
const TITLE: Partial<Record<NotificationType, string>> = {
  lead_transferred: "Lead size devredildi",
  form_resubmitted: "Formu tekrar doldurdu",
};

/** Faz 7g (§4.8): kurulumu "3 ay içinde" olan açık lead "Sıcak lead:" ile başlar; başka değişiklik yok. */
export const titlePrefix = (lead: Lead): string => (isHotLead(lead) ? "Sıcak lead" : "Yeni lead");

export const bodyOf = (lead: Lead) => ({
  leadName: lead.fullName,
  company: lead.company,
  country: lead.country,
  source: lead.source,
  isTest: lead.isTest,
});

export class NotificationQueries {
  constructor(
    private readonly store: NotificationStore,
    private readonly clock: Clock,
  ) {}

  async list(actor: Actor, limit = 50): Promise<{ items: Notification[]; unreadCount: number }> {
    const [items, unreadCount] = await Promise.all([
      this.store.listForUser(actor.userId, limit),
      this.store.unreadCount(actor.userId),
    ]);
    return { items, unreadCount };
  }

  markRead(id: string, actor: Actor): Promise<boolean> {
    return this.store.markRead(id, actor.userId, this.clock.now());
  }

  markAllRead(actor: Actor): Promise<number> {
    return this.store.markAllRead(actor.userId, this.clock.now());
  }
}

/** Bellek içi depo ve sahte göndericiler (testler). */
export class InMemoryNotificationStore implements NotificationStore {
  rows: Notification[] = [];
  async insert(n: Notification) {
    if (n.dedupeKey && this.rows.some((r) => r.userId === n.userId && r.dedupeKey === n.dedupeKey)) return false;
    this.rows.push({ ...n });
    return true;
  }
  async listForUser(userId: string, limit: number) {
    return this.rows
      .filter((r) => r.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit)
      .map((r) => ({ ...r }));
  }
  async unreadCount(userId: string) {
    return this.rows.filter((r) => r.userId === userId && !r.readAt).length;
  }
  async markRead(id: string, userId: string, now: Date) {
    const r = this.rows.find((x) => x.id === id && x.userId === userId);
    if (!r) return false;
    if (!r.readAt) r.readAt = now;
    return true;
  }
  async markAllRead(userId: string, now: Date) {
    let n = 0;
    for (const r of this.rows) {
      if (r.userId === userId && !r.readAt) {
        r.readAt = now;
        n += 1;
      }
    }
    return n;
  }
}

export class RecordingEmailSender implements EmailSender {
  sent: EmailMessage[] = [];
  failWith: Error | null = null;
  async send(m: EmailMessage) {
    if (this.failWith) throw this.failWith;
    this.sent.push(m);
  }
}

export class StaticUserDirectory implements UserDirectory {
  constructor(private readonly users: DirectoryUser[]) {}
  async findById(id: string) {
    return this.users.find((u) => u.id === id);
  }
}
