# Runbook — Web sitesi formu (unixpadel.com → CRM)

İki yol vardır; ikisi de aynı imzayı, aynı anahtarı (`WEB_FORM_HMAC_KEY`), aynı gelen kutusunu ve aynı mükerrer
anahtarını (`web:<submission_id>`) kullanır:

- **Çekme modu (2026-11, birincil):** site talepleri kendi tarafında saklar; CRM'in worker'ı imzalı isteklerle çeker ve
  onaylar. CRM'in internete açık bir adresi gerekmez. **Bölüm 7.**
- **Push (Faz 3):** site sunucusundaki aktarıcı her gönderimi `POST /forms/web` ucuna iter. CRM'in internete açık
  olmasını ister; bugünkü dağıtımda (masaüstü uygulaması + worker) bu uca ulaşılamaz. Bölüm 1–6.

Faz 3. Site formu tarayıcıdan değil **site sunucusundan** CRM'e gönderilir; imza anahtarı tarayıcıya inmez.
Referans uygulama: `integrations/web-form-relay/` (bağımlılıksız Node süreci). Site başka dilde çalışıyorsa
aynı sözleşme o dilde uygulanır (bölüm 3 ve 4).

```
tarayıcı ──form POST──▶ site sunucusu (aktarıcı) ──diske yaz──▶ HMAC imzalı POST /forms/web ──▶ CRM inbox ──▶ lead
                          │ CRM kapalıysa kuyrukta bekler, 30 sn'de bir yeniden dener
                          └ honeypot doluysa hiç göndermez
```

## 1. Anahtar üretimi ve dağıtımı

```bash
npm run secrets:key
```

Çıktı iki yere girer, başka hiçbir yere yazılmaz (ADR-0004):

- CRM hosting ortam değişkeni `WEB_FORM_HMAC_KEY`
- Site sunucusunda aktarıcının ortam değişkeni `WEB_FORM_HMAC_KEY`

Anahtar yoksa CRM ucu `503 Web formu ucu yapılandırılmadı` döner; aktarıcı hiç başlamaz.

## 2. Aktarıcıyı site sunucusunda çalıştırma

```bash
WEB_FORM_HMAC_KEY=<anahtar> \
CRM_FORM_URL=https://<crm-adresi>/forms/web \
RELAY_PORT=8790 \
RELAY_QUEUE_DIR=/var/lib/web-form-relay/queue \
RELAY_FORM_ID=contact \
RELAY_CONSENT_TEXT_VERSION=2026-01 \
RELAY_THANKS_URL=https://www.unixpadel.com/tesekkurler \
node integrations/web-form-relay/relay.mjs
```

- `RELAY_QUEUE_DIR` kalıcı diskte olmalı; CRM kesintisinde gönderimler burada bekler. Süreç yeniden
  başlasa da dosyalar durur ve ilk tikte gönderilir.
- Süreç yöneticisi (systemd, pm2) ile daima açık tutulur; `GET /health` → `{ ok, queued }`.
- Form `fetch` ile gönderiliyorsa `RELAY_ALLOWED_ORIGIN=https://www.unixpadel.com` (CORS). Klasik form
  POST'unda gerekmez; yanıt `RELAY_THANKS_URL`'e 303 yönlendirmedir.
- `RELAY_CONSENT_TEXT_VERSION` aydınlatma metni her değiştiğinde güncellenir; her onay kaydına yazılır
  (`lead_consents.text_version`). Hukuk görüşü (docs/decisions.md madde 6) sürüm biçimini belirleyebilir.

## 3. Site formunun alanları

Form, aktarıcının `POST /submit` ucuna `application/x-www-form-urlencoded` (ya da JSON) gönderir.

| Alan adı | Anlamı | Not |
|---|---|---|
| `name` (ya da `full_name`, `first_name` + `last_name`) | Ad soyad | zorunlu |
| `email`, `phone` | İletişim | en az biri zorunlu; telefon ülkesiz yazılırsa `country`'den ya da TR varsayılanından çözülür |
| `country`, `city`, `company`, `product_interest` (`interest`), `message` (`notes`) | Lead alanları | `form_field_mappings` sağlayıcı `web` (seed `0005`) |
| `consent_kvkk`, `consent_marketing`, `consent_<tür>` | Onay kutuları | `on`/`1`/`true` → verildi; boş/yok → verilmedi. `lead_consents` |
| `website` | **Honeypot** | CSS ile gizli, boş kalmalı; doluysa gönderim atılır (`RELAY_HONEYPOT_FIELD` ile ad değişir) |
| `gclid`, `gbraid`, `wbraid`, `fbclid`, `fbc`, `fbp`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`, `landing_url`, `click_at` | Tıklama kimlikleri | gizli alanlar; GTM çerezlerden doldurur. Boşsa aktarıcı çerezlerden okur (aşağıda) |
| `form_id`, `page_url`, `is_test` | Üst veri | isteğe bağlı; `page_url` yoksa `Referer` kullanılır |
| diğer her alan | Ek yanıt | `extra_answers` içinde saklanır; Faz 6 ekranı ya da SQL ile lead alanına bağlanabilir |

**Çerezler (MarcaDM GTM kurulumu):** gizli alan boşsa aktarıcı `Cookie` başlığından okur:
`_gcl_aw` → `gclid` (biçim `GCL.<ts>.<id>`, yalnız kimlik alınır), `_gcl_gb` → `gbraid`, `_gcl_gs` → `wbraid`,
`_fbc`, `_fbp`, `utm_*`, `landing_url`. Çerez adları farklıysa `RELAY_COOKIE_MAP` (JSON) ile eşlenir.
`fbclid` çerezde durmaz; GTM `_fbc` üretir ya da sayfa URL'sinden gizli alana yazar.

Örnek gizli alanlar (GTM'in `dataLayer` ya da çerezden doldurduğu):

```html
<input type="hidden" name="gclid"><input type="hidden" name="fbclid">
<input type="hidden" name="fbc"><input type="hidden" name="fbp">
<input type="hidden" name="utm_source"><input type="hidden" name="utm_medium"><input type="hidden" name="utm_campaign">
<input type="hidden" name="landing_url">
<div style="position:absolute;left:-9999px" aria-hidden="true"><input name="website" tabindex="-1" autocomplete="off"></div>
```

## 4. CRM gövde sözleşmesi ve imza (başka dilde uygulamak için)

`POST https://<crm>/forms/web`, `Content-Type: application/json`, en fazla 256 KB:

```json
{
  "submission_id": "7f3a9c2e-4b1d-4e8a-9c6f-0a1b2c3d4e5f",
  "form_id": "contact",
  "submitted_at": "2026-03-01T09:58:30Z",
  "page_url": "https://www.unixpadel.com/iletisim?gclid=…",
  "fields": { "name": "Ayşe Demir", "email": "…", "phone": "…", "message": "…" },
  "attribution": { "gclid": "…", "fbclid": "…", "fbc": "…", "fbp": "…", "utm_source": "google", "landing_url": "…" },
  "consents": [{ "type": "kvkk", "granted": true, "text_version": "2026-01" }],
  "honeypot": "",
  "is_test": false
}
```

- `submission_id` site üretir (UUID). Aynı kimlik ikinci kez gelirse CRM `{"status":"duplicate"}` döner ve
  yeni lead açmaz; yeniden deneme bu yüzden güvenlidir.
- Başlıklar: `X-Webform-Timestamp: <Unix saniye>`, `X-Webform-Signature: sha256=<hex>`.
  İmza: `HMAC-SHA256(anahtar, "<timestamp>." + ham gövde)`; gövde bayt bayt aynı gönderilir.
  Zaman damgası CRM saatinden 300 saniyeden fazla sapıyorsa `401 stale`.
- Yanıtlar: `200 {"ok":true,"status":"inserted"|"duplicate"|"ignored"}`; `401` imza (`reason`: missing,
  malformed, stale, mismatch); `400` JSON değil / `submission_id` yok; `413` boyut; `429` hız (IP başına
  dakikada 120); `503` anahtar tanımsız. Aktarıcı 429/5xx ve ağ hatasında yeniden dener, 400/401/413'te
  dosyayı `queue/failed/` altına taşır ve loglar.

Node örneği: `integrations/web-form-relay/lib.mjs` içinde `signBody`. PHP eşdeğeri:
`hash_hmac('sha256', $ts . '.' . $rawBody, $key)`.

## 5. Doğrulama

1. **Reklam URL'sinden form:** siteyi `?gclid=TEST-gclid&fbclid=TEST-fbclid&utm_source=test` ile aç,
   formu doldur, `is_test` gizli alanını `1` yap (ya da test adı kullan). Gelen kutusunda "Test lead'leri"
   işaretliyken "Web" rozetli lead; `SELECT gclid, fbclid, utm_source FROM lead_attribution la JOIN leads l
   ON l.id = la.lead_id WHERE l.source = 'web_form' ORDER BY l.created_at DESC LIMIT 1;`
2. **CRM kesintisi:** CRM'i durdur, formu gönder → site "teşekkürler" sayfasına gider, aktarıcı logunda
   `CRM'e ulaşılamadı, kuyruğa alındı`, `GET /health` → `queued: 1`. CRM'i aç → en geç `RELAY_RETRY_SECONDS`
   sonra `relay: iletildi`, lead gelen kutusunda.
3. **Honeypot:** `website` alanını doldurup gönder → 200, aktarıcı logunda `honeypot dolu`, CRM'de satır yok.
4. **İmza:** aktarıcıyı yanlış anahtarla çalıştır → CRM logunda `form: imza reddedildi (mismatch)`,
   dosya `queue/failed/` altında. Doğru anahtarla dosyayı `queue/` köküne geri taşı → iletilir.

Yerel deneme: `.claude/launch.json` → `crm-webhook-smoke` (CRM, anahtar `smoke-web-form-secret`) ve
`web-form-relay-smoke` (aktarıcı, 8790). Aktarıcıya `WEB_FORM_HMAC_KEY=smoke-web-form-secret` verilmelidir.

## 6. Anahtar değiştirme

Yeni anahtar üret → önce CRM'de güncelle ve yeniden başlat → aktarıcıda güncelle ve yeniden başlat.
Aradaki saniyelerde aktarıcı 401 alır, dosyalar `failed/` altına düşer; yeni anahtar devreye girince
dosyaları `queue/` köküne geri taşı. Düşük trafikli saatte yapılır.

## 7. Çekme modu (site saklar, CRM çeker)

```
tarayıcı ──form──▶ site (WordPress eklentisi) ──talebi saklar──┐
                                                               │  her 2 dk
CRM worker ──imzalı POST <taban>/pending──────────────────────▶│
           ◀── en eskiden yeniye en çok 50 talep, more ────────┘
           ──▶ gelen kutusu (web:<submission_id>) ──▶ lead
           ──imzalı POST <taban>/ack (inserted | duplicate)──▶ site talebi "alındı" işaretler
```

Site tarafını başka ekip yazar; sözleşme **v1** tek taraflı değiştirilmez. Site uygulaması: `UnixPadel/web-unixpadel`
deposu, `wp-plugin/includes/crm-pull.php` (dal `feat/crm-pull`, 2026-11-16). Talepler WordPress'te "Quote requests"
(`upx_quote`) olarak saklanır; bu dosya öncesinde kaydedilmiş talepler metinlerinden ayrıştırılıp
`import_source: "wp-legacy"` ile gönderilir, çöp kutusundakiler hiç gönderilmez.

### 7.1 Sözleşme v1 (site sunar)

Taban `WEB_PULL_URL`, ör. `https://www.unixpadel.com/?rest_route=/unixpadel/v1/crm`. Uçlar `<taban>/pending` ve
`<taban>/ack`: `rest_route` değerinin sonuna eklenir (kalıcı bağlantılı adreste, ör. `/wp-json/unixpadel/v1/crm`, yola).
İkisi de `POST`, `application/json`. İmza push ile aynıdır (bölüm 4): `X-Webform-Timestamp`, `X-Webform-Signature:
sha256=<hex HMAC-SHA256(anahtar, "<timestamp>." + ham gövde)>`; fark 300 saniyeyi aşarsa `401 stale`.

- `/pending`: gövde `{"op":"pending","limit":50}` (1–100) → `200 {"ok":true,"items":[{"submission_id":"<uuid>",
  "payload":{…}}],"more":true|false}`. En eskiden yeniye; onaylanana kadar aynı öğe yine gelir.
- `/ack`: gövde `{"op":"ack","items":[{"submission_id":"<uuid>","status":"inserted"|"duplicate"}]}` →
  `200 {"ok":true,"acked":<n>,"unknown":["<uuid>"]}`. İdempotent.
- Hatalar: `401 {"ok":false,"reason":"missing|malformed|stale|mismatch"}`, `400` gövde/op hatalı, `429` hız,
  `503 {"ok":false,"error":"not_configured"}`.

`payload` (v1): `form_id` ("quote"), `submitted_at`, `page_url`, `is_test`, `honeypot` (""), `consents`
(`[{"type":"kvkk","granted":true,"text_version":"2026-01"}]`), `attribution` (`gclid`, `gbraid`, `wbraid`, `fbclid`,
`fbc`, `fbp`, `utm_*`, `landing_url`), `fields`. `submission_id` payload'da değil üst seviyededir; CRM onu payload'a
yazar ve push gövdesiyle aynı biçimde saklar.

### 7.2 Alanlar → lead

| `fields` anahtarı | Lead'de | Eşleme |
|---|---|---|
| `name` | Ad soyad | seed 0005 |
| `company`, `email`, `phone` | Firma, e-posta, telefon | seed 0005 |
| `country` (ISO-3166 alpha-2) | Ülke (bölge ataması buna göre) | seed 0005 |
| `country_input` (serbest metin) | `country` boş ya da çözülemezse ülke buradan; ham metin ek yanıtta | seed 0014 + adaptör; en, tr, de, fr, ar, ru adları |
| `product_interest` | İlgilendiği ürün | seed 0005 |
| `project_type` | Müşteri profili (aşağıda) | seed 0014 + `normalizeFormAnswers` |
| `court_count` | Kort sayısı ve bandı (1–999) | seed 0014 + `normalizeFormAnswers` |
| `message` | Not | seed 0005 |
| `product_slug`, `page_language`, `import_source` | Ek yanıt | seed 0005 / 0014 |

`project_type` → müşteri profili: Sports club → kulüp işletmecisi, Hotel / resort → otel/konut, Municipality / public →
kamu tesisi, Private / residential → özel ev, Distributor / partner → distribütör. Architect / consultant bir profil
değildir, ek yanıtta kalır. Ülke ne `country`'den ne `country_input`'tan çözülürse telefonun ülkesi kullanılır
(`country_source: phone`).

### 7.3 CRM'in davranışı

- Tur: her `WEB_PULL_SECONDS` (varsayılan 120) saniyede bir; açılışta hemen bir kez. Sayfa başına `WEB_PULL_LIMIT`
  (50), `more: true` iken tur başına en çok `WEB_PULL_MAX_PAGES` (10) sayfa. Kalan sonraki turda.
- Her öğe push ucunun kapısından gelen kutusuna yazılır; **yazımı kesinleşenler** onaylanır (`inserted` ya da zaten
  varsa `duplicate`). Onay yolda kaybolursa site öğeyi yine verir; CRM `duplicate` der, ikinci lead açılmaz.
- **Bot ve bozuk öğeler kuyruğu tıkamaz:** `submission_id`'si olan her öğe yazılır ve onaylanır. Honeypot'u dolu
  gönderim gelen kutusunda lead açılmadan kapanır (`web.honeypot`); bozuk gövde "İşlenemeyen bildirimler"e düşer.
  `submission_id`'siz öğe onaylanamaz ve sayılır (Sağlık panelinde uyarı; site ekibine bildirilir).
- Ağ hatası, zaman aşımı, 429, 5xx: o sayfa onaylanmaz, sonraki turda yeniden denenir.
  401, 400, 503 `not_configured`, bozuk yanıt: aynı, ama Sağlık panelinde "site isteği reddetti" diye görünür.
- İki süreç aynı anda çekse de tek lead açılır (gelen kutusunda UNIQUE mükerrer anahtarı, işleyicide SKIP LOCKED).
- Eski kayıtlar (`import_source: "wp-legacy"`): normal web lead'i gibi işlenir; lead tarihi `submitted_at`'tır, bölge
  kuralına göre atanır ve satışçıya "yeni lead" bildirimi düşer. Kişinin Excel'den ya da form tablosundan gelmiş açık
  lead'i varsa yeni lead açılmaz, o lead benimsenir (boş alanlar dolar). `gclid` taşıyan eski kayıtlar için reklam
  geri bildirimi de denenir; Google 90 günden eski tıklamayı reddeder (Sağlık → Gönderilemeyen olaylar).
- Loglarda kişisel veri yoktur: yalnız sayılar ve hata kodları.

### 7.4 Kurulum

Worker'da (Clever Cloud, `docs/runbooks/canliya-alma.md` bölüm 2a):

| Değişken | Değer |
|---|---|
| `WEB_PULL_URL` | `https://www.unixpadel.com/?rest_route=/unixpadel/v1/crm` (WP admin → Settings → Unixpadel Static → Sales CRM connection → "Address for the CRM") |
| `WEB_FORM_HMAC_KEY` | `npm run secrets:key` çıktısı; **aynı değer** aynı bölümdeki "Shared key" alanına girilir (ya da `wp-config.php`'de `define('UPX_CRM_HMAC_KEY', '…')`) |
| `WEB_PULL_SECONDS`, `WEB_PULL_LIMIT`, `WEB_PULL_MAX_PAGES` | isteğe bağlı (120, 50, 10) |

Masaüstü uygulamasına (.exe) bu değişkenler **girilmez**: çekmeyi yalnız worker yapar.

### 7.5 Doğrulama

1. Worker logunda `lead-intake hazır … "webPull":true` ve zamanlayıcı listesinde `web-pull@120000ms`.
2. `GET https://<worker-adresi>/health` → `{"ok":true,"webPull":true,"lastPullAt":"…","lastError":null}`.
3. Teklif formunu adresin sonuna `?upx_test=1` ekleyerek aç (ör. `https://www.unixpadel.com/tr/contact-us/?upx_test=1`)
   ve gönder → `is_test: true` gider; en geç 2 dakika sonra Lead listesinde ("Test lead'leri" açık) "Web" rozetiyle;
   Yönetim → Sağlık → "Web sitesi formu (çekme)": son tur 1 alındı · 1 yeni · 1 onaylandı.
4. WP admin → Quote requests listesinin "CRM" sütununda talep "✓ In CRM" ve tarih görünür; ayar sayfasında
   "Last fetch" son çekme zamanını gösterir.

Yerel deneme: `.claude/launch.json` → `crm-web-pull-smoke` (ulaşılamayan adres; Sağlık panelinde `network` görünür).

Sorun giderme (Yönetim → Sağlık'taki son hata kodu):

| Kod | Anlamı | Ne yapılır |
|---|---|---|
| `unauthorized.mismatch` | Anahtarlar farklı | Site ve worker'daki `WEB_FORM_HMAC_KEY` aynı mı |
| `unauthorized.stale` | Saat farkı 5 dakikadan fazla | Site sunucusunun saati (NTP) |
| `unauthorized.missing`, `unauthorized.malformed` | İmza başlığı gitmedi ya da bozuk | Önbellek / ters proxy başlıkları siliyor olabilir (site ekibi) |
| `not_configured` | Sitede anahtar girilmemiş | Eklenti ayarı (site ekibi) |
| `bad_request` | Sözleşme uyuşmazlığı | Site ekibine sürüm sorulur; tek taraflı değiştirilmez |
| `network`, `timeout`, `http_5xx`, `rate_limited` | Geçici | Kendiliğinden düzelir; uzun sürerse site erişimi |
| `inbox.write_failed` | Veritabanı yazamadı | Postgres eklentisi; yazılamayanlar sitede bekler |

### 7.6 Anahtar değiştirme (çekme)

Yeni anahtar üret → sitenin eklenti ayarına gir → worker'da `WEB_FORM_HMAC_KEY`'i güncelle ve yeniden başlat
(`clever restart`). Aradaki dakikalarda turlar `unauthorized.mismatch` verir; talepler sitede bekler, hiçbiri
kaybolmaz. Push aktarıcısı da çalışıyorsa aynı değer ona da girilir.
