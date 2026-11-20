-- Müşteriye özel çalışma para birimi (2026-11-20): bu lead'in tutarları ekranda bu para biriminde gösterilir ve
-- teklif / kazanıldı / bütçe girişleri varsayılan olarak bu birimle açılır. NULL = kullanıcının seçtiği görünüm
-- para birimi (sağ üst). Saklanan tutarlar değişmez; çeviri yalnız gösterimde, güncel kurla yapılır.
ALTER TABLE leads ADD COLUMN currency char(3);
