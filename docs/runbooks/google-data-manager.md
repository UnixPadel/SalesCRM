# Runbook — Google geri bildirimi (Data Manager API)

Faz 5. "Nitelikli" ve "Kazanıldı" aşamaları Google Ads'e dönüşüm olarak gider. Faz 4'ün dağıtıcısı aynen kullanılır;
Google yalnız bir gönderici (PlatformSender) ekler (ADR-0012).

```
aşama değişikliği ─▶ outbound_conversion_events (provider google) ─▶ dağıtıcı (her dakika)
   ├─ filtreler (acil durdurma, geri alma, test, manuel, onay, eşleme) → skipped
   ├─ Google göndericisi: kaynak (google_form, web_form) · eşleştirme anahtarı · pencere (90 / 63 gün) → skipped
   └─ POST https://datamanager.googleapis.com/v1/events:ingest  (Bearer servis hesabı token'ı, HEX)
```

## 1. Ön koşullar ve teslimler

| Ne | Kim | Nereye |
|---|---|---|
| Google Cloud projesi (Unixpadel hesabında), **Data Manager API etkin** | IT + MarcaDM | — |
| Servis hesabı ve JSON anahtarı; servis hesabı e-postası Google Ads hesabına (ya da yönetici hesabına) **kullanıcı olarak eklenir** (standart erişim yeterli) | IT + MarcaDM | Anahtar JSON → hosting ortam değişkeni `GOOGLE_DM_SERVICE_ACCOUNT_KEY` (tek satır JSON ya da base64) |
| Google Ads müşteri kimliği (10 hane) ve varsa yönetici (MCC) hesabı kimliği | MarcaDM | `integration_settings` `google/customer_id`, `google/login_customer_id` (ya da `GOOGLE_ADS_CUSTOMER_ID`) |
| İki dönüşüm işlemi: "Nitelikli Lead" ve "Kazanıldı"; tip **tıklamalardan içe aktar** (`UPLOAD_CLICKS`), kaynak "Web sitesi (tıklamalardan içe aktar)"; enhanced conversions for leads açık | MarcaDM | Dönüşüm işlemi **kimlikleri** → `platform_stage_mappings` (bölüm 3) |
| `ENABLED_PROVIDERS=meta,google` | IT | Hosting ortam değişkeni; olmadan Google satırı hiç açılmaz |

Geliştirici token'ı gerekmez. Anahtar yoksa Google göndericisi kurulmaz; satırlar `pending` bekler ve anahtar girilince gider.

```sql
UPDATE integration_settings SET value = '1234567890', updated_at = now() WHERE provider = 'google' AND key = 'customer_id';
UPDATE integration_settings SET value = '',           updated_at = now() WHERE provider = 'google' AND key = 'login_customer_id';
```

## 2. Staging: doğrulama modu

`GOOGLE_DM_VALIDATE_ONLY=1` ile her istek `validateOnly: true` gider: Google biçimi ve yetkiyi denetler, hata varsa 400 döner,
yoksa hiçbir şey işlemez. Satırlar `sent` işaretlenir (istek kabul edildi), log `validateOnly: true` yazar. **Canlıda boş.**

Doğrulama (kabul kriteri 1): staging'de bir Google formu test lead'i (gclid'li) QUALIFIED ve WON'a taşınır; 10 dk sonra
log `data manager: istek kabul edildi (events: 2, validateOnly: true)`. Sonra `GOOGLE_DM_VALIDATE_ONLY` kaldırılıp aynı
akış tekrarlanır; 30 dk–24 sa içinde Google Ads → Hedefler → Dönüşümler → **Tanılama** raporunda eşleşmeler görünür
(gclid eşleşmesi hemen, e-posta/telefon eşleşmesi gecikmeli). Loglanan `requestId` ile `requestStatus:retrieve` sorgusu Faz 6.

## 3. Aşama → dönüşüm işlemi

Seed `0008` iki satırı **kapalı ve yer tutucu** açar; kimlikler gelince:

```sql
UPDATE platform_stage_mappings SET platform_event_name = '<NITELIKLI_LEAD_ACTION_ID>', enabled = true
 WHERE provider = 'google' AND stage_code = 'QUALIFIED';
UPDATE platform_stage_mappings SET platform_event_name = '<KAZANILDI_ACTION_ID>', enabled = true
 WHERE provider = 'google' AND stage_code = 'WON';
```

Diğer aşamalar Google'a gitmez (`skipped: mapping_missing`). Kapalı satır `mapping_disabled`.

## 4. Google'a özgü atlama nedenleri

| Neden | Ne zaman |
|---|---|
| `no_match_key` | lead kaynağı `GOOGLE_SEND_SOURCES` dışında (varsayılan: Meta formu lead'i; Google tıklaması taşımaz), ya da ne tıklama kimliği ne hash'lenebilir e-posta/telefon var |
| `expired` | tıklama kimliğiyle: tıklamadan (yoksa lead oluşturmadan) `GOOGLE_CLICK_WINDOW_DAYS` (90) günden fazla geçti; yalnız e-posta/telefon: `GOOGLE_USER_DATA_WINDOW_DAYS` (63). 90. gün geçerli, 91. gün değil |

Dağıtıcının ortak nedenleri (emergency_stop, undone, test_lead, manual_source, no_consent, mapping_*) Faz 4 runbook'unda.

## 5. Payload

`transactionId` = aşama olayı kimliği (Google aynı kimlikle gelen sonraki olayı düzeltme sayar); `eventTimestamp`
RFC 3339, `GOOGLE_EVENT_TIMEZONE` (Europe/Istanbul) ofsetiyle; `eventSource` `GOOGLE_EVENT_SOURCE` (WEB);
`userData.userIdentifiers`: e-posta (küçük harf, boşluksuz, gmail/googlemail'de nokta ve `+` sonrası silinir) ve telefon
(E.164, `+` dahil) SHA-256 hex; `adIdentifiers.gclid|gbraid|wbraid`; WON'da ve girildiyse PROPOSAL'da `conversionValue` + `currency`;
`consent.adUserData` ve `adPersonalization` `CONSENT_GRANTED` (dağıtıcının onay filtresi kapı). İstek: dönüşüm işlemi
başına bir hedef (`operatingAccount` GOOGLE_ADS + müşteri kimliği, varsa `loginAccount`), `encoding: HEX`.
Örnek: `src/modules/ad-feedback/builders/google/__snapshots__`.

## 6. İşletme

- **Acil durdurma:** `UPDATE integration_settings SET value = 'false' WHERE provider = 'google' AND key = 'outbound_enabled';`
- **Hız sınırı:** 300 istek/dk, 100.000/gün (proje); 429 geçici hata sayılır, 1-5-30-120-720 dk yeniden.
- **İzleme:** Faz 4 runbook'undaki sorgular `provider = 'google'` ile; `expired` sayısı: `SELECT count(*) FROM
  outbound_conversion_events WHERE provider = 'google' AND skip_reason = 'expired';`
- **Anahtar döndürme:** yeni anahtar oluştur → ortam değişkenini güncelle → yeniden başlat → eskiyi Cloud Console'da sil.
  Token 1 saat önbellekte; eski anahtar silinince yeni token yeni anahtarla alınır.
- **Geriye doldurma:** `npx tsx scripts/outbox-backfill.ts --provider google --since 2026-10-28 --sources google_form,web_form --dry-run`
  (Faz 2'den beri biriken Google formu ve web formu lead'leri; pencere kontrolü süresi geçenleri `expired` yapar).
