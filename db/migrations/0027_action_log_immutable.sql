-- İşlem günlüğü değiştirilemez ve her işlemi kapsar (2026-11-27). Önceden yalnız lead işlemleri tutuluyordu; artık
-- yönetim paneli (bölge, ürün kataloğu, ayarlar, eşlemeler, kurlar, geri yükleme…), elle başlatılan aktarımlar ve
-- oturum (giriş, başarısız giriş, çıkış) da yazılır. Satır bir kez yazılır; uygulama da arayüz de değiştiremez/silemez.
--
--   target_type   lead | territory | product_catalog | person | organization | settings | mapping | fx_rates |
--                 queue | checkpoint | sync | mail_stats | warning | session | request
--   target_id     hedefin kimliği (lead id, ülke kodu, sağlayıcı…); yoksa NULL
--   target_label  o anki görünen ad (lead adı, ülke kodu…); hedef sonradan silinse de kalır
--   result        ok | denied (yetki yok) | rejected (geçersiz istek) | error (sunucu hatası)
--
-- lead_id'nin yabancı anahtarı kaldırılır: lead kalıcı silinse (ör. geri yükleme noktası) bile günlük satırı aynen kalır.
-- Kişisel veri değerleri (telefon, e-posta, ad) details'e yazılmaz; yalnız alan adları ve kişisel olmayan değerler.
--
-- Geri alma: DROP TRIGGER user_action_logs_no_update ON user_action_logs; DROP TRIGGER user_action_logs_no_truncate
--   ON user_action_logs; DROP FUNCTION user_action_logs_immutable(); ALTER TABLE user_action_logs DROP COLUMN target_type,
--   DROP COLUMN target_id, DROP COLUMN target_label, DROP COLUMN result;
ALTER TABLE user_action_logs
  ADD COLUMN target_type  text NOT NULL DEFAULT 'lead',
  ADD COLUMN target_id    text,
  ADD COLUMN target_label text NOT NULL DEFAULT '',
  ADD COLUMN result       text NOT NULL DEFAULT 'ok'
    CONSTRAINT user_action_logs_result_chk CHECK (result IN ('ok', 'denied', 'rejected', 'error'));

UPDATE user_action_logs SET target_id = lead_id::text, target_label = lead_name WHERE target_id IS NULL;

ALTER TABLE user_action_logs DROP CONSTRAINT IF EXISTS user_action_logs_lead_id_fkey;

CREATE INDEX user_action_logs_target_idx ON user_action_logs (target_type, target_id, occurred_at DESC);
CREATE INDEX user_action_logs_label_idx ON user_action_logs (lower(target_label));

CREATE FUNCTION user_action_logs_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'user_action_logs yalnız eklenebilir: % reddedildi', TG_OP USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER user_action_logs_no_update
  BEFORE UPDATE OR DELETE ON user_action_logs
  FOR EACH ROW EXECUTE FUNCTION user_action_logs_immutable();

CREATE TRIGGER user_action_logs_no_truncate
  BEFORE TRUNCATE ON user_action_logs
  FOR EACH STATEMENT EXECUTE FUNCTION user_action_logs_immutable();
