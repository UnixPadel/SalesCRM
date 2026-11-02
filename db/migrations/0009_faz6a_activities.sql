-- Faz 6a: aktiviteler (satış panosu). Bir lead'in yapılacak işleri: arama, e-posta, toplantı, teklif gönderimi,
-- saha ziyareti. Kurallar (docs/yol-haritasi.md bölüm 4):
--   1. Açık aşamadaki lead'in bitmemiş aktivitesi yoksa "takipsiz" sayılır (sorguyla hesaplanır, sütun yok).
--   2. "Teklif gönderildi"ye giriş 3 gün sonrası için otomatik arama açar; created_by_change_id o aşama
--      değişikliğinin change_id'sidir, 10 dakikalık geri al bu satırı siler.
CREATE TABLE activities (
  id                    uuid PRIMARY KEY,
  lead_id               uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  type                  text NOT NULL CHECK (type IN ('call','email','meeting','proposal_sent','site_visit')),
  subject               text NOT NULL DEFAULT '',
  due_at                timestamptz NOT NULL,
  done_at               timestamptz,
  notes                 text NOT NULL DEFAULT '',
  auto_created          boolean NOT NULL DEFAULT false,
  created_by_change_id  uuid,
  created_by_user_id    text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX activities_lead_idx     ON activities (lead_id, due_at);
CREATE INDEX activities_open_due_idx ON activities (due_at) WHERE done_at IS NULL;
CREATE INDEX activities_change_idx   ON activities (created_by_change_id) WHERE created_by_change_id IS NOT NULL;
