-- Faz 4 seed: aşama → Meta CRM olayı adı. Adlar ajans rehberindeki örnekleri izler (event_name = CRM'deki
-- aşama adı); MarcaDM onayı gelince yeni migration ile değişir, Faz 6 ekranı aynı tabloyu düzenler.
-- Hepsi açık: dağıtıcı kapalı satırı `skipped (mapping_disabled)` yapar. Optimizasyon hedefi "Nitelikli".

INSERT INTO platform_stage_mappings (id, stage_code, provider, platform_event_name, enabled, is_optimization_target) VALUES
  (gen_random_uuid(), 'NEW',       'meta', 'Yeni Lead',         true, false),
  (gen_random_uuid(), 'CONTACTED', 'meta', 'İletişim Kuruldu',  true, false),
  (gen_random_uuid(), 'QUALIFIED', 'meta', 'Nitelikli Lead',    true, true),
  (gen_random_uuid(), 'PROPOSAL',  'meta', 'Teklif Gönderildi', true, false),
  (gen_random_uuid(), 'WON',       'meta', 'Kazanıldı',         true, false),
  (gen_random_uuid(), 'LOST',      'meta', 'Kaybedildi',        true, false)
ON CONFLICT (stage_code, provider) DO NOTHING;

-- Giden akış ayarları: acil durdurma anahtarı (false → tüm Meta satırları skipped) ve veri seti kimliği
-- (boşsa META_DATASET_ID ortam değişkeni kullanılır; secret değil, kimliktir).
INSERT INTO integration_settings (provider, key, value) VALUES
  ('meta', 'outbound_enabled', 'true'),
  ('meta', 'dataset_id',       '')
ON CONFLICT (provider, key) DO NOTHING;
