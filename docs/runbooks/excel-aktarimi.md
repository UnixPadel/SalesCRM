# Runbook: Excel satış takip listesinin aktarımı

Komut: `npm run db:import-excel -- <dosya.xlsx> [--dry-run] [--owners owners.json] [--apply-to-pool] [--no-seed-follow-ups] [--verify]`

Kişisel veri ekrana yazılmaz (yalnız sayılar, lead kimlikleri, Excel No, ekip adları, KullaniciID'ler). `.xlsx`
dosyaları depoya girmez (`.gitignore`).

## Sıra

1. **Sunucuyu durdurun** (PGlite tek süreçtir; betik çalışan sunucuyu görürse durur).
2. **Yedek alın:** `server/data/pglite` klasörünü kopyalayın (ör. `server/data/pglite-backup-YYYY-MM-DD`). Postgres'te
   `pg_dump`.
3. **Şema:** sunucuyu bir kez başlatıp durdurun ya da `npm run db:migrate` (şema sürümü 12 gerekir; betik kontrol eder).
4. **Kuru çalıştırma:** `--dry-run`. PGlite'ta veri klasörünün geçici kopyasında gerçek aktarım çalışır, rapor basılır,
   kopya silinir. Raporu okuyun: sorumlu eşleşmesi, çözülemeyen etiketler, bölge kuralları, aşama ve temas sayıları,
   içe aktarma sorunları, takip tohumu.
5. **Sorumlu düzeltmesi (gerekirse):** `owners.json` ile etiket → KullaniciID ya da `null` (havuz). Örnek:
   `{"Enes": "26", "Almanya Distribütörü": null}`. Verilen kimlik aktif bir satış kullanıcısı değilse betik durur.
6. **Gerçek koşu:** aynı komut, `--dry-run` olmadan.
7. **Doğrulama:** `--verify` (salt okunur). Çıkış 0 = CRM Özet rapor Excel ÖZET RAPOR ile aynı (izinli farklar A1–A10; A10 = form tablosu sonrası, `docs/runbooks/form-tablosu.md`);
   1 = gerekçesiz fark (satır No ve alan yazılır); 2 = formül sağlaması tutmadı.
8. **İkinci koşu** "Değişiklik yok." demeli (idempotent).
9. Sunucuyu başlatın; Raporlar → Özet rapor → "Excel listesi" kapsamı `--verify` çıktısının CRM sütunuyla aynı olmalı.

## Seçenekler

- `--apply-to-pool`: bölge kuralı olan ülkelerin açık havuz lead'lerini kural sahibine atar; Excel'de başka sorumluya
  verilmiş (etiketli) lead'ler atlanır. Ek bildirim gönderilmez.
- `--no-seed-follow-ups`: atanmış ve açık işi olmayan lead'lere takip açılmaz (lead'ler "Takipsiz" görünür).

## Yeniden çalıştırma

Lead `excel_no` ile, temaslar ve takip tohumları eski kimlikle (`legacy_id`) bulunur; alanlar yalnız boşsa yazılır,
aşama yalnız ileri gider. Excel'de sonradan ✔ konan satır yeni temas ekler; aynı temas CRM'de de kaydedildiyse iki kayıt
olur. Aktarımdan sonra kaynak CRM'dir; Excel'e geri yazılmaz.

## Meta intake ile birlikte

Intake, aynı kişinin Excel'den gelen açık lead'ini benimser (ikinci lead açmaz, platform kimliğini ekler). Geriye
dönük doldurma (backfill) aktarımdan sonra çalıştırılır.

## Satışçının kişisel dosyası: eşitleme (2026-11-23)

Kişisel takip dosyaları (ör. `UNIXPADEL_Satis_Takip - Amro(...).xlsx`) ana listeden farklıdır: numaralar dosyaya aittir
ve aynı kişiler CRM'de zaten olabilir. Bunlar `db:import-excel` ile değil, eşitleme komutuyla işlenir:

```bash
npm run db:sync-excel -- --as-of 2026-11-20T15:07:00+03:00 \
  --file amro.xlsx --list amro --owner 51 --file salah.xlsx --list salah --owner 46
```

- `--as-of`: Excel'in son düzenlenme zamanı (saat dilimiyle). Lead CRM'de bundan sonra elle düzenlendiyse **CRM esas**
  (yalnız boş alan dolar); düzenlenmediyse **Excel esas** (durum, teklif, ürün, not, form cevapları, kampanya, sorumlu
  Excel'deki değere çekilir; boş hücre silmez; aşama yalnız ileri; eski not "Önceki not:" altında kalır; satışçının
  temasları silinmez, ilk içe aktarmanın dokunulmamış "mail atıldı" teması Excel "Mail ✘" diyorsa silinir).
- Eşleştirme kişiyle (e-posta, telefon). Bulunamayan satır yeni lead olur: kimlik `excel:<liste>:<No>`, `excel_no` =
  `<liste>-<No>`. Aynı kişinin aynı dakikada açılmış kopyası gizlenir (`is_test`, `duplicate_of`).
- Varsayılan **kuru koşu**dur: yalnız okur, satır başına kararı basar. Canlı veritabanında da güvenle çalışır.
- `--apply` planı uygular ve **geri yükleme noktası** oluşturur (şema 22). Geri dönmek için: Yönetim → Teknik →
  Geri yükleme noktaları → "Bu Noktaya Geri Dön" (yalnız yönetici), ya da `npm run db:sync-excel -- --restore <kimlik>`.
  Geri dönüş yalnız eşitlemenin yaptığı değişiklikleri geri alır; onay penceresi noktadan sonra başkasının da
  değiştirdiği lead sayısını gösterir.
