# Modüller

Genel plan'daki modüler monolit. Dört iş modülü ve bir paylaşılan katman; sınırlar `.dependency-cruiser.cjs` ile zorlanır (`npm run arch`).

| Modül | Görev | Faz |
|---|---|---|
| `sales-pipeline` | Çekirdek: lead, kişi, aşama motoru, aşama olayları. Bu modülde "Meta" veya "Google" kelimesi geçmez (sözlük testi: `tests/architecture`). | 1 |
| `lead-intake` | Gelen lead'ler: kaynak başına adaptör, inbox, `CreateLeadFromAd`. | 2, 3 |
| `ad-feedback` | Giden olaylar: outbox, saf payload builder'ları, platform adaptörleri, dağıtıcı. | 4, 5 |
| `integration-settings` | Aşama ve form eşlemeleri, bağlantılar, acil durdurma, sağlık paneli. | 2–6 |
| `shared` | `normalization` (e-posta, telefon, platform başına hash) ve `kernel` (Clock, Id, Result, hata tipleri, config/secret yükleyici, logger). | 1 |

## Katman kuralları

```
domain/          saf kod: entity, değer nesnesi, domain olayı, kural, port arayüzleri
application/     komutlar ve sorgular; portları kullanır, uygulamaları enjekte alır
infrastructure/  repository, outbox/inbox yazıcı, pg-boss, dış istemciler
api/ adapters/   HTTP controller ve DTO; platform payload'ı burada iç DTO'ya çevrilir
```

1. Bağımlılık içe doğru akar: `domain` hiçbir npm paketi, Node çekirdek modülü veya üst katman import etmez.
2. `application` → `infrastructure`, `api`, `adapters` import etmez.
3. Modül X → modül Y yalnız `Y/application` üzerinden.
4. `shared` hiçbir modülü import etmez.
5. `process.env` yalnız `shared/kernel` içinde okunur (lint kuralı).

Her `index.ts` modülün dışa açık yüzüdür; başka modül yalnız bu dosyadan import eder.
