# Runbook — Web sitesi formu (unixpadel.com → CRM)

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
