# Faz 5 — Google geri bildirimi: kabul raporu

Tarih: 2026-10-30. Kapsam: Faz 5 iş emri (Data Manager API doğrulaması ve ADR, Google normalleştirmesi, saf payload
builder, adaptör, pencere kontrolü, dağıtıcıya Google kanalı; testler). Kapsam dışı: teklif stratejisi ve optimizasyon
hedefi (MarcaDM), Google Ads API'nin eski çevrimdışı dönüşüm yolu.

Onaylanan varsayılanlar (2026-10-30, Elshan): servis hesabı JWT (kütüphanesiz); hedef ayarları `integration_settings`
ve kapalı seed; kaynak filtresi `google_form, web_form`; pencere `prepare` içinde (90 / 63 gün, taban tıklama > lead
oluşturma > aşama zamanı); `transactionId` = aşama olayı, `eventSource` WEB, Europe/Istanbul ofseti, onay GRANTED;
staging `validateOnly`; yanıt sınıflandırması Faz 4 ile aynı; Meta koduna dokunulmaz.

## Görevler ve commit'ler

| Görev | Commit | Durum |
|---|---|---|
| Data Manager API kimlik doğrulama ve istek biçimi resmi belgeden doğrulanır; ADR yazılır | `docs: ADR-0012` (53cfcc3) | Tamam — uç, kapsam, servis hesabı, hedef/olay alanları, normalleştirme, validateOnly, tanılama, limitler, 90/63 gün; kaynak bağlantılarıyla |
| Google normalleştirme stratejisi (e-posta küçük harf, gmail/googlemail'de noktalar; telefon E.164 `+` dahil) → SHA-256 | `ad-feedback/builders/google` | Tamam — belge gereği gmail'de `+` sonrası da silinir; iş emrinden bir adım ileri, ADR'de not |
| Saf payload builder: gclid/gbraid/wbraid, hash'li e-posta ve telefon, dönüşüm işlemi kimliği, saat dilimli dönüşüm zamanı; WON'da değer ve para birimi | aynı | Tamam — `buildGoogleEvent`, `buildGoogleRequest`, RFC 3339 ofset; 3 snapshot |
| Data Manager API adaptörü; doğrulama modu staging'de | `ad-feedback/adapters/google-data-manager` | Tamam — servis hesabı token'ı (RS256 JWT, 1 sa önbellek), `events:ingest` istemcisi, `GOOGLE_DM_VALIDATE_ONLY` |
| Pencere kontrolü: GCLID 90 gün, yalnız e-posta/telefon ayrı pencere; ikisi config'te; aşımı `skipped: expired` | `builders/google` + adaptör + `ad-feedback: expired` | Tamam — `GOOGLE_CLICK_WINDOW_DAYS`, `GOOGLE_USER_DATA_WINDOW_DAYS`; `expired` nedeni |
| Dağıtıcıya Google kanalı; Meta adaptörü ve builder'ı değişmez | `bootstrap` | Tamam — gönderici kaydı, `ENABLED_PROVIDERS=meta,google`; dağıtıcı kodu değişmedi |
| Hazırlık: `OutboundStageEvent.lead.createdAt`, seed 0008 (kapalı yer tutucu), ayarlar | `sales-pipeline`, `db` | Tamam |

Commit kimlikleri `git log --oneline 3e159ac..HEAD`.

## Test planı

| Madde | Nerede | Sonuç |
|---|---|---|
| Hash için Google belgesindeki örnek değerler | `builders/google/google-builder.test.ts`: kılavuzdaki girdi/çıktı örnekleri (`cloudy.sanfrancisco+shopping@gmail.com` → `cloudysanfrancisco@gmail.com`, `user.name+NYC@Example.com` → `user.name+nyc@example.com`, `(800)555-0100` → `+18005550100`); Google **SHA-256 çıktı örneği yayımlamadığı** için özetler bağımsız hesaplanıp sabitlendi | Yeşil |
| Aynı telefon için Meta ve Google hash'leri farklı | aynı dosya: `+90 532 123 45 67` → Meta `7e330815…` (`905321234567`), Google `57c4176f…` (`+905321234567`) | Yeşil |
| Pencere sınırı: 89, 90 ve 91. gün | aynı dosya (`checkUploadWindow`: 89 ve 90 geçerli, 91 expired; 63 gün yalnız e-posta/telefon, taban lead oluşturma); adaptör testi (90. gün hazır, 91. gün expired) | Yeşil |
| Dağıtıcı senaryoları Google için tekrarlanır | `adapters/google-data-manager/dispatcher-google.test.ts`: gerçek dağıtıcı + gerçek gönderici + sahte uç: 200 (iki hedef tek istek), 400 tek/toplu, 429→500→zaman aşımı→ağ→503→500 yeniden deneme ve dead, expired/no_match_key, geri alınan olay gitmiyor, kilit süresi (çift gönderim yok) | Yeşil |
| İstemci ve token | `google-data-manager.test.ts`: JWT imzası RSA ile doğrulandı; token önbelleği; 200/400/401/403/404/429/500/503/zaman aşımı/ağ/token hatası sınıflandırması | Yeşil |
| Kompozisyon | `bootstrap/adFeedbackGoogle.test.ts`: gerçek Google formu lead'i NEW → QUALIFIED → WON; Google'a yalnız Nitelikli ve Kazanıldı (gclid, gmail kuralıyla hash, E.164 telefon, değer, validateOnly), diğer üç aşama `mapping_missing`; Meta'ya beş olay aynı turda | Yeşil |

Komutlar ve çıktı (2026-10-30):

```
npm run verify            → lint 0 hata / 11 uyarı (Faz 0 öncesi arayüz kodu), Prettier temiz, tsc (iki proje) temiz,
                            depcruise 0 ihlal (1 bilgi: server/authDb.d.mts orphan), secretlint temiz;
                            integration-settings seed testi 0008 ile güncellendi → 33 test dosyası / 329 test yeşil
npx vitest run --coverage → domain + application + builders satır kapsamı %99.43 (eşik %90), fonksiyon %100
git diff --stat 3e159ac..HEAD -- src/modules/ad-feedback/builders/meta src/modules/ad-feedback/adapters/meta-capi \
    src/modules/lead-intake/adapters/meta → boş (Meta modülünde değişen satır yok)
```

## Kabul kriterleri ve doğrulama

### 1. Google Ads → Dönüşümler → Tanılama raporunda eşleşmeler görünüyor

- **Yerel karşılık (otomatik):** kompozisyon testinde sahte `events:ingest` ucuna giden istek belgeyle birebir:
  `destinations[].operatingAccount { GOOGLE_ADS, 1234567890 }`, `productDestinationId` dönüşüm işlemi kimliği,
  `encoding: HEX`, olaylarda `adIdentifiers.gclid`, hash'li `emailAddress`/`phoneNumber`, RFC 3339 ofsetli
  `eventTimestamp`, `eventSource: WEB`, `consent`, Kazanıldı'da `conversionValue`/`currency`.
- **Gerçek doğrulama:** Cloud projesi, servis hesabı, müşteri kimliği ve dönüşüm işlemi kimlikleri (madde 21–22) gelince
  runbook bölüm 2 ile. **Bekliyor.**
- **Yerel smoke (2026-10-30):** `crm-webhook-smoke` `ENABLED_PROVIDERS=meta,google` ile açıldı; log `ad-feedback hazır
  (meta: false, google: false, enabledProviders: [meta, google])` ve "gönderici yok, satırlar pending bekler" uyarısı.
  Anahtar yokken Google göndericisi bilerek kurulmaz; gerçek Google'a istek gitmedi.

### 2. Bu fazın PR'larında Meta modülünde değişen satır yok

```
git diff --stat 3e159ac..HEAD -- src/modules/ad-feedback/builders/meta src/modules/ad-feedback/adapters/meta-capi src/modules/lead-intake/adapters/meta
→ (boş)
```

Faz 5 tabanı 3e159ac (Faz 4'ün son commit'i). Meta builder'ı, CAPI adaptörü ve Meta lead-intake adaptörü değişmedi;
dağıtıcı (`ad-feedback/application/dispatcher.ts`) de değişmedi. Değişen ortak dosyalar: `application/dto.ts`
(`expired` nedeni), `application/fakes.ts` (örnek bağlama `createdAt`), `bootstrap/adFeedback.ts` (Google kaydı),
`bootstrap/adFeedback.test.ts` (tek satır: `providers` beklentisine `google: false`), sales-pipeline DTO'su (isteğe bağlı
`createdAt`). Mimari sınav geçti: Google yalnız `PlatformSender` portunu uyguladı.

## Bitti tanımı (Genel plan) — bu faz

- [x] İş kuralı saf ve testli (normalleştirme, pencere, builder; `prepare` içindeki filtre sırası)
- [x] Dış çağrı port arkasında, sahte uygulamayla testli (token ucu ve `events:ingest` sahte fetch; `TokenProvider` sahte)
- [x] Logda kişisel veri yok (istemci yalnız durum, `requestId`, olay sayısı; token ve anahtar hiç loglanmaz — anahtar
      okunamazsa yalnız hata türü)
- [x] Hata türü sınıflandırılmış (ok / retry / dead; token alınamaması ve müşteri kimliği eksikliği retry)
- [x] Config ve secret kodda değil (`GOOGLE_DM_SERVICE_ACCOUNT_KEY` yalnız bootstrap; müşteri ve dönüşüm işlemi kimlikleri
      tabloda; `.env.example` yer tutucu)
- [x] Arayüz metinleri TR ve EN (yeni arayüz metni yok)
- [x] ADR yazıldı (ADR-0012, faz başında)
- [x] Sözlük testi: çekirdekte "Google" / "Data Manager" yok (`createdAt` nötr ad)

## Bilinen eksikler ve sonraki adımlar

1. **Erişim ve kimlikler** (madde 21–22) gelmeden gönderim yok; satırlar `pending` birikir. Google formu ve web formu
   lead'leri için geriye doldurma `--provider google` ile; pencere kontrolü süresi geçenleri `expired` yapar.
2. **Servis hesabı anahtarı** yerine impersonation/ADC: Google'ın önerisi; hosting kararı (ADR-0005) sonrası yalnız
   `TokenProvider` değişir.
3. **Eşzamansız sonuç:** Google isteği kabul eder, işleme 30 dk–24 sa; `requestStatus:retrieve` sorgusu ve hata
   sayıları Faz 6 paneline. Bu fazda `requestId` loglanır.
4. **Onay alanları:** `adUserData`/`adPersonalization` hep GRANTED (dağıtıcı filtresi kapı); hukuk görüşüyle
   `marketing` onayı `adPersonalization`'a bağlanabilir.
5. **Meta formu lead'leri** Google'a gitmiyor (atıf kararı MarcaDM'de, madde 23); açılırsa yalnız e-posta/telefonla
   63 günlük pencere uygulanır.
6. Faz 2–4'ün yazılım dışı eksikleri sürüyor (hosting, Meta token/veri seti, Google anahtarı, SMTP, site aktarıcısı).

## Sonradan bulunan hatalar ve düzeltmeler (2026-11-02)

Rehberle (MarcaDM, "Lead → CRM Entegrasyon Rehberi") kod karşılaştırılınca üç eksik çıktı; üçü de ayrı commit'le
kapatıldı. Bu rapordaki ve Faz 4 raporundaki "uçtan uca" sonuçları 1. maddedeki hatayı **kapsamıyordu**: testler
kendi `IntegrationSettings` nesnesini kurduğu için sunucunun gerçek bağlantısı sınanmamıştı.

| # | Eksik | Etki | Düzeltme | Test |
|---|---|---|---|---|
| 1 | `src/bootstrap/leadIntake.ts` `IntegrationSettings`'i aşama eşlemesi deposu olmadan kuruyordu; `server/index.mjs` aynı nesneyi ad-feedback'e verir | Canlıda her outbox satırı `skipped: mapping_missing`; Meta'ya ve Google'a hiçbir aşama gitmezdi | `pgStageMappingRepository(db)` bağlandı | `src/bootstrap/leadIntake.test.ts`: sunucuyla aynı sırada kurulum, Meta lead'inin NEW ve CONTACTED olayları `sent: 2, skipped: 0` |
| 2 | Lead'in `createdAt`'i işleme anıydı; Meta `created_time` ve web formu `submitted_at` okunup atılıyordu, Google `null` | Yedek senkronla gelen lead'in yaşı yanlış; Google 90/63 gün penceresi ve rehberin `lead_submit_time` kuralı yanlış tabandan | `CreateLeadInput.createdAt`; `CreateLeadFromAd` `submittedAt` geçirir; Google adaptörü inbox'a düşüş anını (`AdapterContext.receivedAt`) kullanır; NEW olayı ve varsayılan onay zamanı aynı tarihi alır; gelecekteki tarih şimdiye düşer | `application.test.ts` "createdAt: …", `intake.test.ts` "lead'in oluşturulma zamanı…", `google.test.ts` `submittedAt` = `receivedAt` |
| 3 | Teklif tutarı yalnız WON'da alınıyordu; rehberin veri modeli tutarı teklifte de platformlara gönderir | Teklif aşamasında değer sinyali yok | `planStageChange` PROPOSAL'da isteğe bağlı tutar kabul eder; Meta ve Google builder'ları PROPOSAL'daki tutarı taşır; arayüzde Teklif penceresi (boş geçilebilir), Kazanıldı penceresi son teklif tutarıyla dolu açılır | `transition.test.ts` "PROPOSAL", `meta-builder.test.ts` ve `google-builder.test.ts` "PROPOSAL: …" |

Not: 3. düzeltme Meta builder'ında bir satır değiştirdi; Faz 5'in "Meta modülünde değişen satır yok" kriteri Faz 5
commit'leri (3e159ac..78794d1) için geçerliliğini korur.

>>>

