-- Meta anlık formları: Türkçe yerelli (tr_TR) formlar standart alanları Türkçe anahtarla gönderir; eski bir formda
-- standart alanlar soru metniyle adlandırılmış. Graph API'den okundu (2026-11-16, Unixpadel sayfasının 14 aktif formu):
--   FULL_NAME  adı_soyadı · ad · what_is_your_first_and_last_name?
--   EMAIL      e-posta · what_is_your_email_address?
--   PHONE      telefon_numarası · what_is_your_phone_number?
--   COUNTRY    ülke
-- Bu eşlemeler yokken "Plate Court - Qualified Lead TR - 2026" formunun lead'i "Ad soyad zorunlu." ile düştü.
-- Yönetici bu alanlardan birini elle eşlemişse dokunulmaz (ON CONFLICT DO NOTHING).

INSERT INTO form_field_mappings (id, provider, form_id, platform_field, target_field) VALUES
  (gen_random_uuid(), 'meta', NULL, 'adı_soyadı',                       'full_name'),
  (gen_random_uuid(), 'meta', NULL, 'ad',                               'full_name'),
  (gen_random_uuid(), 'meta', NULL, 'what_is_your_first_and_last_name?', 'full_name'),
  (gen_random_uuid(), 'meta', NULL, 'e-posta',                          'email'),
  (gen_random_uuid(), 'meta', NULL, 'what_is_your_email_address?',      'email'),
  (gen_random_uuid(), 'meta', NULL, 'telefon_numarası',                 'phone'),
  (gen_random_uuid(), 'meta', NULL, 'what_is_your_phone_number?',       'phone'),
  (gen_random_uuid(), 'meta', NULL, 'ülke',                             'country')
ON CONFLICT DO NOTHING;
