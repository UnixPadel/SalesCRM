# ADR-0012: Google geri bildirimi — Data Manager API kimlik doğrulama ve istek biçimi

- Durum: Kabul edildi
- Tarih: 2026-10-30
- Karar verenler: Yazılım (Elshan)

## Bağlam

Faz 5 iş emri: "Nitelikli" ve "Kazanıldı" aşamaları Google Ads'e dönüşüm olarak gitsin; Data Manager API'nin
kimlik doğrulama yöntemi ve istek biçimi faz başında resmi belgeden doğrulansın; Google, Meta koduna dokunmadan
eklensin. Google Ads API'nin eski çevrimdışı dönüşüm yolu kapsam dışı (yeni kurulumlara kapalı; Google
15 Haziran 2026'dan itibaren bu yüklemeleri Data Manager API'ye taşıyor).

## Belgeden doğrulananlar (2026-10-30)

| Konu | Doğrulanan | Kaynak |
|---|---|---|
| Uç | `POST https://datamanager.googleapis.com/v1/events:ingest`; istek başına ≤ 2000 olay, ≤ 10 hedef; olay başına ≤ 10 kullanıcı kimliği | [events:ingest](https://developers.google.com/data-manager/api/reference/rest/v1/events/ingest), [Limitler](https://developers.google.com/data-manager/api/devguides/limits) |
| Kimlik doğrulama | OAuth 2.0, kapsam `https://www.googleapis.com/auth/datamanager`; kullanıcı hesabı ya da servis hesabı; servis hesabı e-postası Google Ads hesabına (ya da üst yönetici hesabına) kullanıcı olarak eklenir; geliştirici token'ı gerekmez; Data Manager API Cloud projesinde etkinleştirilir | [Erişim kurulumu](https://developers.google.com/data-manager/api/devguides/quickstart/set-up-access) |
| Hedef | `destinations[].operatingAccount: { accountType: "GOOGLE_ADS", accountId: "<10 hane>" }`, isteğe bağlı `loginAccount`, `productDestinationId` = dönüşüm işlemi kimliği; dönüşüm işlemi tipi `UPLOAD_CLICKS`, kaynağı "Web sitesi (tıklamalardan içe aktar)" | [Destination](https://developers.google.com/data-manager/api/reference/rest/v1/Destination), [Çevrimdışı dönüşüm gönderme](https://developers.google.com/data-manager/api/devguides/events/google-ads/offline/send-events) |
| Olay | `eventTimestamp` RFC 3339 (ofsetli), `transactionId` tekilleştirme (ilk gelen sayılır, sonrakiler düzeltme), `eventSource` zorunlu (WEB, APP, IN_STORE, PHONE, MESSAGE, OTHER), `userData.userIdentifiers[]` (`emailAddress`, `phoneNumber` SHA-256), `adIdentifiers.gclid/gbraid/wbraid`, `conversionValue`, `currency`, `consent.adUserData/adPersonalization` (`CONSENT_GRANTED`/`CONSENT_DENIED`), istek düzeyinde `encoding: HEX` | [events:ingest](https://developers.google.com/data-manager/api/reference/rest/v1/events/ingest), [UserData](https://developers.google.com/data-manager/api/reference/rest/v1/UserData), [Consent](https://developers.google.com/data-manager/api/reference/rest/v1/Consent), [Encoding](https://developers.google.com/data-manager/api/reference/rest/v1/Encoding) |
| Normalleştirme | E-posta: küçük harf, baştaki/sondaki/aradaki boşluklar silinir; `gmail.com` ve `googlemail.com`'da @ öncesi noktalar **ve `+` ile sonrası** silinir (`cloudy.sanfrancisco+shopping@gmail.com` → `cloudysanfrancisco@gmail.com`); diğer alan adlarında nokta ve `+` korunur. Telefon: E.164, `+` dahil (`(800)555-0100` → `+18005550100`). Sonra SHA-256, hex ya da Base64 | [Biçimlendirme](https://developers.google.com/data-manager/api/devguides/concepts/formatting) |
| Doğrulama modu | `validateOnly: true` isteği işlemeden hızlı hataları ve `fieldWarnings` döner; işleme eşzamansızdır (30 dk–24 sa), `requestStatus:retrieve` ile hedef başına durum (PROCESSING, SUCCESS, PARTIAL_SUCCESS, FAILURE) ve hata/uyarı sayıları; `validateOnly` istekleri sorgulanamaz. Bir olay doğrulamadan geçemezse **tüm istek** reddedilir | [Tanılama](https://developers.google.com/data-manager/api/devguides/diagnostics) |
| Hız sınırı | 300 istek/dk, 100.000/gün (proje başına); aşımda 429 `RESOURCE_EXHAUSTED`; üstel geri çekilme | [Limitler](https://developers.google.com/data-manager/api/devguides/limits) |
| Pencereler | Data Manager belgesinde gün sayısı yok. Google Ads yardımı: GCLID'li yükleme son tıklamadan 90 gün sonra içe alınmaz; yalnız e-posta/telefonla eşleşen (enhanced conversions for leads) 63 gün | [İçe aktarma kuralları](https://support.google.com/google-ads/answer/15081888), [Enhanced conversions for leads](https://support.google.com/google-ads/answer/15713840?hl=en) |
| Örnek hash değerleri | Google belgeleri SHA-256 **çıktı** örneği yayımlamıyor; yalnız normalleştirme girdi/çıktı örnekleri var | [Biçimlendirme](https://developers.google.com/data-manager/api/devguides/concepts/formatting) |

## Karar

1. **Kimlik:** servis hesabı. Anahtar JSON'u `GOOGLE_DM_SERVICE_ACCOUNT_KEY` ortam değişkeninde (düz JSON ya da base64);
   RS256 imzalı JWT ile `https://oauth2.googleapis.com/token` üzerinden erişim token'ı, yaklaşık 1 saat önbellek,
   kütüphanesiz (`node:crypto`). Google anahtar yerine impersonation öneriyor; hosting kararı (ADR-0005) verilince
   Workload Identity / ADC'ye geçiş yalnız token sağlayıcıyı değiştirir, istemciyi değil.
2. **Hedef ayarları:** `integration_settings` → `google/customer_id`, `google/login_customer_id` (yönetici hesabı,
   boş olabilir), `google/outbound_enabled`; dönüşüm işlemi kimlikleri `platform_stage_mappings` (`google`,
   yalnız QUALIFIED ve WON; seed `0008` kapalı ve yer tutucu, MarcaDM kimlikleri verince açılır). Diğer aşamalar
   `skipped (mapping_missing)`.
3. **Hangi lead'ler:** `google_form` ve `web_form` (`GOOGLE_SEND_SOURCES`). Meta formu lead'inde Google tıklaması
   yoktur; yalnız e-posta eşleşmesiyle göndermek Meta lead'ini Google dönüşümü saymak olur → `no_match_key`.
4. **Pencere kontrolü** `prepare` içinde (saf): taban = tıklama zamanı (`click_at`), yoksa lead oluşturma zamanı;
   `gclid|gbraid|wbraid` varsa `GOOGLE_CLICK_WINDOW_DAYS` (90), yalnız e-posta/telefon varsa
   `GOOGLE_USER_DATA_WINDOW_DAYS` (63); aşımda `skipped (expired)`. Sınır dahil: 90. gün geçerli, 91. gün değil.
5. **Payload:** `transactionId` = aşama olayı kimliği; `eventSource` `GOOGLE_EVENT_SOURCE` (varsayılan WEB);
   `eventTimestamp` `GOOGLE_EVENT_TIMEZONE` (Europe/Istanbul) ofsetiyle; WON'da `conversionValue` + `currency`;
   `consent` iki alan `CONSENT_GRANTED` (dağıtıcının onay filtresi kapı; hukuk görüşü `adPersonalization`'ı
   ayırabilir). Hash hex, `encoding: HEX`.
6. **Doğrulama modu:** `GOOGLE_DM_VALIDATE_ONLY=1` staging'de `validateOnly: true`; satır `sent` işaretlenir, Google
   işlemez, açılışta uyarı loglanır. Canlıda boş.
7. **Yanıt sınıflandırması:** 2xx ok; 429/5xx/ağ/zaman aşımı retry; 400/401/403/404 dead (Faz 4'ün toplu→tek tek
   yeniden denemesi geçerli). `requestId` loglanır; eşzamansız tanılama sorgusu Faz 6 paneline.
8. **Meta koduna dokunulmaz:** Google yalnız `PlatformSender` portunu uygular; `builders/meta`, `adapters/meta-capi`
   ve `lead-intake/adapters/meta` altında bu fazda değişen satır yoktur (kabul raporunda `git diff --stat`).

## Seçenekler ve neden seçilmediği

- **Google Ads API `uploadClickConversions`:** geliştirici token'ı ve ayrı istemci ister; Google yeni kurulumlar için
  Data Manager'ı işaret ediyor ve 2026 ortasında eski yolu kapatıyor. Kapsam dışı.
- **`google-auth-library` / resmi Node istemcisi:** bağımlılık ve bakım yükü; tek uç ve servis hesabı JWT akışı
  40 satırda kütüphanesiz yazılıyor, sahte fetch ile test ediliyor. ADC gerekirse eklenir.
- **Meta formu lead'lerini de Google'a göndermek:** e-posta eşleşmesiyle teknik olarak mümkün, atıf açısından
  tartışmalı; MarcaDM kararıyla config ile açılır.
- **Pencereyi Google'ın hatasına bırakmak:** süresi geçen olay istekte diğerlerini de düşürür (tüm istek reddedilir)
  ve 90 gün sonra GCLID silinir; yerel kontrol gereksiz istek ve `dead` satır üretmez.
- **Tüm aşamaları göndermek:** Google dönüşüm işlemi başına bir hedef ister; iş emri yalnız Nitelikli ve Kazanıldı.

## Sonuçlar

- Yazılım dışı: Cloud projesi + API etkinleştirme + servis hesabı + Google Ads'e kullanıcı ekleme (IT/MarcaDM),
  müşteri kimliği ve iki dönüşüm işlemi kimliği (MarcaDM), `ENABLED_PROVIDERS=meta,google` (IT). Karar listesi
  madde 21–23.
- Google Ads'de dönüşüm işlemi "tıklamalardan içe aktar" tipinde açılmalı; enhanced conversions for leads için
  hesapta ilgili ayar açık olmalı (MarcaDM).
- Faz 6 paneli `requestStatus:retrieve` ile eşzamansız sonuçları gösterebilir; bu fazda yalnız log.
