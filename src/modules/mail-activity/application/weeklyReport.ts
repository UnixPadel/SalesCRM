import { RuleError, err, ok, type Clock, type Result } from "../../shared/kernel";
import {
  isInternalAddress,
  parseWeek,
  shiftWeek,
  weekRangeOf,
  type LeadMatch,
  type LeadMatcher,
  type MailActivityStore,
  type ScanState,
  type WeekRange,
} from "../domain";

/**
 * Haftalık mail gönderim raporu (Yönetim > Mail Gönderimleri): hesap başına gönderilen ileti, son gönderim, tekil
 * alıcı ve alıcı listesi. Alıcı CRM'de bir lead'in e-postasıysa lead'e bağlanır; şirket içi adresler ayrı etiketlenir.
 * Görme izni kişi bazındadır (server/roles.mjs CRM_MAIL_STATS_VIEWERS); karar API katmanında verilir.
 */
export interface RecipientWeek {
  address: string;
  messages: number;
  lastSentAt: Date;
  internal: boolean;
  lead: LeadMatch | null;
}

export interface MailboxScanStatus {
  mailbox: string;
  configured: boolean;
  folder: string | null;
  lastUid: number;
  lastOkAt: Date | null;
  lastError: string | null;
  lastErrorAt: Date | null;
}

export interface MailboxWeek {
  mailbox: string;
  sent: number;
  lastSentInWeek: Date | null;
  lastSentEver: Date | null;
  uniqueRecipients: number;
  recipients: RecipientWeek[];
  scan: MailboxScanStatus;
}

export interface MailWeekReport {
  week: WeekRange;
  prev: string;
  /** Gelecek hafta henüz başlamadıysa null. */
  next: string | null;
  mailboxes: MailboxWeek[];
}

export interface MailActivityQueryDeps {
  store: MailActivityStore;
  matcher: LeadMatcher;
  mailboxes: readonly string[];
  configured(mailbox: string): boolean;
  clock: Clock;
  /** Şirket alan adı (ör. unixpadel.com); bu alandaki alıcılar "iç". */
  internalDomain: string;
}

export class MailActivityQueries {
  constructor(private readonly deps: MailActivityQueryDeps) {}

  /** Varsayılan: geçen (tamamlanmış) hafta. */
  defaultWeek(): string {
    return shiftWeek(weekRangeOf(this.deps.clock.now()), -1).key;
  }

  async status(): Promise<MailboxScanStatus[]> {
    const states = new Map((await this.deps.store.states()).map((s) => [s.mailbox, s]));
    return this.deps.mailboxes.map((m) => this.scanStatus(m, states.get(m)));
  }

  async weekly(key?: string): Promise<Result<MailWeekReport, RuleError>> {
    const week = parseWeek(key?.trim() || this.defaultWeek());
    if (!week) return err(new RuleError("mail_stats.week_invalid", "Geçersiz hafta.", { week: key }));
    const { store, mailboxes } = this.deps;
    const [rows, recipients, states] = await Promise.all([
      store.mailboxWeek(mailboxes, week.start, week.end),
      store.recipientsWeek(mailboxes, week.start, week.end),
      store.states(),
    ]);
    const matches = await this.deps.matcher.match([...new Set(recipients.map((r) => r.address))]);
    const stateOf = new Map(states.map((s) => [s.mailbox, s]));
    const rowOf = new Map(rows.map((r) => [r.mailbox, r]));
    const next = shiftWeek(week, 1);
    return ok({
      week,
      prev: shiftWeek(week, -1).key,
      next: next.start.getTime() <= this.deps.clock.now().getTime() ? next.key : null,
      mailboxes: mailboxes.map((mailbox) => {
        const row = rowOf.get(mailbox);
        return {
          mailbox,
          sent: row?.sent ?? 0,
          lastSentInWeek: row?.lastSentInWeek ?? null,
          lastSentEver: row?.lastSentEver ?? null,
          uniqueRecipients: row?.uniqueRecipients ?? 0,
          recipients: recipients
            .filter((r) => r.mailbox === mailbox)
            .map((r) => ({
              address: r.address,
              messages: r.messages,
              lastSentAt: r.lastSentAt,
              internal: isInternalAddress(r.address, this.deps.internalDomain),
              lead: matches.get(r.address) ?? null,
            }))
            .sort(
              (a, b) =>
                b.messages - a.messages ||
                b.lastSentAt.getTime() - a.lastSentAt.getTime() ||
                a.address.localeCompare(b.address),
            ),
          scan: this.scanStatus(mailbox, stateOf.get(mailbox)),
        };
      }),
    });
  }

  private scanStatus(mailbox: string, s: ScanState | undefined): MailboxScanStatus {
    return {
      mailbox,
      configured: this.deps.configured(mailbox),
      folder: s?.folder ?? null,
      lastUid: s?.lastUid ?? 0,
      lastOkAt: s?.lastOkAt ?? null,
      lastError: s?.lastError ?? null,
      lastErrorAt: s?.lastErrorAt ?? null,
    };
  }
}
