-- Faz 1 seed: aşama tanımları ve kayıp nedenleri. Görünen adlar ve liste satış onayına kadar
-- VARSAYILAN (docs/decisions.md 5 ve ADR-0006); onay gelince yeni bir migration ile güncellenir.
-- territory_rules bilerek boş: satış tablosu doldurunca ayrı migration (docs/decisions.md 8).

INSERT INTO stage_definitions (code, name_tr, name_en, sort_order, is_terminal, requires_value, requires_reason) VALUES
  ('NEW',       'Yeni lead',          'New lead',       1, false, false, false),
  ('CONTACTED', 'İletişim kuruldu',   'Contacted',      2, false, false, false),
  ('QUALIFIED', 'Nitelikli',          'Qualified',      3, false, false, false),
  ('PROPOSAL',  'Teklif gönderildi',  'Proposal sent',  4, false, false, false),
  ('WON',       'Kazanıldı',          'Won',            5, true,  true,  false),
  ('LOST',      'Kaybedildi',         'Lost',           6, true,  false, true)
ON CONFLICT (code) DO NOTHING;

-- Mevcut panodaki altı neden + "niteliksiz" (LOST'a NEW'den geçiş için).
INSERT INTO lost_reasons (code, name_tr, name_en, sort_order) VALUES
  ('price_too_high',   'Fiyat yüksek bulundu',        'Price too high',             1),
  ('competitor',       'Rakip firma seçildi',         'Chose a competitor',         2),
  ('postponed',        'Proje ertelendi / iptal',     'Project postponed / cancelled', 3),
  ('no_budget',        'Bütçe / finansman yok',       'No budget / financing',      4),
  ('no_response',      'Yanıt vermiyor',              'No response',                5),
  ('site_permit',      'Arsa / izin sorunu',          'Land / permit issue',        6),
  ('unqualified',      'Niteliksiz (hedef dışı)',     'Unqualified (out of scope)', 7)
ON CONFLICT (code) DO NOTHING;
