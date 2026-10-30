-- Faz 3 seed: web sitesi formunun alan adları → lead alanı. Site formu alanlarını `fields` nesnesinde
-- kendi adlarıyla gönderir (docs/runbooks/web-form.md); burada yaygın adlar eşlenir. Eşlenmeyen alan
-- "ek yanıt" olarak saklanır (adaptör politikası: extra). Site forma alan eklerse ek migration ya da
-- Faz 6 ekranı ile satır girilir; form_id dolu satır sağlayıcı varsayılanını ezer.

INSERT INTO form_field_mappings (id, provider, form_id, platform_field, target_field) VALUES
  (gen_random_uuid(), 'web', NULL, 'full_name',        'full_name'),
  (gen_random_uuid(), 'web', NULL, 'name',             'full_name'),
  (gen_random_uuid(), 'web', NULL, 'first_name',       'first_name'),
  (gen_random_uuid(), 'web', NULL, 'last_name',        'last_name'),
  (gen_random_uuid(), 'web', NULL, 'email',            'email'),
  (gen_random_uuid(), 'web', NULL, 'phone',            'phone'),
  (gen_random_uuid(), 'web', NULL, 'country',          'country'),
  (gen_random_uuid(), 'web', NULL, 'city',             'city'),
  (gen_random_uuid(), 'web', NULL, 'company',          'company'),
  (gen_random_uuid(), 'web', NULL, 'product_interest', 'product_interest'),
  (gen_random_uuid(), 'web', NULL, 'interest',         'product_interest'),
  (gen_random_uuid(), 'web', NULL, 'message',          'notes'),
  (gen_random_uuid(), 'web', NULL, 'notes',            'notes'),
  (gen_random_uuid(), 'web', NULL, 'page_language',    'extra');
