-- Faz 6b: fırsat alanları lead'de (ADR-0013 madde 5). Lead = fırsat; ayrı deals tablosu yok.
--   court_count          kort sayısı (0–999), bilinmiyorsa NULL
--   court_model          kort modeli (serbest metin, ürün kataloğundaki ad)
--   expected_close_date  beklenen kapanış günü (takvim günü, saat yok)
-- Tutar aşama olayında kalır (Teklif ve Kazanıldı); organization_id 6d'de organizations tablosuyla birlikte gelir.
ALTER TABLE leads
  ADD COLUMN court_count          integer CHECK (court_count IS NULL OR (court_count >= 0 AND court_count <= 999)),
  ADD COLUMN court_model          text NOT NULL DEFAULT '',
  ADD COLUMN expected_close_date  date;

-- Pano filtreleri (sorumlu · ülke) ve kapanış takvimi için.
CREATE INDEX leads_country_idx        ON leads (country);
CREATE INDEX leads_expected_close_idx ON leads (expected_close_date) WHERE expected_close_date IS NOT NULL;
