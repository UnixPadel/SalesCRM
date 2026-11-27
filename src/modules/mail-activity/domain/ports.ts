/** mail-activity portları: posta kutusunun Gönderilmiş klasörü (IMAP), kalıcı depo (Postgres), CRM eşleşmesi. */

export type RecipientKind = "to" | "cc" | "bcc";

/** Gönderilmiş klasöründeki bir ileti: yalnız başlık bilgisi (konu ve gövde okunmaz). */
export interface SentMessage {
  uid: number;
  messageId: string | null;
  /** Date başlığı; yoksa klasöre düştüğü an; o da yoksa null. */
  sentAt: Date | null;
  to: readonly string[];
  cc: readonly string[];
  bcc: readonly string[];
}

/** Salt-okunur açılmış Gönderilmiş klasörü. */
export interface SentFolder {
  path: string;
  uidValidity: string;
  /** UID'i `uid` ve üstü olan iletiler (IMAP `uid:*`; sunucu en son iletiyi de döndürebilir, çağıran süzer). */
  fromUid(uid: number): Promise<SentMessage[]>;
  /** Bu günden (dahil) sonraki iletiler (IMAP SEARCH SINCE). */
  since(at: Date): Promise<SentMessage[]>;
}

export interface SentSource {
  /** Bu hesap için giriş bilgisi tanımlı mı (şifre ya da master kullanıcı). */
  configured(mailbox: string): boolean;
  /** Bağlanır, Gönderilmiş klasörünü salt-okunur açar, `fn` bitince bağlantıyı kapatır. */
  open<T>(mailbox: string, fn: (folder: SentFolder) => Promise<T>): Promise<T>;
}

export interface ScanState {
  mailbox: string;
  folder: string | null;
  uidValidity: string | null;
  lastUid: number;
  lastOkAt: Date | null;
  lastError: string | null;
  lastErrorAt: Date | null;
}

export interface StoredRecipient {
  address: string;
  kind: RecipientKind;
}

export interface StoredMessage {
  /** Message-ID; yoksa "uid:<uidvalidity>:<uid>". */
  key: string;
  sentAt: Date;
  uid: number;
  recipients: readonly StoredRecipient[];
}

export interface MailboxWeekRow {
  mailbox: string;
  sent: number;
  lastSentInWeek: Date | null;
  lastSentEver: Date | null;
  uniqueRecipients: number;
}

export interface RecipientWeekRow {
  mailbox: string;
  address: string;
  messages: number;
  lastSentAt: Date;
}

export interface MailActivityStore {
  state(mailbox: string): Promise<ScanState | null>;
  states(): Promise<ScanState[]>;
  /** Yeni iletileri yazar; aynı (hesap, anahtar) ikinci kez yazılmaz. Yazılan ileti sayısını döner. */
  addMessages(mailbox: string, messages: readonly StoredMessage[]): Promise<number>;
  markOk(mailbox: string, cursor: { folder: string; uidValidity: string; lastUid: number }, at: Date): Promise<void>;
  markError(mailbox: string, error: string, at: Date): Promise<void>;
  /** Hesap başına hafta özeti; hiç ileti olmayan hesap satır döndürmeyebilir. */
  mailboxWeek(mailboxes: readonly string[], start: Date, end: Date): Promise<MailboxWeekRow[]>;
  /** Hesap × alıcı: o hafta kaç ileti, son ne zaman. */
  recipientsWeek(mailboxes: readonly string[], start: Date, end: Date): Promise<RecipientWeekRow[]>;
}

export interface LeadMatch {
  leadId: string;
  name: string;
}

/** Alıcı adresi → CRM'deki lead (kişinin e-postası ya da lead'in e-postası). */
export interface LeadMatcher {
  match(addresses: readonly string[]): Promise<Map<string, LeadMatch>>;
}
