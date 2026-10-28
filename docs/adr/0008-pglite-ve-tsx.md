# ADR-0008: Testlerde ve yerel geliştirmede PGlite; sunucu çalışma zamanı tsx

- Durum: Kabul edildi
- Tarih: 2026-10-28
- Karar verenler: Yazılım (Elshan)

## Bağlam

Faz 1 entegrasyon testleri gerçek Postgres ister ("aşama → olay + outbox aynı transaction'da; hata olunca hiçbiri yazılmıyor"). Geliştirme makinesinde Postgres kurulu değil, Docker Desktop kapalı; CI'da da servis container'ı kurmak mümkün ama yavaş ve yerelde tekrar edilemez. Ayrıca yeni modüller TypeScript, mevcut sunucu `server/index.mjs` düz JavaScript; ikisinin tek süreçte çalışması gerekiyor.

## Karar

- **PGlite** (`@electric-sql/pglite`, Node içinde WebAssembly Postgres): tüm entegrasyon ve API testleri bellekte gerçek Postgres motoru üzerinde koşar; migration'lar birebir aynı SQL dosyalarıdır. `DATABASE_URL` tanımlı değilse yerel geliştirme de PGlite ile diske (`server/data/pglite`) yazar. Staging ve canlı **gerçek Postgres**'tir (ADR-0002); `shared/db` arayüzü ikisini de aynı şekilde sarar.
- **tsx**: sunucu `tsx server/index.mjs` ile çalışır; `.mjs` dosyası TypeScript modüllerini doğrudan import eder. Node 22'nin yerleşik tip soyma özelliği uzantısız import'ları çözmediği için tsx tercih edildi. Üretimde de tsx kullanılır (küçük ekip, tek süreç); build adımı gerekmez.
- Migration koşucusu, pg ve PGlite adaptörleri `src/modules/shared/db` altında; yalnız infrastructure katmanları import eder (mimari kural).

## Seçenekler ve neden seçilmediği

- **Docker Postgres (testcontainers):** CI'da ve yerelde Docker gerektirir; geliştirme makinesinde kapalı. PGlite aynı SQL'i çalıştırdığı için sözleşme kaybı yok. PGlite'ın desteklemediği bir özellik (ör. bazı eklentiler) gerekirse testler container'a taşınır.
- **SQLite / bellek içi sahte veritabanı:** SQL lehçesi farklı; trigger, `jsonb`, kısmi index testleri anlamsızlaşır.
- **tsc ile derleyip Node ile çalıştırmak:** Build adımı ve `dist/server` çıktısı gerekir; tsx aynı işi derlemeden yapar. Performans gerekirse sonradan eklenir.

## Sonuçlar

- `npm run db:migrate` ve `npm run db:migrate-legacy` `DATABASE_URL` yoksa PGlite'a yazar; staging'de aynı komutlar gerçek Postgres'e.
- Ölçüm: 975 kayıtlık eski veri taşıması PGlite'ta 9 saniye. CLI betikleri sonunda açıkça çıkar; aksi halde mysql2 havuzu süreci açık tutar.
- Sözlük mimari testi `import.meta` ve yorumları dışında tutar (Faz 1 düzeltmesi).
