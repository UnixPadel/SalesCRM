-- Geri yükleme noktası (2026-11-23): toplu veri işleminden (Excel eşitleme gibi) önce dokunulacak satırların o anki hali
-- ve işlemden sonraki hali saklanır. Yönetim > Teknik > Geri yükleme noktaları'ndan yalnız yönetici, işlemin yaptığı
-- değişiklikleri geri alır: işlemin eklediği satırlar silinir, değiştirdiği ve sildiği satırlar eski haline döner.
-- İşlemin dokunmadığı lead'ler ve tablolar etkilenmez. Kişisel veri içerir (satır kopyaları); yalnız yönetici okur.
-- Geri alma: DROP TABLE data_checkpoint_rows; DROP TABLE data_checkpoints;
CREATE TABLE data_checkpoints (
  id              uuid PRIMARY KEY,
  created_at      timestamptz NOT NULL,
  created_by      text NOT NULL,
  label           text NOT NULL,
  source          text NOT NULL,
  lead_ids        uuid[] NOT NULL DEFAULT '{}',
  summary         jsonb NOT NULL DEFAULT '{}'::jsonb,
  restored_at     timestamptz,
  restored_by     text,
  restore_summary jsonb
);
CREATE INDEX data_checkpoints_time_idx ON data_checkpoints (created_at DESC);

-- op: insert = işlem ekledi (geri alınca silinir); update = işlem değiştirdi; delete = işlem sildi (geri alınca eklenir).
CREATE TABLE data_checkpoint_rows (
  checkpoint_id uuid NOT NULL REFERENCES data_checkpoints(id) ON DELETE CASCADE,
  seq           integer NOT NULL,
  table_name    text NOT NULL,
  op            text NOT NULL CHECK (op IN ('insert', 'update', 'delete')),
  row_key       text NOT NULL,
  before        jsonb,
  after         jsonb,
  PRIMARY KEY (checkpoint_id, seq)
);
