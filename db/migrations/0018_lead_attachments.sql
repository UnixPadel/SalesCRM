-- Lead dosya ekleri (2026-11-19): görüşme notuna ya da aşama geçişine eklenen dosyalar (pdf, görsel, belge, tablo).
-- İçerik base64 metin olarak tutulur (pg ve PGlite aynı davranır; dosya başına en çok 10 MB, kural domain'de).
-- Silme yumuşaktır: satır kalır, neden zorunludur, içerik boşaltılır.
CREATE TABLE lead_attachments (
  id              uuid PRIMARY KEY,
  lead_id         uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  activity_id     uuid REFERENCES activities(id) ON DELETE SET NULL,  -- eklendiği görüşme (temas) kaydı
  stage_code      text NOT NULL,           -- yüklendiği andaki aşama
  file_name       text NOT NULL,
  mime_type       text NOT NULL,
  size_bytes      integer NOT NULL CHECK (size_bytes > 0),
  content_base64  text,                    -- silinince NULL
  uploaded_by     text NOT NULL,
  uploaded_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,
  deleted_by      text,
  delete_reason   text,
  CHECK ((deleted_at IS NULL) = (delete_reason IS NULL)),
  CHECK (deleted_at IS NOT NULL OR content_base64 IS NOT NULL)
);
CREATE INDEX lead_attachments_lead_idx ON lead_attachments (lead_id, uploaded_at DESC);
