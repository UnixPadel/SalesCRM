# ADR-0003: Kuyruk ve arka plan işleri — Postgres outbox + pg-boss

- Durum: Kabul edildi
- Tarih: 2026-10-27
- Karar verenler: Yazılım (Elshan)

## Bağlam

Genel plan iki desen ister. **Inbox:** webhook ham gövdeyi kaydedip 200 döner, işleme arka planda olur. **Outbox:** aşama değişikliğiyle aynı transaction'da giden olay satırı yazılır; dağıtıcı her dakika çalışır, 10 dakika bekler ("geri al" hakkı), 1 dk / 5 dk / 30 dk / 2 sa / 12 sa aralıklarla yeniden dener, sonra dead. Ayrıca saatlik yedek senkron var. Depoda bugün hiç kuyruk, worker veya zamanlayıcı yok.

## Karar

- Kuyruk altyapısı olarak **Postgres** kullanılır; ayrı Redis/RabbitMQ kurulmaz.
- `inbound_webhook_events` ve `outbound_conversion_events` tabloları **iş kaydıdır** ve kendi durum alanlarını taşır (pending/sent/failed/dead/skipped). Bunlar kuyruk kütüphanesine ait tablolar değildir; raporlama ve admin paneli doğrudan bunları okur.
- Zamanlama ve yeniden deneme için **pg-boss** (aynı Postgres üzerinde) kullanılır: dakikalık dağıtıcı, saatlik yedek senkron ve günlük rapor birer pg-boss zamanlanmış işidir. Dağıtıcı `outbound_conversion_events` tablosunu `FOR UPDATE SKIP LOCKED` ile okur; retry aralıkları config'ten gelir, pg-boss'un kendi retry'ı değil, tablodaki `next_attempt_at` esas alınır.
- Worker aynı Node sürecinde çalışır (modüler monolit); hosting birden fazla instance verirse `SKIP LOCKED` çift işlemeyi engeller.

## Seçenekler ve neden seçilmediği

- **Redis + BullMQ:** Olgun, ama ikinci bir veri deposu ve secret; outbox'ın "aynı transaction" garantisi için yine Postgres tablosu gerekir. Hacim (ayda yüzlerce olay) Redis'i haklı çıkarmaz.
- **Yalnız `setInterval` + `SKIP LOCKED`, kütüphanesiz:** En yalın seçenek; pg-boss yalnız zamanlama, kilit ve iş geçmişi için eklenir. Faz 1'de pg-boss gereksiz görülürse bu seçeneğe düşmek ADR değişikliği gerektirmez; dağıtıcı mantığı kütüphaneden bağımsız yazılır.
- **Bulut kuyruğu (SQS, Cloud Tasks):** Hosting kararı verilmedi; sağlayıcıya bağımlılık erken.

## Sonuçlar

- Tek veritabanı: Postgres hem veri hem kuyruk. Yedeği alınırken ikisi birlikte alınır.
- Dağıtıcı ve işleyici kodu `ad-feedback/application` ve `lead-intake/application` altında, pg-boss ise yalnız `infrastructure/` katmanında görünür.
