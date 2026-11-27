// mail-activity/infrastructure: Postgres deposu ve IMAP Gönderilmiş klasörü kaynağı.
export { pgMailActivityStore } from "./pgMailActivityStore";
export {
  createImapSentSource,
  imapErrorCode,
  pickSentFolder,
  toSentMessage,
  type ImapCredentials,
  type ImapSentSourceOptions,
} from "./imapSentSource";
