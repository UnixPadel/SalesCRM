-- Faz 2: gelen lead akışı (inbox), alan eşlemeleri, entegrasyon ayarları, uygulama içi bildirimler.
-- Tablolar: inbound_webhook_events, form_field_mappings, integration_settings, user_notifications.

-- Inbox (Genel plan): webhook ham gövdeyi kaydeder ve hemen 200 döner; işleme arka planda.
-- payload_ciphertext AES-256-GCM zarfıdır (anahtar INBOX_ENCRYPTION_KEY); 30 günden eski payload silinir,
-- satırın kendisi (durum, hata, lead bağı) kalır.
CREATE TABLE inbound_webhook_events (
  id                 uuid PRIMARY KEY,
  provider           text NOT NULL,                       -- 'meta' | 'google' | ileride 'web'
  kind               text NOT NULL CHECK (kind IN ('webhook','backfill')),
  dedupe_key         text NOT NULL UNIQUE,                -- provider + platform lead kimliği: aynı bildirim iki kez → tek satır
  payload_ciphertext text,                                -- NULL = temizlik işi sildi
  payload_purged_at  timestamptz,
  received_at        timestamptz NOT NULL,
  status             text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','done','failed')),
  attempts           integer NOT NULL DEFAULT 0,
  next_attempt_at    timestamptz NOT NULL,
  last_error_code    text,
  last_error         text,
  lead_id            uuid REFERENCES leads(id) ON DELETE SET NULL,
  processed_at       timestamptz
);
CREATE INDEX inbound_due_idx      ON inbound_webhook_events (status, next_attempt_at);
CREATE INDEX inbound_received_idx ON inbound_webhook_events (received_at);

-- Platform form alanı → lead alanı. form_id NULL: sağlayıcının tüm formları için varsayılan;
-- form_id dolu satır aynı platform_field için varsayılanı ezer. Hedefler:
--   full_name, first_name, last_name, email, phone, country, city, company, product_interest, notes,
--   extra (ek yanıt olarak sakla), ignore (at).
CREATE TABLE form_field_mappings (
  id             uuid PRIMARY KEY,
  provider       text NOT NULL,
  form_id        text,
  platform_field text NOT NULL,
  target_field   text NOT NULL CHECK (target_field IN (
    'full_name','first_name','last_name','email','phone','country','city','company','product_interest','notes','extra','ignore')),
  is_active      boolean NOT NULL DEFAULT true,
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX form_field_mappings_uq ON form_field_mappings (provider, coalesce(form_id, ''), platform_field);

-- Secret olmayan entegrasyon ayarları (sayfa kimliği, aktif form listesi, son senkron zamanı…).
-- Secret'lar burada tutulmaz; yalnız ortam değişkeni adı yazılabilir (ADR-0004).
CREATE TABLE integration_settings (
  provider   text NOT NULL,
  key        text NOT NULL,
  value      text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, key)
);

-- Uygulama içi bildirim: atanan satışçıya "yeni lead" vb. Kişisel veri taşımaz; lead_id ile bağlanır.
CREATE TABLE user_notifications (
  id         uuid PRIMARY KEY,
  user_id    text NOT NULL,
  type       text NOT NULL,                               -- 'lead_assigned' …
  lead_id    uuid REFERENCES leads(id) ON DELETE CASCADE,
  title      text NOT NULL,
  body       text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL,
  read_at    timestamptz
);
CREATE INDEX user_notifications_user_idx ON user_notifications (user_id, read_at, created_at DESC);
