-- Faz 1: çekirdek satış pipeline'ı (Genel plan, Veri modeli; ADR-0002, ADR-0006 seçenek 3).
-- Tablolar: stage_definitions, lost_reasons, territory_rules, persons, leads, lead_attribution,
-- lead_consents, lead_stage_events, outbound_conversion_events, platform_stage_mappings.

-- Aşama sözlüğü: kod sabit, görünen ad değişebilir.
CREATE TABLE stage_definitions (
  code             text PRIMARY KEY,
  name_tr          text NOT NULL,
  name_en          text NOT NULL,
  sort_order       integer NOT NULL UNIQUE,
  is_terminal      boolean NOT NULL DEFAULT false,
  requires_value   boolean NOT NULL DEFAULT false,
  requires_reason  boolean NOT NULL DEFAULT false
);

-- Kayıp nedenleri: serbest metin yerine sabit liste.
CREATE TABLE lost_reasons (
  code        text PRIMARY KEY,
  name_tr     text NOT NULL,
  name_en     text NOT NULL,
  sort_order  integer NOT NULL,
  is_active   boolean NOT NULL DEFAULT true
);

-- Ülke → sorumlu ve yedek satışçı. Kullanıcı kimliği şirket kullanıcı tablosundan (KullaniciID), metin.
CREATE TABLE territory_rules (
  country_code      char(2) PRIMARY KEY,
  assigned_user_id  text NOT NULL,
  fallback_user_id  text,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Kişi: aynı kişi yeniden form doldurursa yeni lead aynı kişiye bağlanır (mükerrer kontrolü).
CREATE TABLE persons (
  id                uuid PRIMARY KEY,
  full_name         text NOT NULL DEFAULT '',
  email_normalized  text,
  phone_e164        text,
  country           char(2),
  company           text NOT NULL DEFAULT '',
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX persons_email_uq ON persons (email_normalized) WHERE email_normalized IS NOT NULL;
CREATE UNIQUE INDEX persons_phone_uq ON persons (phone_e164) WHERE phone_e164 IS NOT NULL;

-- Lead: tek kayıt; reklam ayrıntısı ayrı tablolarda.
CREATE TABLE leads (
  id                uuid PRIMARY KEY,
  source            text NOT NULL CHECK (source IN ('meta_form','google_form','web_form','manual','import')),
  platform_lead_id  text,
  form_id           text,
  person_id         uuid NOT NULL REFERENCES persons(id),
  full_name         text NOT NULL DEFAULT '',
  email             text,
  phone_e164        text,
  country           char(2),
  city              text NOT NULL DEFAULT '',
  company           text NOT NULL DEFAULT '',
  product_interest  text NOT NULL DEFAULT '',
  campaign_id       text, campaign_name text,
  adset_id          text, adset_name    text,
  ad_id             text, ad_name       text,
  assigned_user_id  text,                      -- NULL = ortak havuz
  current_stage     text NOT NULL REFERENCES stage_definitions(code),
  is_test           boolean NOT NULL DEFAULT false,
  notes             text NOT NULL DEFAULT '',
  extra_answers     jsonb NOT NULL DEFAULT '{}'::jsonb,   -- eşlenmemiş form yanıtları ("ek yanıt")
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT leads_platform_uq UNIQUE (source, platform_lead_id)
);
CREATE INDEX leads_stage_idx    ON leads (current_stage);
CREATE INDEX leads_assigned_idx ON leads (assigned_user_id);
CREATE INDEX leads_person_idx   ON leads (person_id);
CREATE INDEX leads_created_idx  ON leads (created_at DESC);

-- Tıklama kimlikleri ve UTM (1:1).
CREATE TABLE lead_attribution (
  lead_id      uuid PRIMARY KEY REFERENCES leads(id) ON DELETE CASCADE,
  gclid        text, gbraid text, wbraid text,
  fbclid       text, fbc    text, fbp    text,
  utm_source   text, utm_medium text, utm_campaign text, utm_term text, utm_content text,
  landing_url  text,
  click_at     timestamptz
);

-- KVKK / iletişim onayları; aydınlatma metni sürümüyle birlikte.
CREATE TABLE lead_consents (
  id            uuid PRIMARY KEY,
  lead_id       uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  consent_type  text NOT NULL,
  granted       boolean NOT NULL,
  text_version  text NOT NULL DEFAULT '',
  granted_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lead_consents_lead_idx ON lead_consents (lead_id);

-- Aşama geçmişi: yalnız ekleme. Tek istisna: 10 dakikalık "geri al" undone_at alanını doldurur;
-- başka hiçbir sütun değişmez, satır silinmez (trigger korur). change_id bir "sonraki aşama"
-- tıkının ürettiği tüm satırları (auto_fill dahil) gruplar; geri al bu grubu hedefler.
CREATE TABLE lead_stage_events (
  id                     uuid PRIMARY KEY,
  lead_id                uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  change_id              uuid NOT NULL,
  stage_code             text NOT NULL REFERENCES stage_definitions(code),
  occurred_at            timestamptz NOT NULL,
  sequence               integer NOT NULL,
  actor_user_id          text,
  origin                 text NOT NULL CHECK (origin IN ('manual','auto_fill','system')),
  value_amount           numeric(14,2),
  currency               char(3),
  lost_reason_code       text REFERENCES lost_reasons(code),
  qualification_answers  jsonb,
  undone_at              timestamptz,
  undone_by_user_id      text,
  CONSTRAINT lead_stage_events_seq_uq UNIQUE (lead_id, sequence),
  CONSTRAINT lead_stage_events_value_pair CHECK ((value_amount IS NULL) = (currency IS NULL))
);
CREATE INDEX lead_stage_events_lead_idx   ON lead_stage_events (lead_id, sequence);
CREATE INDEX lead_stage_events_change_idx ON lead_stage_events (change_id);

CREATE FUNCTION lead_stage_events_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'lead_stage_events yalnız eklemeli: satır silinemez';
  END IF;
  IF OLD.undone_at IS NOT NULL THEN
    RAISE EXCEPTION 'lead_stage_events: geri alınmış satır değiştirilemez';
  END IF;
  IF (to_jsonb(NEW) - 'undone_at' - 'undone_by_user_id') <> (to_jsonb(OLD) - 'undone_at' - 'undone_by_user_id') THEN
    RAISE EXCEPTION 'lead_stage_events yalnız eklemeli: yalnız undone_at / undone_by_user_id değişebilir';
  END IF;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER lead_stage_events_append_only
  BEFORE UPDATE OR DELETE ON lead_stage_events
  FOR EACH ROW EXECUTE FUNCTION lead_stage_events_guard();

-- Outbox: aşama olayı + platform başına tek satır; aşamayla aynı transaction'da yazılır.
CREATE TABLE outbound_conversion_events (
  id                  uuid PRIMARY KEY,
  stage_event_id      uuid NOT NULL REFERENCES lead_stage_events(id),
  provider            text NOT NULL,
  status              text NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','sent','failed','dead','skipped')),
  skip_reason         text,
  attempts            integer NOT NULL DEFAULT 0,
  next_attempt_at     timestamptz NOT NULL,
  last_response_code  integer,
  last_error          text,
  sent_at             timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT outbound_conversion_events_uq UNIQUE (stage_event_id, provider)
);
CREATE INDEX outbound_pending_idx ON outbound_conversion_events (next_attempt_at) WHERE status = 'pending';

-- Aşama → platform olayı eşlemesi (admin ekranı Faz 6; bu fazda hepsi kapalı).
CREATE TABLE platform_stage_mappings (
  id                      uuid PRIMARY KEY,
  stage_code              text NOT NULL REFERENCES stage_definitions(code),
  provider                text NOT NULL,
  platform_event_name     text NOT NULL,
  enabled                 boolean NOT NULL DEFAULT false,
  is_optimization_target  boolean NOT NULL DEFAULT false,
  CONSTRAINT platform_stage_mappings_uq UNIQUE (stage_code, provider)
);
