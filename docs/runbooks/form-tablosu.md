# Runbook: Form tablosunun (Google E-Tablolar) CRM'e eşitlenmesi

Meta form kampanyasının dökümü Google E-Tablolar'da tutuluyor. Sunucu bu tabloyu birkaç dakikada bir okur. Yeni
satırlar Lead listesine düşer (2026-11-11). Kod: `src/bootstrap/sheetSync.ts`.

Kişisel veri loglanmaz ve rapora yazılmaz. Raporda yalnız satır numarası, sayılar ve hata kodları bulunur.

## Kurulum

1. **Tabloyu paylaşın:** Paylaş → Genel erişim → "Bağlantıya sahip olan herkes" → Görüntüleyen. Paylaşım kapalıysa
   Google CSV yerine giriş sayfası döner. O durumda eşitleme "Form tablosu okunamadı" der ve hiçbir şey yazmaz.
2. **CSV adresi:** tablo adresindeki `/edit…#gid=<sekme>` kısmını `/export?format=csv&gid=<sekme>` yapın.
3. **`.env`** (depoya girmez):

   ```
   SHEET_SYNC_CSV_URL=https://docs.google.com/spreadsheets/d/<tablo-kimliği>/export?format=csv&gid=<sekme>
   SHEET_SYNC_MINUTES=5
   ```

   Bu adres, tablodaki kişisel verilere girişsiz erişim verir. Adresi yalnız `.env`'de tutun; e-postaya, sohbete ya
   da koda yazmayın. Sunucu adresi loglamaz ve arayüze göndermez.
4. **Sunucuyu yeniden başlatın.** Eşitleme açılışta bir kez, sonra her `SHEET_SYNC_MINUTES` dakikada bir çalışır.

## İlk eşitlemeden önce

- **Yedek alın:** `server/data/pglite` klasörünü kopyalayın. Postgres'te `pg_dump` kullanın.
- **Kuru çalıştırma** (sunucu açıkken de olur; geçici kopyada çalışır): `npm run db:import-sheet -- --dry-run`.
  Raporda şunlar görünür: yeni lead sayısı, CRM'de zaten olan kişiler, daha önce eşitlenmiş satırlar ve eklenecek
  e-posta temaları (CRM'de olan lead'lere düşenler ayrıca sayılır).

## Kurallar

| Tablo | CRM |
|---|---|
| Yeni satır (e-posta ya da telefon CRM'de yok) | Yeni lead. Kaynak "Form tablosu · Instagram/Facebook". Ülke kuralıyla atanır ve sorumluya "yeni lead" bildirimi gider. |
| Kişi CRM'de var, açık lead'i var (ör. Excel aktarımı) | Yeni lead açılmaz. Lead'in boş form cevapları, kampanya ve reklam yüzeyi doldurulur; dolu alan değişmez. |
| Not sütununda "mail" geçiyor (ör. "mail atildi") | Lead'in yapılmış e-posta teması yoksa e-posta teması eklenir: sonuç "dönüş bekleniyor", tarih tahmini (lead tarihi 09:00). |
| Form cevapları | Meta form kodları CRM kodlarına çevrilir. Tanınmayan cevap "Kaynak detayı"nda kalır. |
| Telefon | Tablo "+" işaretini düşürür; 10–15 haneli rakam dizisinin başına "+" eklenir. Okunamayan numara (ör. "######") bırakılır. |
| Ülke | Ülke sütunu (kod ya da ad). Boşsa ya da "90" gibi bir arama koduysa telefonun ülkesi kullanılır; köken uyarısı lead'de görünür. |
| E-posta da telefon da yok | Satır atlanır ("kimliksiz"). |
| Satır silinir ya da değişir | CRM'deki lead değişmez. Eşitleme yalnız ekler ve boşları doldurur. |

Eşitleme idempotenttir. Satır anahtarı e-posta, telefon ve oluşturma zamanından türetilir. Aynı satır ikinci kez lead
açmaz ve ikinci e-posta teması eklemez.

Meta entegrasyonu (Faz 1) açıldığında aynı kişi Meta'dan da gelirse, tablodan açılan lead Meta kaydına bağlanır
(Excel lead'leri gibi). İkinci bir lead açılmaz.

## İzleme

- **Lead listesi** (yönetici): araç çubuğunda "Form tablosu · 3 dk önce eşitlendi" ve yenile düğmesi ("Şimdi
  eşitle"). Hata varsa "Form tablosu okunamadı" görünür; nedeni etiketin ipucundadır. Zamanlanmış koşu yeni kayıt
  getirdiyse liste kendiliğinden yenilenir.
- **API:** `GET /api/sheet-sync` (yönetici, izleyici) son durumu ve son raporun sayılarını döndürür.
  `POST /api/sheet-sync/run` (yönetici) eşitlemeyi hemen çalıştırır.
- **Log:** `module: "sheet-sync"`. Değişiklik olduğunda "form tablosu eşitlendi" yazılır, hata olduğunda "form
  tablosu eşitlenemedi".

## Excel doğrulaması ile ilişkisi

Tablo, Excel satış takip dosyasından daha yeni. 2026-11-11 kuru çalıştırmasının sonuçları:

- 103 satırın 69'u CRM'de zaten olan Excel lead'leri. Bu 69 lead'in CRM'de hiç teması yoktu (Excel'de "mail
  atılmadı"); tabloda her biri için "mail atildi" yazıyor.
- 34 satır yeni lead.

Eşitlemeden sonra Özet rapor'da "Mail atılan" artar, "Hiç ulaşılmamış" azalır. `npm run db:import-excel --
<dosya.xlsx> --verify` bu farkları **A10 (form tablosu sonrası)** olarak sayar. A10 yalnız tablonun dokunduğu
lead'lerde, yalnız şu alanlarda geçerlidir: mail, hiç ulaşılmamış, kurulum zamanı, kapalı kort.

## Kapatma

`.env`'den `SHEET_SYNC_CSV_URL` satırını silin ve sunucuyu yeniden başlatın. Daha önce açılmış lead'ler ve
temaslar CRM'de kalır.
