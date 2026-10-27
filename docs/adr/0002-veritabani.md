# ADR-0002: Veritabanı — Postgres

- Durum: Kabul edildi (addon/sunucu seçimi ADR-0005'e bağlı)
- Tarih: 2026-10-27
- Karar verenler: Yazılım (Elshan)

## Bağlam

Veri bugün `server/data/crm.json` içinde tek JSON dosyasında tutuluyor; `db/schema.sql` Postgres hedefli yazılmış ama kullanılmıyor. Genel plan şunları ister: `UNIQUE(source, platform_lead_id)` ile çift kayıt önleme, yalnız-ekleme aşama olay tablosu, aşama değişikliği + olay + outbox satırının **tek transaction**'da yazılması, `SKIP LOCKED` ile güvenli kuyruk tüketimi. JSON dosyası bunların hiçbirini veremez. Giriş için kullanılan şirket kullanıcı tablosu Clever Cloud MySQL'de.

## Karar

- CRM verisi **PostgreSQL 16+** üzerinde tutulur. Mevcut `db/schema.sql` başlangıç noktasıdır; Faz 1'de Genel plan'daki tablolar (`leads`, `lead_attribution`, `lead_consents`, `lead_stage_events`, `inbound_webhook_events`, `outbound_conversion_events`, `stage_definitions`, `platform_stage_mappings`, `form_field_mappings`, `integration_settings`, `territory_rules`, `lost_reasons`) migration olarak eklenir.
- Migration aracı: SQL dosyalarıyla ileri yönlü, sıralı migration (`node-pg-migrate` veya düz SQL + sürüm tablosu; Faz 1'de seçilir, ORM kullanılmaz).
- Erişim: `pg` sürücüsü, repository arayüzleri `infrastructure/` katmanında; domain SQL görmez.
- Giriş tablosu (`KullaniciBilgileri`, MySQL) **taşınmaz**; mevcut `server/authDb.mjs` salt okunur erişimle kalır.

## Seçenekler ve neden seçilmediği

- **JSON dosyasıyla devam:** Transaction, benzersiz kısıt ve eşzamanlı yazma yok; outbox deseni kurulamaz.
- **MySQL (giriş tablosuyla aynı yerde):** Mümkün, ama `db/schema.sql` ve tipler Postgres için yazılmış; `SKIP LOCKED`, kısmi index ve `timestamptz` desteği Postgres'te daha olgun. İki veritabanı olması kabul edilen maliyet.
- **SQLite:** Tek süreç için yeterli olurdu; ancak hosting kararı bulut PaaS olursa kalıcı disk garantisi yok.

## Sonuçlar

- Hosting kararı (ADR-0005) Postgres'in nerede çalışacağını belirler: Clever Cloud addon, VPS üzerinde Docker ya da yönetilen servis.
- Mevcut JSON veri Faz 1'de tek seferlik içe aktarma betiğiyle Postgres'e taşınır; `seed` verisi (955 gerçek form kaydı) kişisel veri içerdiği için taşıma öncesi KVKK kararı gerekir (bkz. `docs/decisions.md`).
