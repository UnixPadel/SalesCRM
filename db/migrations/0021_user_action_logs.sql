-- İşlem günlüğü (2026-11-20): kullanıcıların lead üzerinde yaptığı işlemler (aşama taşıma, bilgi girme, görüşme
-- kaydı, dosya yükleme, atama…). Yönetimdeki "Loglar" sekmesi buradan okur. Yalnız ekleme; lead silinirse satır kalır
-- (lead_name o andaki ad). `details` işleme göre değişir: {from,to} · {fields:[…]} · {type,outcome} · {fileName,image}.
-- Geri alma: DROP TABLE user_action_logs;
CREATE TABLE user_action_logs (
  id             uuid PRIMARY KEY,
  occurred_at    timestamptz NOT NULL,
  actor_user_id  text NOT NULL,
  action         text NOT NULL,
  lead_id        uuid REFERENCES leads(id) ON DELETE SET NULL,
  lead_name      text NOT NULL DEFAULT '',
  details        jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX user_action_logs_time_idx  ON user_action_logs (occurred_at DESC, id DESC);
CREATE INDEX user_action_logs_actor_idx ON user_action_logs (actor_user_id, occurred_at DESC);

-- Geçmiş: bu tablodan önce yapılmış işlemlerden kaydı zaten tutulanlar (aşama geçmişi, görüşme kayıtları, dosya
-- ekleri) günlüğe aktarılır ki sekme ilk günden dolu olsun. İçe aktarma ve taşıma aktörleri (kişi değil) alınmaz.
-- Bilgi girişi (alan düzenleme) geçmişi tutulmadığı için aktarılamaz; bundan sonrası kaydedilir.
INSERT INTO user_action_logs (id, occurred_at, actor_user_id, action, lead_id, lead_name, details)
SELECT e.id, e.occurred_at, e.actor_user_id, 'stage.changed', e.lead_id, l.full_name,
       jsonb_build_object('to', e.stage_code)
  FROM lead_stage_events e
  JOIN leads l ON l.id = e.lead_id
 WHERE e.origin = 'manual'
   AND e.undone_at IS NULL
   AND e.actor_user_id IS NOT NULL
   AND e.actor_user_id NOT IN ('import', 'migration')
ON CONFLICT (id) DO NOTHING;

INSERT INTO user_action_logs (id, occurred_at, actor_user_id, action, lead_id, lead_name, details)
SELECT DISTINCT ON (c.id)
       c.id, c.created_at, c.actor_user_id, 'contact.logged', c.lead_id, l.full_name,
       CASE WHEN a.id IS NULL THEN '{}'::jsonb
            ELSE jsonb_build_object('type', a.type, 'outcome', a.outcome) END
  FROM contact_logs c
  JOIN leads l ON l.id = c.lead_id
  LEFT JOIN activities a ON a.log_id = c.id AND a.done_at IS NOT NULL
 WHERE c.actor_user_id NOT IN ('import', 'migration')
 ORDER BY c.id, a.done_at
ON CONFLICT (id) DO NOTHING;

INSERT INTO user_action_logs (id, occurred_at, actor_user_id, action, lead_id, lead_name, details)
SELECT a.id, a.uploaded_at, a.uploaded_by, 'attachment.added', a.lead_id, l.full_name,
       jsonb_build_object('fileName', a.file_name, 'image', a.mime_type LIKE 'image/%')
  FROM lead_attachments a
  JOIN leads l ON l.id = a.lead_id
 WHERE a.uploaded_by NOT IN ('import', 'migration')
ON CONFLICT (id) DO NOTHING;
