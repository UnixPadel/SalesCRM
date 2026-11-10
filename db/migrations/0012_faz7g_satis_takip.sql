-- Faz 7g: Satış takip (Excel) uyumu (ADR-0014, docs/satis-takip-is-emri.md).
-- Temas = tamamlanmış aktivite; kanal = aktivite türü. Türetilen her şey (H–M, O, Y, Z/AA/AB, uyarılar)
-- sorguda hesaplanır, sütun yok. Bölüm 6'daki veri düzeltmeleri geri alınamaz.

-- 1) Aktivite türleri: whatsapp ve other (kısıt adı canlı kopyada doğrulandı).
ALTER TABLE activities DROP CONSTRAINT activities_type_check;
ALTER TABLE activities ADD CONSTRAINT activities_type_check
  CHECK (type IN ('call','email','whatsapp','meeting','proposal_sent','site_visit','other'));

-- 2) Temas kaydı: tek "Temas kaydet" işleminin geri alma bilgisi.
CREATE TABLE contact_logs (
  id                    uuid PRIMARY KEY,
  lead_id               uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  actor_user_id         text NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),   -- geri alma penceresi buradan sayılır
  completed_activity_id uuid REFERENCES activities(id) ON DELETE SET NULL,
  prev_type             text,          -- tamamlanan planın önceki türü ve konusu (geri almada geri yazılır)
  prev_subject          text,
  status_changed        boolean NOT NULL DEFAULT false,
  status_before         text,
  status_after          text,
  stage_change_id       uuid,          -- aynı işlemde ChangeLeadStage'in change_id'si
  assigned_on_log       boolean NOT NULL DEFAULT false
);
CREATE INDEX contact_logs_lead_idx ON contact_logs (lead_id, created_at DESC);
-- Aktivite silinirken (ON DELETE SET NULL) bağlı kaydı bulmak için; iş emri "Uygulama notları" S1.
CREATE INDEX contact_logs_completed_idx ON contact_logs (completed_activity_id) WHERE completed_activity_id IS NOT NULL;

-- 3) Aktivite: temas sonucu, cevap işareti, not, yapan, tahmini tarih, kayıt bağları.
ALTER TABLE activities
  ADD COLUMN outcome          text,
  ADD COLUMN customer_replied boolean NOT NULL DEFAULT false,
  ADD COLUMN result_note      text NOT NULL DEFAULT '',
  ADD COLUMN done_by_user_id  text,
  ADD COLUMN date_estimated   boolean NOT NULL DEFAULT false,
  ADD COLUMN log_id           uuid REFERENCES contact_logs(id) ON DELETE SET NULL,  -- satırı açan ya da tamamlayan kayıt
  ADD COLUMN next_of_log_id   uuid REFERENCES contact_logs(id) ON DELETE SET NULL;  -- bu satır o kaydın "sonraki takip"i
-- Cevap işareti yalnız Takip edilecek / Teklif gönderildi sonucunda; sonuçsuz satırda da reddedilir
-- (yalın `outcome IN (…)` NULL'da bilinmeyen döner ve CHECK'i geçirirdi; iş emri "Uygulama notları" S1).
ALTER TABLE activities
  ADD CONSTRAINT activities_outcome_check CHECK (outcome IS NULL OR outcome IN
      ('reply_received','awaiting_reply','proposal_sent','follow_up','negative','agreed')),
  ADD CONSTRAINT activities_outcome_done   CHECK (outcome IS NULL OR done_at IS NOT NULL),
  ADD CONSTRAINT activities_estimated_done CHECK (NOT date_estimated OR done_at IS NOT NULL),
  ADD CONSTRAINT activities_replied_check  CHECK (NOT customer_replied OR
      (outcome IS NOT NULL AND outcome IN ('follow_up','proposal_sent')));
CREATE INDEX activities_done_idx        ON activities (lead_id, done_at)    WHERE done_at IS NOT NULL;
CREATE INDEX activities_history_idx     ON activities (done_at DESC, id DESC) WHERE done_at IS NOT NULL;
CREATE INDEX activities_log_idx         ON activities (log_id)         WHERE log_id IS NOT NULL;
CREATE INDEX activities_next_of_log_idx ON activities (next_of_log_id) WHERE next_of_log_id IS NOT NULL;

-- 4) Lead: müşteri durumu (D1), ürünler (D4), form cevapları (D5), reklam yüzeyi, kontrol edilen uyarılar (D6),
--    temas geçmişi bilinmeyen eski kayıt işareti.
ALTER TABLE leads
  ADD COLUMN customer_status         text,
  ADD COLUMN qty_standard            smallint,
  ADD COLUMN qty_panoramic           smallint,
  ADD COLUMN qty_full_panoramic      smallint,
  ADD COLUMN roof_wanted             boolean NOT NULL DEFAULT false,
  ADD COLUMN roof_width_m            numeric(5,2),
  ADD COLUMN roof_length_m           numeric(5,2),
  ADD COLUMN install_site            text,
  ADD COLUMN install_timeline        text,
  ADD COLUMN customer_profile        text,
  ADD COLUMN court_count_band        text,
  ADD COLUMN ad_surface              text,
  ADD COLUMN checked_warnings        text[] NOT NULL DEFAULT '{}',
  ADD COLUMN contact_history_unknown boolean NOT NULL DEFAULT false;
ALTER TABLE leads
  ADD CONSTRAINT leads_customer_status_check CHECK (customer_status IS NULL OR customer_status IN
      ('interested','not_interested','project_phase','collecting_prices','buyer_ready')),
  ADD CONSTRAINT leads_qty_standard_check       CHECK (qty_standard       IS NULL OR qty_standard       BETWEEN 1 AND 29),
  ADD CONSTRAINT leads_qty_panoramic_check      CHECK (qty_panoramic      IS NULL OR qty_panoramic      BETWEEN 1 AND 29),
  ADD CONSTRAINT leads_qty_full_panoramic_check CHECK (qty_full_panoramic IS NULL OR qty_full_panoramic BETWEEN 1 AND 29),
  ADD CONSTRAINT leads_roof_width_check  CHECK (roof_width_m  IS NULL OR roof_width_m  > 0),
  ADD CONSTRAINT leads_roof_length_check CHECK (roof_length_m IS NULL OR roof_length_m > 0),
  ADD CONSTRAINT leads_roof_dims_need_roof CHECK (roof_wanted OR (roof_width_m IS NULL AND roof_length_m IS NULL)),
  ADD CONSTRAINT leads_install_site_check CHECK (install_site IS NULL OR install_site IN
      ('covered_court','no_site_yet','indoor_hall','beach_windy','rooftop','existing_ground','other')),
  ADD CONSTRAINT leads_install_timeline_check CHECK (install_timeline IS NULL OR install_timeline IN
      ('m0_3','m3_6','m6_12','researching')),
  ADD CONSTRAINT leads_customer_profile_check CHECK (customer_profile IS NULL OR customer_profile IN
      ('investor','club_operator','private_home','public_facility','hospitality_residential','distributor')),
  ADD CONSTRAINT leads_court_count_band_check CHECK (court_count_band IS NULL OR court_count_band IN
      ('1','2_3','4_6','7_plus')),
  ADD CONSTRAINT leads_ad_surface_check CHECK (ad_surface IS NULL OR ad_surface ~ '^[a-z0-9_]{1,32}$');
CREATE INDEX leads_campaign_name_idx ON leads (campaign_name) WHERE campaign_name IS NOT NULL;
CREATE INDEX leads_excel_no_idx      ON leads ((extra_answers->>'excel_no')) WHERE extra_answers ? 'excel_no';

-- 5) Form alanı eşleme hedefleri (intake; kısıt adı canlı kopyada doğrulandı).
ALTER TABLE form_field_mappings DROP CONSTRAINT form_field_mappings_target_field_check;
ALTER TABLE form_field_mappings ADD CONSTRAINT form_field_mappings_target_field_check CHECK (target_field IN
  ('full_name','first_name','last_name','email','phone','country','city','company','product_interest','notes',
   'extra','ignore','install_site','install_timeline','customer_profile','court_count'));

-- 6) Veri düzeltmeleri (kişisel veri yok; geri alınamaz).
UPDATE leads   SET country = 'FR' WHERE country = 'FX';   -- eski UlkelerBilgileri kodu (10 lead, 9 kişi)
UPDATE persons SET country = 'FR' WHERE country = 'FX';
UPDATE leads SET ad_surface = CASE lower(extra_answers->'mysql'->>'platform')
    WHEN 'instagram' THEN 'ig' WHEN 'website' THEN 'web' WHEN 'whatsapp' THEN 'whatsapp' END
  WHERE ad_surface IS NULL AND extra_answers->'mysql'->>'platform' IS NOT NULL;
UPDATE leads SET ad_surface = extra_answers->>'platform'
  WHERE ad_surface IS NULL AND extra_answers->>'platform' ~ '^[a-z0-9_]{1,32}$';
-- Temas geçmişi bilinmeyen eski kayıtlar: "Hiç ulaşılmadı"ya değil "Kayıt yok (eski)"ye sayılır.
UPDATE leads l SET contact_history_unknown = true
  WHERE (l.current_stage <> 'NEW' OR l.extra_answers ? 'mysql' OR l.platform_lead_id LIKE 'mysql:%')
    AND NOT EXISTS (SELECT 1 FROM activities a WHERE a.lead_id = l.id AND a.done_at IS NOT NULL);
