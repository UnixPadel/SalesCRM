-- Faz 2 seed: platformların standart form alanları → lead alanı. Form bazlı özel sorular
-- (form_id dolu satırlar) Faz 6'daki eşleme ekranına kadar ek migration veya SQL ile girilir.
-- Eşlenmeyen alan: Meta'da "ek yanıt" olarak saklanır, Google'da yok sayılır (adaptör politikası).

INSERT INTO form_field_mappings (id, provider, form_id, platform_field, target_field) VALUES
  -- Meta Lead Ads: field_data[].name (önceden tanımlı alanlar)
  (gen_random_uuid(), 'meta', NULL, 'full_name',          'full_name'),
  (gen_random_uuid(), 'meta', NULL, 'first_name',         'first_name'),
  (gen_random_uuid(), 'meta', NULL, 'last_name',          'last_name'),
  (gen_random_uuid(), 'meta', NULL, 'email',              'email'),
  (gen_random_uuid(), 'meta', NULL, 'work_email',         'email'),
  (gen_random_uuid(), 'meta', NULL, 'phone_number',       'phone'),
  (gen_random_uuid(), 'meta', NULL, 'work_phone_number',  'phone'),
  (gen_random_uuid(), 'meta', NULL, 'country',            'country'),
  (gen_random_uuid(), 'meta', NULL, 'city',               'city'),
  (gen_random_uuid(), 'meta', NULL, 'company_name',       'company'),
  (gen_random_uuid(), 'meta', NULL, 'job_title',          'extra'),
  (gen_random_uuid(), 'meta', NULL, 'street_address',     'extra'),
  (gen_random_uuid(), 'meta', NULL, 'zip_code',           'extra'),
  (gen_random_uuid(), 'meta', NULL, 'post_code',          'extra'),
  (gen_random_uuid(), 'meta', NULL, 'state',              'extra'),
  (gen_random_uuid(), 'meta', NULL, 'province',           'extra'),
  -- Google Ads lead form: user_column_data[].column_id (önceden tanımlı alanlar)
  (gen_random_uuid(), 'google', NULL, 'FULL_NAME',        'full_name'),
  (gen_random_uuid(), 'google', NULL, 'FIRST_NAME',       'first_name'),
  (gen_random_uuid(), 'google', NULL, 'LAST_NAME',        'last_name'),
  (gen_random_uuid(), 'google', NULL, 'EMAIL',            'email'),
  (gen_random_uuid(), 'google', NULL, 'WORK_EMAIL',       'email'),
  (gen_random_uuid(), 'google', NULL, 'PHONE_NUMBER',     'phone'),
  (gen_random_uuid(), 'google', NULL, 'WORK_PHONE',       'phone'),
  (gen_random_uuid(), 'google', NULL, 'COUNTRY',          'country'),
  (gen_random_uuid(), 'google', NULL, 'CITY',             'city'),
  (gen_random_uuid(), 'google', NULL, 'COMPANY_NAME',     'company'),
  (gen_random_uuid(), 'google', NULL, 'JOB_TITLE',        'extra'),
  (gen_random_uuid(), 'google', NULL, 'POSTAL_CODE',      'extra'),
  (gen_random_uuid(), 'google', NULL, 'REGION',           'extra'),
  (gen_random_uuid(), 'google', NULL, 'STREET_ADDRESS',   'extra');

-- Varsayılan ayarlar: boş form listesi (yedek senkron form yokken çalışmaz); webhook açık.
INSERT INTO integration_settings (provider, key, value) VALUES
  ('meta',   'active_form_ids', '[]'),
  ('meta',   'page_id',         ''),
  ('meta',   'webhook_enabled', 'true'),
  ('google', 'webhook_enabled', 'true');
