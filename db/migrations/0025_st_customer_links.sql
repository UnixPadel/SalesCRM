-- UnixPadelST müşteri listesi (2026-11-25): Nitelikli, Teklif gönderildi ya da Kazanıldı aşamasındaki lead, öteki
-- programın MusteriBilgileri tablosuna bir kez yazılır ya da orada zaten olan müşteriye bağlanır (e-posta / ad).
-- Bu tablo aynı lead'in ikinci kez yazılmasını önler. created: true = CRM açtı, false = var olan müşteriye bağlandı.
-- Geri alma: DROP TABLE st_customer_links;
CREATE TABLE st_customer_links (
  lead_id     uuid PRIMARY KEY REFERENCES leads(id) ON DELETE CASCADE,
  musteri_id  integer NOT NULL,
  created     boolean NOT NULL,
  linked_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX st_customer_links_musteri_idx ON st_customer_links (musteri_id);
