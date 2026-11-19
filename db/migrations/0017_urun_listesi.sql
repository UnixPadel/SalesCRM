-- Ürün listesi: bütün ürünler tek statüde, adetle girilir (kort, kapatma, aksesuar ayrımı yok).
-- Ürünler dışarıdaki ürün dosyasından (UrunKategorileri CSV, KategoriID + KategoriAdi) gelir; numara dosyadaki
-- numaradır. Dosyada olmayan ürün silinmez, `active = false` olur (eski lead'lerde görünür, yeni lead'e eklenmez).
-- İlk yükleme 2026-11-19 dosyasından: "de" (79) deneme kaydı alınmadı; "MobilFLOD Court" ve "Mobile FLOD Padbol"
-- adlarındaki FLOD yazımı FOLD olarak düzeltildi.

CREATE TABLE products (
  id          integer PRIMARY KEY CHECK (id > 0),
  name        text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  active      boolean NOT NULL DEFAULT true,
  sort_order  integer NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX products_name_key ON products (lower(name));

INSERT INTO products (id, name, sort_order) VALUES
  (21, 'Standard Padel Court', 1),
  (22, 'Panoramic Padel Court', 2),
  (23, 'Single Padel Court', 3),
  (24, 'Portable Padel Courts', 4),
  (25, 'Full Panoramic Court', 5),
  (26, 'WP Challenge Padel Court', 6),
  (27, 'Padel Court Cover', 7),
  (28, 'MobilFOLD Court', 8),
  (29, 'Flat Floor Padel Court', 9),
  (30, 'Floating Floor Padel Court', 10),
  (31, 'Padbol', 11),
  (32, 'Half – Close Canopy', 12),
  (33, 'Retractable Roof Cover System', 13),
  (34, 'Full Membrane Cover', 14),
  (35, 'MobilFOLD X-TEND', 15),
  (36, 'Wheel Canopy System', 16),
  (37, 'ADLX3T', 17),
  (38, 'ADLX4T', 18),
  (39, 'ADL KDK', 19),
  (40, 'Cleek', 20),
  (41, 'Roof Cover', 21),
  (61, 'Padel net and pole', 22),
  (62, 'Standard Padbol', 23),
  (63, 'Mobile FOLD Padbol', 24),
  (64, 'Panoramic Padbol', 25),
  (66, 'Roof Retractable', 26),
  (67, 'Additional Galvanized', 27),
  (68, 'Side Retractable', 28),
  (69, 'Roof - Side Retractable', 29),
  (70, 'Floating Standard Padel Court', 30),
  (76, 'Single Full Panoramic Padel Court', 31),
  (77, 'Canopy', 32),
  (78, 'Anchorage System', 33),
  (82, 'Pickleball', 34),
  (83, 'Plate Padel Court', 35);

-- Lead'in ürünleri: [{"productId": 21, "qty": 2}, ...], ürün numarasına göre sıralı.
ALTER TABLE leads ADD COLUMN products jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Eski ürün alanlarının taşınması (eski sütunlar silinmez, yedek olarak kalır; uygulama artık yazmaz):
-- Standard → 21 Standard Padel Court, Panoramic → 22 Panoramic Padel Court, Full Panoramic → 25 Full Panoramic Court,
-- Kapatma → 27 Padel Court Cover (1 adet).
UPDATE leads l SET products = coalesce((
    SELECT jsonb_agg(jsonb_build_object('productId', v.pid, 'qty', v.q) ORDER BY v.pid)
      FROM (VALUES (21, l.qty_standard::integer),
                   (22, l.qty_panoramic::integer),
                   (25, l.qty_full_panoramic::integer),
                   (27, CASE WHEN l.roof_wanted THEN 1 END)) AS v(pid, q)
     WHERE v.q IS NOT NULL), '[]'::jsonb)
 WHERE l.qty_standard IS NOT NULL OR l.qty_panoramic IS NOT NULL OR l.qty_full_panoramic IS NOT NULL OR l.roof_wanted;

-- Kapatma işaretli lead'lerin notuna eski kayıt bilgisi (çatı ölçüsü girilmişse o da) yazılır.
UPDATE leads SET notes = notes
    || CASE WHEN btrim(notes) = '' THEN '' ELSE E'
' END
    || 'Eski kayıt: kapatma istedi'
    || CASE
         WHEN roof_width_m IS NOT NULL AND roof_length_m IS NOT NULL THEN
           ' (çatı ölçüsü ' || replace(trim(trailing '.' FROM trim(trailing '0' FROM roof_width_m::text)), '.', ',')
           || ' × ' || replace(trim(trailing '.' FROM trim(trailing '0' FROM roof_length_m::text)), '.', ',') || ' m)'
         WHEN roof_width_m IS NOT NULL THEN
           ' (çatı genişliği ' || replace(trim(trailing '.' FROM trim(trailing '0' FROM roof_width_m::text)), '.', ',') || ' m)'
         WHEN roof_length_m IS NOT NULL THEN
           ' (çatı uzunluğu ' || replace(trim(trailing '.' FROM trim(trailing '0' FROM roof_length_m::text)), '.', ',') || ' m)'
         ELSE ''
       END
 WHERE roof_wanted;
