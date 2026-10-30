# Faz 3 — Web sitesi formu: kabul raporu

Tarih: 2026-10-30. Kapsam: Faz 3 iş emri (CRM `/forms/web` ucu, web formu adaptörü, onaylar; site tarafı
gizli alanlar, honeypot, sunucudan gönderim, geçici kuyruk; testler). Kapsam dışı: site tasarımı ve form
metni, Meta pixel ve tarayıcı tarafı web olayları (MarcaDM).

Onaylanan varsayılanlar (2026-10-30, Elshan): imza `X-Webform-Signature` + `X-Webform-Timestamp` (±300 sn),
site üretimli `submission_id` ile Faz 2 inbox'ı, honeypot iki katmanlı (site eler, CRM yine lead açmaz),
`form_field_mappings`'e `web` sağlayıcısı, `CreateLeadInput.consents`, imzalı gövdede `is_test`, site tarafı
için depoda referans aktarıcı (`integrations/web-form-relay`).

## Görevler ve commit'ler

| Görev | Commit | Durum |
|---|---|---|
| `/forms/web` ucu: HMAC imza doğrulama, IP başına hız sınırı | `lead-intake api:` 7dd6c1d, `server:` abbf86a | Tamam — `lead-intake/api/forms.ts`; 120/dk, 256 KB, 401/400/413/429/503 |
| Web formu adaptörü: form alanları → `InboundLeadDto` | `lead-intake:` 676220f, `db:` 62fb950 | Tamam — `adapters/web-form/adapter.ts`; `form_field_mappings` sağlayıcı `web` (seed `0005`, 14 satır); eşlenmeyen alan ek yanıt |
| Tıklama kimlikleri ve UTM → `lead_attribution` | `sales-pipeline:` 4365759, `lead-intake:` 676220f | Tamam — gclid, gbraid, wbraid, fbclid, fbc, fbp, utm_*, landing_url, click_at; DTO genişletildi |
| Onay kutuları → `lead_consents`, aydınlatma metni sürümüyle | `sales-pipeline:` 4365759 | Tamam — `ConsentInput`, `parseConsents`, `saveConsents` (bellek içi + Postgres), lead ile aynı transaction |
| Site: form gizli alanlarla doldurulur, sunucudan gönderilir, anahtar tarayıcıya inmez | `integrations:` e7b12ce | Tamam (referans uygulama) — `relay.mjs`/`server.mjs`/`lib.mjs`; çerez okuma (`_gcl_aw`, `_fbc`, `_fbp`, UTM); gerçek siteye konuşlandırma **yazılım dışı** (`docs/decisions.md` madde 13) |
| Site: honeypot alanı | aynı + `api:` 7dd6c1d | Tamam — aktarıcı `website` alanını eler; CRM `honeypot` doluysa 200 `ignored`, lead yok |
| Site: CRM'e ulaşılamazsa geçici kuyruk ve yeniden deneme | `integrations:` e7b12ce | Tamam — önce diske (`queue/`), `RELAY_RETRY_SECONDS` ile yeniden deneme; 400/401/413 `failed/` |
| Runbook, ADR, açık işler | `docs:` c6e2531 | Tamam — `docs/runbooks/web-form.md`, ADR-0010, `docs/decisions.md` madde 13–16, README |

## Test planı

| Madde | Nerede | Sonuç |
|---|---|---|
| `gclid` ve `fbclid` içeren reklam URL'sinden gelip form doldurma → kimlikler kayıtlı | `tests/web-form-relay.test.ts` "reklam tıklamasıyla gelen form" (aktarıcı → gerçek `/forms/web` → inbox → lead; `lead_attribution.gclid/fbclid/utm_*`/`landing_url`), `api/forms.test.ts`, `web-form.test.ts` uçtan uca | Yeşil |
| İmzasız veya hatalı imzalı istek → 401 | `web-form.test.ts` (missing / malformed / stale / mismatch, 5 test), `api/forms.test.ts` (HTTP 401 dört neden), relay testi "imzasız doğrudan istek" | Yeşil |
| CRM kapalıyken gönderilen form, CRM açılınca düşüyor | `tests/web-form-relay.test.ts` "CRM kapalıyken": CRM durduruldu → 200, kuyrukta 1 dosya (`attempts: 1`, `fetch failed`) → flush tutar → CRM açıldı → flush iletti → lead; aynı dosya yeniden gönderilince CRM `duplicate`, lead tek | Yeşil |
| Honeypot dolu gönderim lead oluşturmuyor | relay testi (200, kuyruk boş, inbox satırı yok), `api/forms.test.ts` (200 `ignored`, `claimed: 0`), `web-form.test.ts` yardımcılar | Yeşil |
| Fixture'lar | `adapters/web-form/fixtures` (6: normal, test, missing-fields, unknown-fields, no-contact, honeypot) | 13 adaptör testi |

Komutlar ve çıktı (2026-10-30):

```
npm run verify      → lint 0 hata / 11 uyarı (Faz 0 öncesi arayüz kodu), Prettier temiz, tsc (iki proje) temiz,
                      depcruise 0 ihlal (1 bilgi: server/authDb.d.mts orphan), secretlint temiz,
                      24 test dosyası / 258 test yeşil
npx vitest run --coverage → domain + application satır kapsamı %99.68 (eşik %90)
```

## Kabul kriterleri ve doğrulama

### 1. Reklam tıklamasıyla doldurulan test formunda `gclid` ve `fbclid` CRM'de görünüyor

- **Otomatik:** `tests/web-form-relay.test.ts` — `Referer`'ı `?gclid=…&fbclid=…` olan istek, gizli alanlarda
  gclid/fbclid/utm; sonuç `lead_attribution` satırında `gclid: Cj0KCQjw-relay-gclid`, `fbclid: IwAR-relay-fbclid`,
  `utmSource: google`, `landingUrl` = sayfa URL'si; `lead_consents` `kvkk/true/2026-01`.
- **Yerel el testi** (`crm-webhook-smoke` + `web-form-relay-smoke`, curl ile aktarıcıya form POST):
  `is_test=1`, `gclid=SMOKE-gclid-001`, `fbclid=SMOKE-fbclid-001`, `_fbp` ve `_gcl_aw` çerezleri →
  aktarıcı logu `relay: iletildi (inserted)`, CRM logu `form: web gönderimi … isTest: true` → 4 sn sonra
  `reklam lead'i açıldı (provider web)`. `GET /api/pipeline/leads?includeTest=1`: `source: web_form`,
  `isTest: true`, `extraAnswers.page_url` reklam URL'si.
- **Gerçek sitede:** MarcaDM GTM çerez kurulumu ve aktarıcının site sunucusunda çalışması (madde 13, 15)
  tamamlanınca runbook bölüm 5 adım 1 ile tekrarlanır. **Bekliyor.**

### 2. CRM kesintisinde hiçbir form gönderimi kaybolmuyor

- **Otomatik:** yukarıdaki relay testi (CRM kapalı → kuyruk → açılınca teslim → duplicate güvenli).
- **Yerel el testi:** CRM süreci durduruldu (`8787` yanıt vermiyor) → aktarıcıya form → `200 {"ok":true}`,
  `GET /health` → `queued: 1`, `queue/2026-10-30T07-37-39…json` dosyası; CRM yeniden başlatıldı → 11 sn sonra
  aktarıcı logu `relay: iletildi (inserted, attempts: 3)`, `queued: 0`; lead "Kesinti Musterisi" gelen kutusunda.
- Tasarım notu: gönderim CRM'e denenmeden **önce** diske yazılır; aktarıcı süreci çökse bile dosya kalır.

### 3. Lead, Meta ve Google lead'leriyle aynı gelen kutusunda, "Web" rozetiyle görünüyor

- **Tarayıcı** (satışçı `yusa`): gelen kutusunda "Web Form Musteri · Web Padel Kulubu" satırı **Web** rozetiyle,
  Google ("Ayşe Demir") ve Manuel lead'lerin arasında; TR, Yeni lead, Ortak havuz (territory_rules boş).
  Ekran görüntüsü alındı (2026-10-30 10:37). Rozet, ikon ve renk Faz 1'den beri `src/pipeline/bits.tsx`,
  `pipeline.css .src-web_form`, `i18n source.web_form` ("Web"/"Web").

## Bitti tanımı (Genel plan) — bu faz

- [x] İş kuralı domain katmanında ve testli (`parseConsents` sales-pipeline/domain; eşleme
      `integration-settings/domain`; imza ve gövde ayrıştırma adaptörde saf ve testli)
- [x] Dış çağrı bir port arkasında, sahte uygulamayla testli (aktarıcı `fetchImpl`/`now` enjekte; CRM tarafı
      `InboxRepository` bellek içi + PGlite; `LeadRepository.saveConsents` iki uygulama)
- [x] Logda kişisel veri yok (CRM logları yalnız `submissionId`, durum, neden; aktarıcı logları yalnız
      kimlik ve hata metni; kuyruk dosyaları form verisi taşır — runbook'ta erişim ve temizlik notu)
- [x] Hata türü sınıflandırılmış (CRM: 401 nedenleri missing/malformed/stale/mismatch; aktarıcı: 429/5xx/ağ
      geçici → yeniden dene, 400/401/413 kalıcı → `failed/`)
- [x] Config ve secret kodda değil (`WEB_FORM_HMAC_KEY` yalnız bootstrap `readSecret` ve aktarıcı ortamı;
      `.env.example` yer tutucu; launch config'teki değerler sahte)
- [x] Arayüz metinleri TR ve EN (yeni arayüz metni yok; "Web" rozeti mevcut)
- [x] ADR yazıldı (ADR-0010)

## Bilinen eksikler ve sonraki adımlar

1. **Site tarafı konuşlandırma** (madde 13): unixpadel.com'un teknolojisi belirsiz; aktarıcı Node ise doğrudan,
   değilse `lib.mjs` sözleşmesine göre çevrilir. Gerçek sitede kriter 1 ve 2 tekrarlanır.
2. **GTM çerezleri** (madde 15): çerez adları MarcaDM kurulumuna göre `RELAY_COOKIE_MAP` ile ayarlanır;
   `fbclid` için GTM'in `_fbc` üretmesi ya da gizli alana yazması gerekir.
3. **Aydınlatma metni sürümü ve onay türleri** (madde 16) hukuk görüşüne bağlı; kod serbest tür kabul eder.
4. **Kuyruk dosyaları kişisel veri içerir;** `failed/` klasörünün temizliği elle. Saklama süresi hukuk görüşüyle.
5. **Aktarıcı tek süreç içindir** (dosya kuyruğu); site birden çok sunucuda çalışıyorsa her sunucu kendi
   kuyruğunu tutar, bu yeterlidir (dedupe CRM'de).
6. **Admin "failed" satırlarını ve `failed/` dosyalarını görme** ekranı Faz 6.
7. Faz 2'deki eksikler (hosting, Meta token, Google anahtarı, SMTP, `territory_rules`) sürüyor.
