-- Bildirimlerin genişlemesi (2026-11-23): yeni bildirim türleri (devir, tekrar form, iş vadesi, bekleyen sıcak lead)
-- ve Web Push abonelikleri.
--
-- 1) dedupe_key: zamanlı işler aynı olayı her turda yeniden görür (vadesi geçmiş iş, bekleyen lead). Aynı anahtarla
--    ikinci satır yazılmaz; birden fazla sunucu kopyası çalışsa da kişi tek bildirim alır. NULL = tekilleştirme yok.
-- 2) push_subscriptions: kullanıcının "bu cihazda bildirim al" dediği tarayıcılar. endpoint tarayıcının push
--    servisindeki adresidir (gizli tutulur, loglanmaz); p256dh ve auth iletiyi o tarayıcı için şifreler.
--    Aynı tarayıcıda başka biri oturum açarsa satır o kişiye geçer (endpoint tekildir).
-- Geri alma: DROP TABLE push_subscriptions; DROP INDEX user_notifications_dedupe_idx;
--            ALTER TABLE user_notifications DROP COLUMN dedupe_key;
ALTER TABLE user_notifications ADD COLUMN dedupe_key text;
CREATE UNIQUE INDEX user_notifications_dedupe_idx ON user_notifications (user_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE TABLE push_subscriptions (
  id          uuid PRIMARY KEY,
  user_id     text NOT NULL,
  endpoint    text NOT NULL UNIQUE,
  p256dh      text NOT NULL,
  auth        text NOT NULL,
  lang        text NOT NULL DEFAULT 'tr',
  created_at  timestamptz NOT NULL,
  updated_at  timestamptz NOT NULL
);
CREATE INDEX push_subscriptions_user_idx ON push_subscriptions (user_id);
