# Faz 2 — Gelen lead akışı: kabul raporu

Tarih: 2026-10-28. Kapsam: Faz 2 iş emri (ortak boru hattı, Meta Lead Ads, Google Ads lead formu, test).
Kapsam dışı bırakılanlar: web sitesi formu (Faz 3), platformlara giden olaylar (Faz 4–5), eşleme ekranları (Faz 6).

Onaylanan varsayılanlar (2026-10-28, Elshan): kütüphanesiz zamanlayıcı (pg-boss yerine, ADR-0009),
`user_notifications` tablosu, `CreateLead`'e `attribution` alanı, `INBOX_ENCRYPTION_KEY`, nodemailer SMTP portu.

## Görevler ve commit'ler

| Görev | Commit | Durum |
|---|---|---|
| Migration'lar: `inbound_webhook_events`, `form_field_mappings`, `integration_settings` (+ `user_notifications`) | `db:` d602e2c | Tamam — `db/migrations/0003`, `0004` seed |
| Webhook controller'ları: doğrula → inbox'a yaz → hemen 200 | `api:` c7fb7b5 | Tamam — `lead-intake/api/webhooks.ts` |
| İşleyici worker'ı: inbox → kaynak adaptörü → `InboundLeadDto` → `CreateLeadFromAd` | `lead-intake application:` 737a7ac | Tamam — `ProcessInbox`, her 5 sn |
| Hata ayrımı: geçici yeniden denenir, kalıcı `failed` | aynı | Tamam — 1, 5, 30, 120, 720 dk; sonra `failed` (`intake.retries_exhausted`) |
| Inbox payload şifreli; 30 günden eski payload'ı silen iş | `kernel:` 7acebf4, `lead-intake infrastructure:` edc7b19 | Tamam — AES-256-GCM, günlük `PurgeInboxPayloads` |
| `LeadCreated` abonesi: uygulama içi bildirim ve e-posta | `notifications:` 54df736 | Tamam — zil + SMTP portu (SMTP hesabı bekliyor) |
| Meta GET doğrulama (`hub.verify_token`, `hub.challenge`) | `adapters/meta:` 077593a | Tamam |
| Meta POST doğrulama: `X-Hub-Signature-256`, ham gövde, sabit zamanlı | aynı | Tamam — `safeEqual` (HMAC özetleri `timingSafeEqual`) |
| Graph API client; sürüm config'te tek değer | aynı | Tamam — `META_GRAPH_API_VERSION` |
| `leadgen_id` ile lead'in tamamı; `field_data` → `form_field_mappings` | aynı + `integration-settings:` c4b286c | Tamam |
| Eşlenmeyen alan "ek yanıt" | aynı | Tamam — `extra_answers` |
| Sayfa aboneliği betiği ve runbook | aynı | Tamam — `scripts/meta-subscribe.ts`, `docs/runbooks/meta-lead-ads.md` |
| Saatlik yedek senkron: aktif form başına son 2 saat, aynı inbox | aynı | Tamam — `RunBackfill`, `metaBackfillSource` |
| Sistem kullanıcısı token'ı secret deposunda; Lead Erişimi (MarcaDM) | — | **Yazılım dışı, bekliyor** — `META_SYSTEM_USER_TOKEN` adı sabit; `docs/decisions.md` madde 9 |
| Google webhook ucu; `google_key` sabit zamanlı, uyuşmazsa 401 | `adapters/google:` 0c603d9, `api:` | Tamam |
| `user_column_data` → `column_id`; `gcl_id` → `lead_attribution.gclid` | aynı + `application:` ec27f79 | Tamam |
| `is_test` lead'leri test işaretli | aynı | Tamam |
| Tanınmayan alanlar yok sayılır | aynı | Tamam — adları `extra_answers.ignored_columns` |
| Webhook URL'si ve anahtar MarcaDM'e güvenli kanaldan | — | **Yazılım dışı, bekliyor** — `docs/runbooks/google-lead-form.md`; madde 10 |

## Test planı

| Madde | Nerede | Sonuç |
|---|---|---|
| Platform başına ≥ 5 fixture: normal, test, eksik alan, bilinmeyen alan, çift bildirim | Meta: `adapters/meta/fixtures` (7: webhook-normal, webhook-duplicate, lead-normal, lead-test, lead-missing-fields, lead-unknown-fields, lead-no-contact + 2 sayfalı form listesi). Google: `adapters/google/fixtures` (5: normal, test, missing-fields, unknown-fields, no-contact; çift bildirim testte aynı fixture iki kez) | 17 + 9 test yeşil |
| İmza ve anahtar: geçerli, geçersiz, eksik başlık | `meta.test.ts` (POST imza: geçerli, büyük harf, değişmiş gövde, başka secret, başlık yok, yanlış şema, boş hex, secret yok), `google.test.ts` (geçerli, yanlış, yok, sayı, null, beklenen boş), `api/webhooks.test.ts` (HTTP 200 / 401 / 400 / 413) | Yeşil |
| Aynı bildirim iki kez → tek lead | `intake.test.ts`, `meta.test.ts` uçtan uca, `google.test.ts` uçtan uca, `webhooks.test.ts` (iki POST → 1 satır / 1 lead), inbox PGlite testi (UNIQUE) | Yeşil |
| Yedek senkron: webhook kapalıyken eksik lead'i getiriyor | `meta.test.ts` "uçtan uca": webhook yalnız 555000001'i getirdi; form listesi 555000009'u da döndü → senkron 1 yeni satır, işleyici lead açtı, mevcut lead yeniden çekilmedi | Yeşil |

```
$ npm run test:coverage
Test Files  21 passed (21)      Tests  230 passed (230)
Statements : 99.83% ( 1213/1215 )   Branches : 94.88%   Functions : 100%   Lines : 99.83%
 integration-settings/domain 100 %   lead-intake/application 100 %   sales-pipeline/application 99.63 %   sales-pipeline/domain 100 %
$ npm run verify   → lint 0 hata (11 eski kod uyarısı), prettier temiz, tsc (2 proje) temiz, arch 0 ihlal, secretlint temiz
```

## Kabul kriterleri ve doğrulama

### 1. Meta Lead Ads Testing Tool lead'i tüm alanlarıyla, doğru satışçıya atanmış olarak düşüyor

**Yazılım tarafı doğrulandı; gerçek Testing Tool bekliyor.** Gerçek deneme için Meta uygulaması, sistem
kullanıcısı token'ı ve internete açık HTTPS adres (ADR-0005) gerekiyor; ikisi de yok. Yerine:

- `webhooks.test.ts` "işleyici koşunca Graph'tan tam lead çekilir": imzalı webhook → inbox → sahte Graph
  API (`lead-normal.json`) → lead; ad, e-posta, E.164 telefon, ülke (Türkiye → TR), şehir, firma, kampanya /
  reklam seti / reklam adları, özel soru ek yanıt olarak `GET /api/pipeline/leads` çıktısında doğrulandı.
- Atama: `intake.test.ts` "ülke kuralıyla atanır" — `territory_rules` TR → `rep-tr`, lead `assignedUserId =
  rep-tr`, `LeadCreated` + `LeadAssigned` olayları. Tablo bugün boş olduğundan canlıda lead'ler havuza düşer
  (madde 8, Satış).
- Testing Tool lead'i: `lead-test.json` (`test lead: dummy data for …` değerleri) → `isTest = true`
  (`meta.test.ts`); test lead'i outbox'a girmez (Faz 1 kuralı).
- Yerel sunucuda (launch `crm-webhook-smoke`) imzalı gerçek HTTP isteği: `GET /webhooks/meta` challenge →
  `200 777`; yanlış belirteç → 403; imzalı POST → `200 EVENT_RECEIVED`, inbox satırı; imzasız → 401. Token
  tanımsız olduğundan işleyici satırı `failed` / `meta.token_missing` yaptı (beklenen kalıcı hata sınıfı,
  log satırı: `inbox: kalıcı hata, failed`).

### 2. Google "Test verisi gönder" kaydı düşüyor, `gclid` saklanmış ve test işaretli

**Yerelde doğrulandı; gerçek Google paneli bekliyor.** Google'ın "Test verisi gönder" biçimindeki
`lead-test.json` (`is_test: true`, `TeSter-…` kimlik, `gcl_id`):

- `webhooks.test.ts` "doğru anahtar → 200 {}": lead `source = google_form`, `isTest = true`;
  `lead_attribution.gclid = TeSter-123-gclid` SQL ile okundu; inbox payload'ı şifreli (`v1.` öneki) ve
  `google_key` içermiyor.
- Yerel sunucuya curl ile gerçek POST (2026-10-28 11:51): test ve normal kayıt `200 {}`, yanlış anahtar
  `401 {"error":"Anahtar geçersiz."}`, aynı normal kayıt ikinci kez → log `inbox: aynı bildirim yine geldi`,
  `GET /api/pipeline/leads?includeTest=1` → iki Google lead'i (biri test). Tarayıcıda gelen kutusunda
  "Google" rozetli "Ayşe Demir" (ekran görüntüsü alındı, 2026-10-28).

### 3. Webhook kapatılıp açıldığında eksik Meta lead'i 1 saat içinde geliyor

**Sahte Graph ile doğrulandı; gerçek ortam bekliyor.** `meta.test.ts` "uçtan uca": form listesi webhook'un
getirmediği 555000009'u döndürdü → `RunBackfill` 1 satır ekledi (`fetched: 2, inserted: 1`), işleyici lead'i
açtı. Zamanlayıcı saatte bir (`BACKFILL_INTERVAL_MINUTES = 60`) koşar; en kötü gecikme 60 dk + 5 sn.
`getFormLeads` `time_created > now − 2 sa` filtresi ve sayfalama testli. Gerçek test adımı runbook'ta
(abonelik kaldır → lead oluştur → abonelik aç → ≤ 1 sa).

### 4. Gerekiyorsa Meta App Review başvurusu bu ortamdan alınan ekran kaydıyla yapıldı

**Yapılamadı.** Staging yok; gerekip gerekmediği `docs/decisions.md` madde 1'de bekliyor. Kayıt senaryosu
runbook bölüm 7'de.

## Tarayıcıda el testi (2026-10-28, yerel, `crm-webhook-smoke`)

1. Google test ve normal fixture'ları curl ile gönderildi; 5 sn içinde işlendi; gelen kutusunda "Google"
   rozetli lead; test lead'i "Test lead'leri" filtresiyle görünür.
2. Admin (API ile) "yusa"ya lead atadı → "yusa" girişinde zilde kırmızı "1"; menüde "Yeni lead atandı:
   Bildirim Denemesi · Deneme Kulüp · TR · az önce"; tıklayınca lead sayfası açıldı, sayaç 0'a düştü
   (`POST /notifications/<id>/read → 200`).
3. E-posta: SMTP tanımsız → log `e-posta (SMTP kapalı, gönderilmedi)`; sahte göndericiyle içerik testli
   (bağlantı `PUBLIC_BASE_URL/#/lead/<id>`, müşteri iletişim bilgisi e-postada yok).

Not: curl ile gönderilen Türkçe karakter (Kulüp) git-bash kodlaması yüzünden bozuk görüntülendi; API
testlerinde aynı metin UTF-8 ile doğru geçiyor.

## Bitti tanımı (Genel plan) — bu faz

- [x] İş kuralı domain katmanında ve testli (`integration-settings/domain/mapping.ts`; ülke çözümü ve
      hata sınıflandırması application'da, saf ve testli)
- [x] Dış çağrı bir port arkasında, sahte uygulamayla testli (`GraphClient` + sahte fetch, `InboxRepository`
      bellek içi + PGlite, `EmailSender`/`UserDirectory` sahteleri)
- [x] Logda kişisel veri yok (maskeleme; webhook loglarında yalnız kimlik ve sayı; Google anahtarı
      inbox'a yazılmadan çıkarılır; token URL'de değil başlıkta)
- [x] Hata türü sınıflandırılmış (Graph: 5xx/429/oran sınırı geçici; 190 / 10 / 200 / 4xx kalıcı; iş kuralı
      → `intake.invalid_lead` kalıcı; beklenmeyen → `intake.unexpected` kalıcı)
- [x] Config ve secret kodda değil (`loadConfig`; `META_*`, `GOOGLE_LEAD_FORM_KEY`, `INBOX_ENCRYPTION_KEY`,
      `SMTP_*` yalnız bootstrap'ta `readSecret`; `.env.example` yer tutucu)
- [x] Arayüz metinleri TR ve EN (zil metinleri `src/i18n`)
- [x] ADR yazıldı (ADR-0009; ADR-0003'e not)

## Bilinen eksikler ve sonraki adımlar

1. **Gerçek platform testleri** (kriter 1–4) hosting (ADR-0005), Meta token / Lead Erişimi (madde 9) ve
   Google anahtar teslimine (madde 10) bağlı.
2. **SMTP hesabı** (madde 11) gelene kadar e-posta bildirimi yalnız loglanır; uygulama içi bildirim çalışır.
3. **Ülke → satışçı tablosu boş** (madde 8); reklam lead'leri havuza düşer, bildirim gitmez.
4. **Failed satırları yeniden kuyruğa alma** admin ekranı Faz 6; bu fazda SQL ile (`status = 'pending'`).
5. **Meta test lead tespiti** Testing Tool'un "test lead: dummy data" kalıbına dayanır; Meta bu kalıbı
   değiştirirse test lead'i gerçek sayılır (outbox'a Faz 4'te girer). Form bazlı `is_test` işareti yok.
6. **`npm audit`** eski bağımlılıklarda 10 uyarı veriyor (Faz 2 öncesinden); ayrı iş.
7. Sözlük mimari testi: `gclid` listeden çıkarıldı (sütun adı, platform adı değil); Meta/Google adları
   çekirdekte hâlâ yasak ve test yeşil.
