-- Web sitesi çekme API'si v1 (docs/runbooks/web-form.md "Çekme modu"): teklif formunun yeni alanları sağlayıcı
-- "web" için açıkça "ek yanıt" olarak eşlenir (Yönetim → Eşlemeler'de görünsün, yanlışlıkla "ignore" yapılmasın).
--   project_type   → ek yanıt; normalizeFormAnswers müşteri profiline çevirir ("project type" eşanlamlısı).
--   court_count    → ek yanıt; kort sayısı ve bandı ("court count" eşanlamlısı).
--   country_input  → ek yanıt; `country` (ISO) boş ya da çözülemezse adaptör ülkeyi buradan çözer (6 dil).
--   product_slug, import_source → ek yanıt (ürün sayfası kimliği; "wp-legacy" = sitedeki eski kayıt aktarımı).
-- Yönetici bu alanlardan birini elle eşlemişse dokunulmaz (ON CONFLICT DO NOTHING).

INSERT INTO form_field_mappings (id, provider, form_id, platform_field, target_field) VALUES
  (gen_random_uuid(), 'web', NULL, 'project_type',  'extra'),
  (gen_random_uuid(), 'web', NULL, 'court_count',   'extra'),
  (gen_random_uuid(), 'web', NULL, 'country_input', 'extra'),
  (gen_random_uuid(), 'web', NULL, 'product_slug',  'extra'),
  (gen_random_uuid(), 'web', NULL, 'import_source', 'extra')
ON CONFLICT DO NOTHING;
