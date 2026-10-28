# ADR-0009: Inbox payload şifreleme ve kütüphanesiz zamanlayıcı

- Durum: Kabul edildi
- Tarih: 2026-10-28
- Karar verenler: Yazılım (Elshan)

## Bağlam

Faz 2 iş emri: "Inbox payload'ı şifreli; 30 günden eski payload'ları silen iş." Webhook ham gövdesi
kişisel veri taşır (ad, e-posta, telefon). Ayrıca işleyici, saatlik yedek senkron ve günlük temizlik için
zamanlanmış iş gerekir; ADR-0003 bunun için pg-boss önermişti.

## Karar

1. **Şifreleme:** `inbound_webhook_events.payload_ciphertext` AES-256-GCM ile şifrelenir; anahtar
   `INBOX_ENCRYPTION_KEY` (32 bayt, base64; `npm run secrets:key`) yalnız ortam değişkeninde (ADR-0004).
   Zarf biçimi `v1.<iv>.<tag>.<ciphertext>`; sürüm öneki anahtar döndürmeye yer bırakır (bu fazda yok).
   Anahtar tanımsızsa yerel geliştirme düz metin zarfı (`plain.`) kullanır ve uyarı loglar; staging ve
   canlıda anahtar zorunludur (runbook).
2. **Temizlik:** 30 gün (`INBOX_RETENTION_DAYS`) sonra payload NULL yapılır (`payload_purged_at`); satırın
   kendisi (durum, hata, lead bağı) raporlama için kalır.
3. **Zamanlayıcı:** pg-boss **kullanılmadı**; ADR-0003'ün ikinci seçeneği (kütüphanesiz `setInterval` +
   `FOR UPDATE SKIP LOCKED`) uygulandı. Neden: pg-boss gerçek bir Postgres bağlantısı ister, yerel
   geliştirme ve testler PGlite'ta (ADR-0008). İş mantığı kütüphaneden bağımsız; ADR-0003 bu geçişi
   "ADR değişikliği gerektirmez" diye tanımlamıştı, burada yalnız kayda geçiyor.

## Seçenekler ve neden seçilmediği

- **Postgres `pgcrypto` ile sütun şifreleme:** anahtar SQL'e geçer, loglarda görünebilir; PGlite'ta
  eklenti yönetimi ayrı iş. Uygulama tarafı şifreleme anahtarı veritabanından uzak tutar.
- **Payload'ı hiç saklamamak:** hata ayıklama ve yeniden işleme imkânsızlaşır; Genel plan inbox deseni
  ham gövdeyi ister.
- **pg-boss:** yukarıda. Hosting (ADR-0005) birden fazla instance verirse `SKIP LOCKED` çift işlemeyi
  zaten engeller; zamanlayıcı her instance'ta çalışır, iş satır bazında kilitlenir.

## Sonuçlar

- Yedek alınırken anahtar da yedeklenmeli; anahtar kaybolursa eski payload'lar okunamaz (lead kayıtları
  etkilenmez, onlar düz tablolarda).
- Yanlış anahtar açılışta değil ilk okumada hata verir ve `zamanlanmış iş hata verdi` olarak her tikte
  loglanır; anahtar değişikliği bilinçli bir işlemdir.
- Dağıtıcı (Faz 4) aynı zamanlayıcıyı kullanır.
