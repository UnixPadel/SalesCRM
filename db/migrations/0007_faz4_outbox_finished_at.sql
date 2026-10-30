-- Faz 4: giden olay satırının bittiği an (sent, dead ya da skipped). Günlük dead-letter raporu bu sütunla
-- "son 24 saat" penceresini seçer; sent_at yalnız başarılı gönderim için kalır.
ALTER TABLE outbound_conversion_events ADD COLUMN finished_at timestamptz;
CREATE INDEX outbound_finished_idx ON outbound_conversion_events (status, finished_at);
