# ADR-0010: Web formu kimliği (HMAC + zaman damgası) ve site tarafı aktarıcı

- Durum: Kabul edildi
- Tarih: 2026-10-30
- Karar verenler: Yazılım (Elshan)

## Bağlam

Faz 3 iş emri: unixpadel.com formu lead'leri tıklama kimlikleri ve UTM ile CRM'e düşürsün; anahtar
tarayıcıya inmesin; CRM'e ulaşılamazsa gönderim kaybolmasın; honeypot. Site kodu bu depoda değil ve
teknolojisi bilinmiyor; MarcaDM GTM ile `gclid`, `fbclid`, `_fbc`, `_fbp` ve UTM değerlerini birinci taraf
çerezde tutuyor. Faz 2'de Meta ve Google için inbox deseni, imza doğrulama ve alan eşlemesi kuruldu.

## Karar

1. **Kimlik:** `POST /forms/web` ham gövde üzerinde `HMAC-SHA256(anahtar, "<timestamp>.<gövde>")` ister
   (`X-Webform-Signature`, `X-Webform-Timestamp`); zaman damgası ±300 sn dışında ise reddedilir
   (yeniden oynatma koruması). Meta'nın şemasıyla aynı yardımcılar (`hmacSha256Hex`, `safeEqual`).
   Anahtar `WEB_FORM_HMAC_KEY`, yalnız CRM ve site sunucusunda (ADR-0004).
2. **Aynı inbox:** gönderim `inbound_webhook_events`'e `provider = web`, `dedupe_key = web:<submission_id>`
   ile yazılır; `submission_id`'yi site üretir. Yeniden deneme ve çift gönderim böylece tek lead açar.
   Adaptör `form_field_mappings` (sağlayıcı `web`) ile alanları eşler; eşlenmeyen alan ek yanıt.
3. **Onaylar:** `CreateLeadInput.consents` eklendi; `lead_consents` lead ile aynı transaction'da yazılır,
   aydınlatma metni sürümüyle. Tıklama kimlikleri Faz 2'deki `attribution` alanıyla gider; DTO fbc/fbp/UTM/
   landing_url ile tamamlandı.
4. **Site tarafı:** depoda bağımsız bir **referans aktarıcı** (`integrations/web-form-relay`, bağımlılıksız
   Node) tutulur: formu alır, honeypot'u eler, çerezlerden kimlikleri tamamlar, önce diske yazar, imzalayıp
   CRM'e iletir, başarısızsa periyodik yeniden dener. Site başka dilde ise sözleşme runbook'ta; aktarıcı
   çeviri şablonudur.
5. **Honeypot:** aktarıcı dolu gönderimi hiç iletmez; CRM de gelirse lead açmadan 200 döner (bot,
   reddedildiğini öğrenmesin). İki katman: site tarafı atlanırsa CRM yine korunur.

## Seçenekler ve neden seçilmediği

- **Tarayıcıdan doğrudan CRM'e POST:** anahtar JavaScript'te görünür; CORS ve bot trafiği CRM'e gelir.
  İş emri açıkça sunucudan gönderim ister.
- **Yalnız şartname, aktarıcı yok:** "CRM kapalıyken kayıp yok" kriteri site ekibinin uygulamasına kalırdı
  ve bu depoda test edilemezdi. Referans uygulama testi mümkün kıldı ve teslimi hızlandırır.
- **Zaman damgasız imza:** yakalanan istek süresiz yeniden oynatılabilirdi; dedupe lead çoğaltmayı engeller
  ama pencere, kuyruğu gereksiz yüklemeyi de keser. 300 sn, saat kayması ve yeniden deneme için yeterli.
- **Kuyruk için veritabanı/Redis (site tarafında):** site sunucusuna bağımlılık ekler; JSON dosyaları
  tek süreç için yeterli ve denetlenebilir (`queue/`, `queue/failed/`).
- **Onayları `extra_answers`'ta tutmak:** KVKK kaydı sorgulanabilir olmalı; ayrı tablo Faz 1'den beri var.

## Sonuçlar

- `WEB_FORM_HMAC_KEY` iki yerde yaşar; döndürme sırası runbook'ta (önce CRM, sonra aktarıcı).
- Aktarıcıdaki `queue/` kişisel veri içerir (form alanları): kalıcı diskte, yalnız sunucu kullanıcısına
  okunur; iletilince dosya silinir. `failed/` klasörü elle temizlenir; bu, hukuk görüşünde (madde 6)
  saklama süresine bağlanmalı.
- CRM `/forms/*` yolu `/webhooks/*` gibi internete açılır (ADR-0005); IP başına dakikada 120 istek.
- Faz 6 eşleme ekranı `web` sağlayıcısını da kapsar; Faz 4–5 `lead_attribution.fbclid/fbc/fbp/gclid` ile
  geri bildirim gönderir.
