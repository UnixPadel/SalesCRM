/** Bellek içi sahte depo, sahte Gönderilmiş klasörü kaynağı ve lead eşleyici (testler). */
import type {
  LeadMatch,
  LeadMatcher,
  MailActivityStore,
  MailboxWeekRow,
  RecipientWeekRow,
  ScanState,
  SentFolder,
  SentMessage,
  SentSource,
  StoredMessage,
} from "../domain";

export class InMemoryMailActivityStore implements MailActivityStore {
  readonly messages: (StoredMessage & { mailbox: string })[] = [];
  readonly scan = new Map<string, ScanState>();
  failMarkError = false;

  async state(mailbox: string) {
    return this.scan.get(mailbox) ?? null;
  }
  async states() {
    return [...this.scan.values()];
  }
  async addMessages(mailbox: string, messages: readonly StoredMessage[]) {
    let added = 0;
    for (const m of messages) {
      if (this.messages.some((x) => x.mailbox === mailbox && x.key === m.key)) continue;
      this.messages.push({ ...m, mailbox });
      added++;
    }
    return added;
  }
  private blank(mailbox: string): ScanState {
    return {
      mailbox,
      folder: null,
      uidValidity: null,
      lastUid: 0,
      lastOkAt: null,
      lastError: null,
      lastErrorAt: null,
    };
  }
  async markOk(mailbox: string, c: { folder: string; uidValidity: string; lastUid: number }, at: Date) {
    this.scan.set(mailbox, { ...this.blank(mailbox), ...c, lastOkAt: at });
  }
  async markError(mailbox: string, error: string, at: Date) {
    if (this.failMarkError) throw new Error("db down");
    this.scan.set(mailbox, { ...(this.scan.get(mailbox) ?? this.blank(mailbox)), lastError: error, lastErrorAt: at });
  }
  private inWeek(mailboxes: readonly string[], start: Date, end: Date) {
    return this.messages.filter((m) => mailboxes.includes(m.mailbox) && m.sentAt >= start && m.sentAt < end);
  }
  async mailboxWeek(mailboxes: readonly string[], start: Date, end: Date): Promise<MailboxWeekRow[]> {
    const week = this.inWeek(mailboxes, start, end);
    const max = (list: readonly StoredMessage[]) =>
      list.length ? new Date(Math.max(...list.map((m) => m.sentAt.getTime()))) : null;
    return mailboxes
      .filter((mb) => this.messages.some((m) => m.mailbox === mb))
      .map((mailbox) => {
        const mine = week.filter((m) => m.mailbox === mailbox);
        return {
          mailbox,
          sent: mine.length,
          lastSentInWeek: max(mine),
          lastSentEver: max(this.messages.filter((m) => m.mailbox === mailbox)),
          uniqueRecipients: new Set(mine.flatMap((m) => m.recipients.map((r) => r.address))).size,
        };
      });
  }
  async recipientsWeek(mailboxes: readonly string[], start: Date, end: Date): Promise<RecipientWeekRow[]> {
    const rows = new Map<string, RecipientWeekRow>();
    for (const m of this.inWeek(mailboxes, start, end)) {
      for (const r of m.recipients) {
        const k = `${m.mailbox}|${r.address}`;
        const row = rows.get(k) ?? { mailbox: m.mailbox, address: r.address, messages: 0, lastSentAt: m.sentAt };
        row.messages++;
        if (m.sentAt > row.lastSentAt) row.lastSentAt = m.sentAt;
        rows.set(k, row);
      }
    }
    return [...rows.values()];
  }
}

export interface FakeFolder {
  path: string;
  uidValidity: string;
  messages: SentMessage[];
}

/** Hesap → klasör; `failing` içindeki hesap bağlanırken hata verir. IMAP'teki `n:*` davranışı taklit edilir. */
export class FakeSentSource implements SentSource {
  readonly folders = new Map<string, FakeFolder>();
  readonly failing = new Map<string, string>();
  readonly unconfigured = new Set<string>();
  readonly calls: string[] = [];

  configured(mailbox: string) {
    return !this.unconfigured.has(mailbox);
  }
  async open<T>(mailbox: string, fn: (f: SentFolder) => Promise<T>): Promise<T> {
    const fail = this.failing.get(mailbox);
    if (fail) throw new Error(fail);
    const f = this.folders.get(mailbox);
    if (!f) throw new Error("no_sent_folder");
    return fn({
      path: f.path,
      uidValidity: f.uidValidity,
      fromUid: async (uid) => {
        this.calls.push(`${mailbox} fromUid ${uid}`);
        const hits = f.messages.filter((m) => m.uid >= uid);
        // IMAP: `n:*` n en büyük UID'den büyükse son iletiyi döndürür.
        return hits.length ? hits : f.messages.slice(-1);
      },
      since: async (at) => {
        this.calls.push(`${mailbox} since ${at.toISOString().slice(0, 10)}`);
        return f.messages.filter((m) => !m.sentAt || m.sentAt >= at);
      },
    });
  }
}

export class FakeLeadMatcher implements LeadMatcher {
  constructor(readonly known: Record<string, LeadMatch> = {}) {}
  async match(addresses: readonly string[]) {
    return new Map(addresses.filter((a) => this.known[a]).map((a) => [a, this.known[a]!]));
  }
}

let nextUid = 1;
export function sent(
  partial: Partial<SentMessage> & { to?: readonly string[] },
  at: string | null = "2026-11-24T09:00:00Z",
): SentMessage {
  const uid = partial.uid ?? nextUid++;
  return {
    uid,
    messageId: partial.messageId === undefined ? `<m${uid}@unixpadel.com>` : partial.messageId,
    sentAt: partial.sentAt ?? (at ? new Date(at) : null),
    to: partial.to ?? ["musteri@example.com"],
    cc: partial.cc ?? [],
    bcc: partial.bcc ?? [],
  };
}
