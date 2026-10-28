/**
 * Bildirimler: domain olaylarına abone olur, aşama motorunu çağırmaz (Genel plan). Faz 2 kapsamı:
 * `LeadCreated` olayında atanan satışçıya uygulama içi bildirim ve e-posta. Bildirim ve e-posta
 * hatası lead akışını bozmaz; loglanır (olaylar transaction sonrası yayınlanır).
 */
import type { Clock, IdGenerator, Logger } from "../../shared/kernel";
import type { DomainEvent, DomainEventPublisher, Lead, UnitOfWork } from "../domain";
import type { Actor } from "./types";

export type NotificationType = "lead_assigned";

export interface Notification {
  id: string;
  userId: string;
  type: NotificationType;
  leadId: string | null;
  /** Düz metin başlık (e-posta ve yedek görünüm için, TR). Arayüz `type` + `body` ile kendi dilinde yazar. */
  title: string;
  /** JSON: { leadName, company, country, source } */
  body: string;
  createdAt: Date;
  readAt: Date | null;
}

export interface NotificationStore {
  insert(n: Notification): Promise<void>;
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

export interface LeadNotifierDeps {
  uow: UnitOfWork;
  notifications: NotificationStore;
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
  constructor(private readonly deps: LeadNotifierDeps) {}

  async publish(events: readonly DomainEvent[]): Promise<void> {
    for (const e of events) {
      if (e.type === "LeadCreated" && e.assignedUserId && e.assignedUserId !== e.actorUserId) {
        await this.notifyAssigned(e.leadId, e.assignedUserId).catch((err: unknown) =>
          this.deps.logger.error("bildirim yazılamadı", { leadId: e.leadId, userId: e.assignedUserId, error: err }),
        );
      }
    }
  }

  private async notifyAssigned(leadId: string, userId: string): Promise<void> {
    const { uow, notifications, clock, ids, logger } = this.deps;
    const lead = await uow.run((repos) => repos.leads.findById(leadId));
    if (!lead) return;
    const now = clock.now();
    const n: Notification = {
      id: ids.next(),
      userId,
      type: "lead_assigned",
      leadId: lead.id,
      title: `Yeni lead: ${lead.fullName}`,
      body: JSON.stringify(bodyOf(lead)),
      createdAt: now,
      readAt: null,
    };
    await notifications.insert(n);
    logger.info("bildirim yazıldı", { leadId: lead.id, userId, type: n.type });
    await this.sendEmail(lead, userId);
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
      await email.send({ to: user.email, subject: `Yeni lead: ${lead.fullName}`, text: lines.join("\n") });
      logger.info("e-posta bildirimi gönderildi", { leadId: lead.id, userId });
    } catch (err: unknown) {
      logger.warn("e-posta bildirimi gönderilemedi", { leadId: lead.id, userId, error: err });
    }
  }
}

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
    this.rows.push({ ...n });
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
