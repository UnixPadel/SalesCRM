# Runbook — Meta Lead Ads webhook kurulumu

Faz 2. Önkoşul: Unixpadel Business Manager'da uygulama ve sistem kullanıcısı (bkz. `docs/decisions.md`, madde 1),
staging'de internete açık HTTPS adres (ADR-0005). Secret değerleri bu belgeye **yazılmaz**.

## 1. Secret'lar (hosting ortam değişkenleri / `.env`)

| Ad | Nereden | Not |
|---|---|---|
| `META_APP_SECRET` | Uygulama → Ayarlar → Temel | Webhook imzası bununla doğrulanır |
| `META_VERIFY_TOKEN` | Biz üretiriz: `npm run secrets:key` | Webhook kaydında "Doğrulama belirteci" alanına aynı değer |
| `META_SYSTEM_USER_TOKEN` | Business Manager → Sistem kullanıcıları → Token üret | İzinler: `leads_retrieval`, `pages_manage_ads`, `pages_show_list`, `pages_read_engagement`; sayfa sistem kullanıcısına atanmış olmalı. Süresiz token tercih edilir. |
| `META_GRAPH_API_VERSION` | — | Tek yer; varsayılan `v26.0` |
| `META_PAGE_ID`, `META_FORM_IDS` | Sayfa ve form kimlikleri | `integration_settings` tablosu doluysa o kazanır (`active_form_ids`) |
| `INBOX_ENCRYPTION_KEY` | `npm run secrets:key` | Inbox payload şifreleme anahtarı; staging ve canlıda zorunlu |

Yeniden başlatma sonrası log satırı `lead-intake hazır` içinde `meta: true, encrypted: true` görünmeli.

## 2. Webhook kaydı (Meta uygulama paneli)

1. Uygulama → Webhooks → **Page** nesnesi → "Subscribe to this object".
2. Callback URL: `https://<crm-adresi>/webhooks/meta` — Doğrulama belirteci: `META_VERIFY_TOKEN` değeri.
   Meta GET ile `hub.challenge` gönderir; sunucu 200 + challenge döner (yanlış belirteç → 403).
3. Alan: **leadgen** → Subscribe.
4. Uygulama canlı modda değilse yalnız uygulama rollerindeki kişilerin test lead'leri gelir; canlıya almak
   için "Lead Erişimi" (Leads Access) ayarında CRM'in sayfa için yetkili olması gerekir (MarcaDM ile).

## 3. Sayfa aboneliği (`subscribed_apps`)

Webhook kaydı yetmez; sayfa uygulamaya abone edilmelidir:

```bash
npx tsx scripts/meta-subscribe.ts --page <PAGE_ID>
```

Çıktıda `subscribed_fields` içinde `leadgen` görünmeli. Yalnız kontrol: `--check`. Sistem kullanıcısı
token'ı sayfa için yetkili değilse `--page-token <SAYFA_TOKENI>` ile sayfa token'ı verilir (loglanmaz).

## 4. Doğrulama (Lead Ads Testing Tool)

1. developers.facebook.com/tools/lead-ads-testing → sayfa + form seç → "Create lead".
2. Beklenen: `webhook: Meta bildirimi` log satırı; 5 sn içinde `reklam lead'i açıldı`; gelen kutusunda
   "Meta" rozetli, **test işaretli** lead (Testing Tool değerleri `test lead: dummy data…` ile gelir).
   Test lead'leri outbox'a girmez.
3. Atama: `territory_rules` tablosunda ülke kuralı varsa satışçıya, yoksa havuza. Ülke alanı formda yoksa
   telefon numarasının ülkesi kullanılır.

## 5. Yedek senkron

Saatte bir (`BACKFILL_INTERVAL_MINUTES`) her aktif form için son 2 saatin (`BACKFILL_LOOKBACK_HOURS`)
lead'leri `GET /{form_id}/leads?filtering=time_created>…` ile çekilir ve aynı inbox'a yazılır; webhook'un
getirdiği lead'ler `dedupe_key` sayesinde ikinci kez açılmaz. Aktif form listesi: `integration_settings`
(`meta` / `active_form_ids`, JSON dizi) yoksa `META_FORM_IDS`.

Webhook kapalıyken kaçan lead testi: Meta panelinde aboneliği kaldır → Testing Tool ile lead oluştur →
aboneliği geri aç → en geç bir saat içinde lead gelen kutusunda.

## 6. Hata ayıklama

| Belirti | Neden | Yapılacak |
|---|---|---|
| `inbox: kalıcı hata, failed` + `meta.token_missing` | Sistem kullanıcısı token'ı yok | Secret'ı tanımla, yeniden başlat; satır Faz 6 admin ekranına kadar SQL ile `pending` yapılır |
| `meta.token_invalid` (kod 190) | Token süresi doldu / iptal | Yeni token üret |
| `meta.permission` (kod 10/200) | Sayfa izni / Lead Erişimi yok | Business Manager'da sayfa atamasını ve Leads Access'i kontrol et |
| `meta.unavailable` | Graph API 5xx / oran sınırı | Kendiliğinden yeniden denenir (1, 5, 30, 120, 720 dk) |
| `webhook: Meta imzası geçersiz` | Yanlış `META_APP_SECRET` ya da gövde proxy'de değişti | Secret'ı doğrula; ters proxy gövdeyi değiştirmemeli |

Inbox durumu: `SELECT status, count(*) FROM inbound_webhook_events GROUP BY 1;`

## 7. App Review

Uygulama canlı moda alınacaksa `leads_retrieval` için inceleme gerekebilir. Başvuru ekran kaydı bu ortamdan
alınır: Testing Tool'da lead oluşturma → CRM gelen kutusunda lead'in görünmesi. Kayıt staging açılınca.
