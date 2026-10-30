# Web formu aktarıcısı (site tarafı, referans uygulama)

unixpadel.com formu bu küçük Node sürecine POST eder; süreç gönderimi diske yazar, HMAC ile imzalar ve
CRM'in `/forms/web` ucuna iletir. CRM'e ulaşılamazsa dosya kuyrukta kalır ve `RELAY_RETRY_SECONDS`
aralığıyla yeniden denenir; hiçbir gönderim kaybolmaz. İmza anahtarı yalnız bu süreçte ve CRM'de bulunur,
tarayıcıya inmez. Bağımlılık yok; Node 20+.

Ayrıntılı kurulum, gövde sözleşmesi ve test adımları: [docs/runbooks/web-form.md](../../docs/runbooks/web-form.md).

```bash
WEB_FORM_HMAC_KEY=... CRM_FORM_URL=https://crm.example.com/forms/web node integrations/web-form-relay/relay.mjs
```

Dosyalar: `relay.mjs` giriş (ortam değişkenleri), `server.mjs` HTTP yüzü (`POST /submit`, `GET /health`),
`lib.mjs` saf mantık (gövde kurma, imza, dosya kuyruğu, teslim). `queue/` klasörü git dışıdır.
Site PHP ya da başka dilde ise `lib.mjs` içindeki `buildSubmission` ve `signBody` birebir çevrilir.
