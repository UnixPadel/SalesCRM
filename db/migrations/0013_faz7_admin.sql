-- Faz 7 (yönetim paneli): yalnız ekleme; geri almak için aşağıdaki üç sütunu ve indeksi düşürmek yeter
--   ALTER TABLE outbound_conversion_events DROP COLUMN request_id;
--   ALTER TABLE organizations DROP COLUMN archived_at;
--   DROP INDEX persons_merged_idx; ALTER TABLE persons DROP COLUMN merged_into_id;

-- 7c: platformun istek kimliği (eşzamansız işleme sonucunu sorgulamak için). Kimlik döndürmeyen platformda boş.
ALTER TABLE outbound_conversion_events ADD COLUMN request_id text;

-- 7d: kuruluş arşivleme (silme yok). Arşivli kuruluş listelerden ve seçim kutularından düşer; bağlı kayıtlar kalır.
ALTER TABLE organizations ADD COLUMN archived_at timestamptz;

-- 7d: kişi birleştirme. Kaynak kişi silinmez; hedefi gösterir ve listelerde gizlenir.
ALTER TABLE persons ADD COLUMN merged_into_id uuid REFERENCES persons(id);
CREATE INDEX persons_merged_idx ON persons (merged_into_id) WHERE merged_into_id IS NOT NULL;
