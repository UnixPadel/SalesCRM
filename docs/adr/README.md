# Mimari karar kayıtları (ADR)

Genel plan, kural 10: her mimari karar yazılıdır. Her karar tek dosyadır, numarası değişmez.

Durumlar: **Bekliyor** (karar verilmedi, seçenekler listeli) · **Kabul edildi** · **Değiştirildi** (yerine geçen ADR'yi gösterir).

| No | Başlık | Durum |
|----|--------|-------|
| [0001](0001-teknoloji-yigini.md) | Teknoloji yığını: TypeScript, Node 22, modüler monolit | Kabul edildi |
| [0002](0002-veritabani.md) | Veritabanı: Postgres | Kabul edildi |
| [0003](0003-kuyruk-ve-outbox.md) | Kuyruk ve arka plan işleri: Postgres outbox + pg-boss | Kabul edildi |
| [0004](0004-secret-deposu.md) | Secret deposu: ortam değişkenleri, kodda yalnız referans | Kabul edildi (araç hosting'e bağlı) |
| [0005](0005-hosting-ve-webhook-girisi.md) | Hosting ve webhook giriş yolu | **Bekliyor** |
| [0006](0006-asama-modeli-gecisi.md) | Mevcut 5 kolondan 6 aşamalı modele geçiş | **Bekliyor** |
| [0007](0007-kod-kalitesi-araclari.md) | Lint, format, test, mimari test, secret tarayıcı, CI | Kabul edildi |
| [0008](0008-pglite-ve-tsx.md) | Testlerde ve yerelde PGlite; sunucu çalışma zamanı tsx | Kabul edildi |

Şablon:

```markdown
# ADR-NNNN: Başlık

- Durum: Bekliyor | Kabul edildi | Değiştirildi (ADR-MMMM)
- Tarih: YYYY-AA-GG
- Karar verenler: …

## Bağlam
## Karar
## Seçenekler ve neden seçilmediği
## Sonuçlar
```
