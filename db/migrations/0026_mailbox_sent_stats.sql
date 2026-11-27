-- Mail gönderim raporu (2026-11-27): satis@, export3@, export2@, yusa@ hesaplarının IMAP "Gönderilmiş" klasörü saatte
-- bir salt-okunur taranır; her gönderilen mailin tarihi ve alıcıları (To/Cc/Bcc) burada tutulur. Yönetim > Mail
-- Gönderimleri haftalık sayımı buradan hesaplar: mail sonradan Sent'ten silinse de sayım bozulmaz.
-- Konu ve gövde saklanmaz. message_key = Message-ID; yoksa "uid:<uidvalidity>:<uid>". Aynı mailin ikinci kopyası
-- (ör. hem MailService hem Outlook Sent'e kaydetmişse) tekil sayılır.
-- Geri alma: DROP TABLE mailbox_sent_recipients, mailbox_sent_messages, mailbox_scan_state;
CREATE TABLE mailbox_sent_messages (
  id               bigserial PRIMARY KEY,
  mailbox          text NOT NULL,
  message_key      text NOT NULL,
  sent_at          timestamptz NOT NULL,
  uid              bigint NOT NULL,
  recipient_count  integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mailbox_sent_messages_uq UNIQUE (mailbox, message_key)
);
CREATE INDEX mailbox_sent_messages_time_idx ON mailbox_sent_messages (mailbox, sent_at DESC);

CREATE TABLE mailbox_sent_recipients (
  message_id          bigint NOT NULL REFERENCES mailbox_sent_messages(id) ON DELETE CASCADE,
  address_normalized  text NOT NULL,
  kind                text NOT NULL CHECK (kind IN ('to', 'cc', 'bcc')),
  PRIMARY KEY (message_id, address_normalized)
);
CREATE INDEX mailbox_sent_recipients_addr_idx ON mailbox_sent_recipients (address_normalized);

-- Hesap başına tarama imleci: klasör, UIDVALIDITY ve en son okunan UID. UIDVALIDITY değişirse klasör baştan okunur.
CREATE TABLE mailbox_scan_state (
  mailbox      text PRIMARY KEY,
  folder       text,
  uidvalidity  text,
  last_uid     bigint NOT NULL DEFAULT 0,
  last_ok_at   timestamptz,
  last_error   text,
  last_error_at timestamptz
);
