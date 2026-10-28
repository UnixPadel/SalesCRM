# Runbook — Google Ads lead form uzantısı webhook'u

Faz 2. Google, form gönderildiğinde CRM'e POST atar; CRM `google_key` ile doğrular, inbox'a yazar, 200 döner.

## 1. Anahtar üretimi ve teslim

```bash
npm run secrets:key
```

Çıktı `GOOGLE_LEAD_FORM_KEY` olarak hosting ortam değişkenine / `.env` dosyasına yazılır. Aynı değer ve
webhook adresi MarcaDM'e **güvenli kanaldan** iletilir (şifre yöneticisi paylaşımı ya da tek kullanımlık
gizli not; e-posta ya da mesajlaşma uygulamasına düz metin yazılmaz):

- Webhook URL: `https://<crm-adresi>/webhooks/google`
- Anahtar: `GOOGLE_LEAD_FORM_KEY` değeri

MarcaDM Google Ads → Reklam uzantıları → Lead form → "Lead teslim seçeneği" → Webhook'a URL ve anahtarı girer.

## 2. Doğrulama ("Test verisi gönder")

Google Ads lead form ayarında **Test verisi gönder** düğmesi `is_test: true` ve `TeSter-…` kimlikli bir
kayıt yollar. Beklenen:

- Sunucu logu: `webhook: Google bildirimi` (`isTest: true`), 5 sn içinde `reklam lead'i açıldı`.
- Gelen kutusunda "Test lead'leri" kutusu işaretlenince "Google" rozetli, test işaretli lead.
- `lead_attribution.gclid` dolu: `SELECT gclid FROM lead_attribution la JOIN leads l ON l.id = la.lead_id WHERE l.source = 'google_form';`
- Yanlış anahtar → 401 ve `webhook: Google anahtarı geçersiz` logu; Google panelde "başarısız" görünür.

## 3. Alan eşlemesi

`user_column_data[].column_id` → `form_field_mappings` (sağlayıcı `google`). Standart sütunlar seed'de
(`FULL_NAME`, `EMAIL`, `PHONE_NUMBER`, `COUNTRY`, `CITY`, `COMPANY_NAME`…). Formdaki özel sorular
(`column_id` sorunun kimliği) eşlenmedikçe **yok sayılır**; yalnız adları `extra_answers.ignored_columns`
içinde listelenir. Özel soruyu bağlamak için (Faz 6 ekranına kadar) SQL:

```sql
INSERT INTO form_field_mappings (id, provider, form_id, platform_field, target_field)
VALUES (gen_random_uuid(), 'google', '<FORM_ID>', '<COLUMN_ID>', 'product_interest');
```

`form_id` NULL verilirse sağlayıcının tüm formları için geçerli olur. Hedefler: `full_name`, `first_name`,
`last_name`, `email`, `phone`, `country`, `city`, `company`, `product_interest`, `notes`, `extra`, `ignore`.

## 4. Kampanya ve tıklama bilgisi

`campaign_id` → `leads.campaign_id`, `adgroup_id` → `adset_id`, `creative_id` → `ad_id`, `gcl_id` →
`lead_attribution.gclid` (Faz 5'te Data Manager API'ye geri bildirim için).

## 5. Anahtar değiştirme

Yeni anahtar üret → MarcaDM yeni anahtarı Google Ads'e girer → hosting'de değişkeni güncelle → yeniden
başlat. Aradaki dakikalarda gelen istekler 401 alır; Google yeniden denemez, bu yüzden değişiklik düşük
trafikli saatte ve MarcaDM ile eşzamanlı yapılır.
