/** Mail gönderim raporu API sözleşmesi (`/api/mail-activity`). Tarihler ISO metni. */

export interface MailScanStatusDto {
  mailbox: string;
  /** Şifre ya da master kullanıcı tanımlı mı. */
  configured: boolean;
  folder: string | null;
  lastOkAt: string | null;
  /** Kod (`auth_failed`, `unreachable`, `no_sent_folder`) ya da sunucunun hata metni. */
  lastError: string | null;
  lastErrorAt: string | null;
}

export interface MailRecipientDto {
  address: string;
  messages: number;
  lastSentAt: string;
  /** Şirket içi adres. */
  internal: boolean;
  leadId: string | null;
  leadName: string | null;
}

export interface MailboxWeekDto {
  mailbox: string;
  sent: number;
  lastSentInWeek: string | null;
  lastSentEver: string | null;
  uniqueRecipients: number;
  recipients: MailRecipientDto[];
  scan: MailScanStatusDto;
}

export interface MailWeekReportDto {
  /** "2026-W48" */
  week: string;
  start: string;
  /** Hariç: sonraki Pazartesi 00:00 (İstanbul). */
  end: string;
  prev: string;
  next: string | null;
  mailboxes: MailboxWeekDto[];
}

export interface MailActivityStatusDto {
  /** Tarama açık mı (MAIL_STATS_ENABLED ve en az bir hesabın giriş bilgisi). */
  enabled: boolean;
  running: boolean;
  minutes: number;
  lastRunAt: string | null;
  mailboxes: MailScanStatusDto[];
}
