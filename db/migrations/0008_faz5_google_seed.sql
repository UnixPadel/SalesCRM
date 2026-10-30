-- Faz 5 seed: aşama → Google Ads dönüşüm işlemi. Yalnız Nitelikli ve Kazanıldı gider. Dönüşüm işlemi
-- kimliklerini MarcaDM verir; o güne kadar satırlar KAPALI ve yer tutucu: dağıtıcı `skipped (mapping_disabled)` yazar.
-- Kimlik gelince (docs/runbooks/google-data-manager.md):
--   UPDATE platform_stage_mappings SET platform_event_name = '<CONVERSION_ACTION_ID>', enabled = true
--    WHERE provider = 'google' AND stage_code = 'QUALIFIED';

INSERT INTO platform_stage_mappings (id, stage_code, provider, platform_event_name, enabled, is_optimization_target) VALUES
  (gen_random_uuid(), 'QUALIFIED', 'google', 'CONVERSION_ACTION_ID_PENDING', false, true),
  (gen_random_uuid(), 'WON',       'google', 'CONVERSION_ACTION_ID_PENDING', false, false)
ON CONFLICT (stage_code, provider) DO NOTHING;

-- Hedef hesap ayarları: müşteri kimliği (10 hane, tiresiz), isteğe bağlı yönetici hesabı; acil durdurma anahtarı.
INSERT INTO integration_settings (provider, key, value) VALUES
  ('google', 'outbound_enabled',  'true'),
  ('google', 'customer_id',       ''),
  ('google', 'login_customer_id', '')
ON CONFLICT (provider, key) DO NOTHING;
