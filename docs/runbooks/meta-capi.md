# Runbook — Meta geri bildirimi (Conversions API, CRM olayları)

Faz 4. Her aşama değişikliği 10 dakika sonra (geri alma hakkı) Meta'ya bir CRM olayı olarak gider; Dönüşüm
Lead'leri optimizasyonu için veri birikir. Dağıtıcı platformdan bağımsızdır; Faz 5'te Google aynı dağıtıcıyı kullanır.

```
aşama değişikliği ──aynı transaction──▶ outbound_conversion_events (pending, next_attempt_at = +10 dk)
                                              │ her dakika: DispatchOutbox
                                              ├─ filtreler → skipped (+ neden)
                                              ├─ Meta builder → POST /{DATASET_ID}/events (toplu, en çok 100)
                                              └─ 2xx sent · 400 dead · 429/5xx/zaman aşımı → 1, 5, 30, 120, 720 dk → dead
```

## 1. Ön koşullar ve teslimler

| Ne | Kim | Nereye |
|---|---|---|
| Events Manager → Veri kaynağı bağla → **CRM** ile Unixpadel veri seti (dataset) | MarcaDM, Unixpadel Business Manager'da | Veri seti **ID'si** güvenli kanaldan yazılım ekibine |
| Sistem kullanıcısı token'ı (`ads_management`, veri setine atanmış) | Yönetim + MarcaDM | Hosting ortam değişkeni `META_CAPI_TOKEN` (boşsa `META_SYSTEM_USER_TOKEN` kullanılır) |
| Olay adlarının onayı | MarcaDM + Satış | `platform_stage_mappings` (seed `0006`; bölüm 3) |
| `ENABLED_PROVIDERS=meta` | IT | Hosting ortam değişkeni; **bu olmadan outbox satırı hiç açılmaz** |

Veri seti kimliği iki yoldan verilir: ortam değişkeni `META_DATASET_ID` ya da `integration_settings`
(`meta` / `dataset_id`); tablo doluysa o kazanır:

```sql
UPDATE integration_settings SET value = '<DATASET_ID>', updated_at = now() WHERE provider = 'meta' AND key = 'dataset_id';
```

Token yoksa dağıtıcı kurulmaz, satırlar `pending` bekler (log: `ENABLED_PROVIDERS dolu ama hiçbir gönderici
yapılandırılmadı`). Token girilip süreç yeniden başlatılınca biriken satırlar sırayla gider.

## 2. Staging: Test Olayları

Staging'de `META_TEST_EVENT_CODE=<kod>` tanımlanır (Events Manager → veri seti → Test Olayları sekmesindeki kod).
Her gövdeye `test_event_code` eklenir; olaylar canlı veriyi kirletmez. **Canlıda bu değişken boş bırakılır**;
açılışta log uyarısı verilir.

Doğrulama (kabul kriteri 1): staging'de bir Meta test lead'i NEW → CONTACTED → QUALIFIED → PROPOSAL → WON
yürütülür (WON için tutar ve para birimi). 10 dakika sonra Test Olayları sekmesinde beş olay, her birinde
`lead_id`, `custom_data.event_source = crm`, `lead_event_source = Unixpadel CRM`; "Kazanıldı" olayında
`value`/`currency`. Sunucu logu: `capi: olaylar alındı (received: 5)`, `dağıtıcı turu (sent: 5)`.

Kabul kriteri 2: Events Manager → veri seti → **CRM kurulumu** ekranında hata yok; "Dönüşüm Lead'leri için
yeterlilik" göstergesi hacme göre dolar.

## 3. Olay adları ve eşleme

| Aşama | Meta olay adı (seed) | Açık | Optimizasyon hedefi |
|---|---|---|---|
| NEW | Yeni Lead | evet | |
| CONTACTED | İletişim Kuruldu | evet | |
| QUALIFIED | Nitelikli Lead | evet | **evet** |
| PROPOSAL | Teklif Gönderildi | evet | |
| WON | Kazanıldı | evet | |
| LOST | Kaybedildi | evet | |

Ad değişikliği (MarcaDM onayı) yeni migration ile ya da Faz 6 ekranına kadar SQL ile:

```sql
UPDATE platform_stage_mappings SET platform_event_name = 'Qualified Lead' WHERE provider = 'meta' AND stage_code = 'QUALIFIED';
UPDATE platform_stage_mappings SET enabled = false WHERE provider = 'meta' AND stage_code = 'LOST';  -- gönderme
```

Kapalı aşamanın olayı `skipped (mapping_disabled)` olur; satırı olmayan aşama `mapping_missing`.
Olay adı değişince Meta modeli yeniden öğrenir; değişiklik MarcaDM ile planlanır.

## 4. Gönderim filtreleri (`skipped` nedenleri)

| Neden | Ne zaman |
|---|---|
| `emergency_stop` | `integration_settings` `meta/outbound_enabled = false` (bölüm 6) |
| `undone` | aşama geri alındı (normalde geri alma anında işaretlenir; dağıtıcı ikinci kez kontrol eder) |
| `test_lead` | lead test işaretli (zaten kuyruğa yazılmaz; eski kayıt için emniyet) |
| `manual_source` | kaynak `manual` ya da `import` |
| `no_consent` | web formu lead'inde verilmiş `kvkk` onayı yok, ya da herhangi bir lead'de son `kvkk` kaydı "verilmedi" (`CONSENT_REQUIRED_TYPE`) |
| `mapping_missing` / `mapping_disabled` | bölüm 3 |
| `no_match_key` | ne `lead_id` ne hash'li e-posta/telefon ne `fbc`/`fbp` var |

Platform formu lead'lerinde (Meta, Google) onay platformun formunda alınmış sayılır; hukuk görüşü
(docs/decisions.md madde 6) gelince `CONSENT_REQUIRED_TYPE` ve kural güncellenir.

## 5. Payload

Meta formu lead'i: `action_source: system_generated`, `user_data.lead_id` = leadgen_id (64-bit **sayı**, JSON'a
hassasiyet kaybı olmadan yazılır), `em`/`ph` SHA-256 (e-posta küçük harf boşluksuz; telefon yalnız rakam, ülke
kodu dahil, `+` yok). Web formu lead'i: `action_source: website`, `event_source_url` = formun sayfası, `fbc`/`fbp`
çerezleri, `lead_id` yok; Meta bunları Dönüşüm Lead'leri eğitiminde saymaz, ölçüm için gider. Her olayda
`event_id` = aşama olayı kimliği (Meta tarafında tekilleştirme). Örnek: `src/modules/ad-feedback/builders/meta/__snapshots__`.

## 6. İşletme

- **Acil durdurma:** `UPDATE integration_settings SET value = 'false' WHERE provider = 'meta' AND key = 'outbound_enabled';`
  Bir sonraki tikten itibaren tüm Meta satırları `skipped (emergency_stop)`. Geri açmak için `'true'`.
  Not: durdurma sırasında biriken satırlar skipped olur, otomatik geri gelmez; gerekirse bölüm 7 ile yeniden açılır.
- **Yeniden deneme:** geçici hatada satır `failed` ve `next_attempt_at` ileri; 5 denemeden sonra `dead`.
- **Günlük dead-letter raporu:** her 24 saatte (ve açılışta) son 24 saatin `dead` satırları `OUTBOX_REPORT_TO`
  adreslerine e-posta; alıcı yoksa yalnız log. Kişisel veri içermez.
- **İzleme (Faz 6 paneline kadar):**

```sql
SELECT provider, status, count(*) FROM outbound_conversion_events GROUP BY 1, 2 ORDER BY 1, 2;
SELECT id, stage_event_id, attempts, last_response_code, last_error, finished_at
  FROM outbound_conversion_events WHERE status = 'dead' ORDER BY finished_at DESC LIMIT 50;
SELECT skip_reason, count(*) FROM outbound_conversion_events WHERE status = 'skipped' GROUP BY 1;
```

## 7. Geriye doldurma ve yeniden kuyruğa alma

Faz 2'den beri `ENABLED_PROVIDERS` boş olduğu için biriken Meta lead'lerinin aşama olayları için bir kez:

```bash
npx tsx scripts/outbox-backfill.ts --provider meta --since 2026-10-28 --dry-run
npx tsx scripts/outbox-backfill.ts --provider meta --since 2026-10-28
```

Yalnız satırı olmayan olaylar `pending` açılır; test lead'i, geri alınmış olay ve manuel lead seçilmez.
Açılan satırları çalışan sunucunun dağıtıcısı gönderir (filtreler yine uygulanır). `--sources meta_form,web_form`
ile web formu lead'leri de dahil edilir.

Tek satırı yeniden denemek: `UPDATE outbound_conversion_events SET status = 'pending', attempts = 0, next_attempt_at = now() WHERE id = '<id>';`

## 8. Hacim notu (kabul kriteri 3)

Son üç ayın ortalaması ≈ 134 Meta lead/ay (docs/decisions.md bölüm 2); Meta'nın Dönüşüm Lead'leri eşiği
200–250/ay. Eşiğin altında: akış **ölçüm amaçlı** açık kalır, kampanya hedefi çevrilmez. MarcaDM'e yazılı
bildirim metni docs/decisions.md madde 18'de.
