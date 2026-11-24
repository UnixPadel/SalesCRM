-- Lead silme (2026-11-24): yalnız yönetici siler; kayıt veritabanında kalır ("çöp kutusu"), yönetici geri alabilir.
-- Silinen lead listeden, panodan, kişi/kuruluş sayfalarından, raporlardan, bildirimlerden ve reklam dönüşüm
-- akışından düşer. Aşama geçmişi ve diğer bağlı kayıtlar dokunulmadan kalır (lead_stage_events yalnız eklemeli).
-- deleted_by: silen kullanıcı kimliği; delete_reason: zorunlu gerekçe (uygulama katmanı denetler).
-- Geri alma: DROP INDEX leads_deleted_idx;
--            ALTER TABLE leads DROP COLUMN deleted_at, DROP COLUMN deleted_by, DROP COLUMN delete_reason;
ALTER TABLE leads
  ADD COLUMN deleted_at    timestamptz,
  ADD COLUMN deleted_by    text,
  ADD COLUMN delete_reason text;

CREATE INDEX leads_deleted_idx ON leads (deleted_at) WHERE deleted_at IS NOT NULL;
