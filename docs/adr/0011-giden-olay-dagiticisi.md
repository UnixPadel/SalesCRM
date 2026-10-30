# ADR-0011: Giden olay dağıtıcısı — durum anlamları, filtreler, toplu gönderim, onay kuralı

- Durum: Kabul edildi
- Tarih: 2026-10-30
- Karar verenler: Yazılım (Elshan)

## Bağlam

Faz 4 iş emri: her aşama değişikliği Meta'ya CRM olayı olarak gitsin; dağıtıcı Faz 5'te Google için de kullanılsın.
Faz 1 outbox satırını aşama değişikliğiyle aynı transaction'da yazıyor (`next_attempt_at = +10 dk`), geri alma
satırı `skipped (undone)` yapıyor. `outbound_conversion_events.status` şu değerleri alır: pending, sent, failed,
dead, skipped. Zamanlayıcı kütüphanesiz (ADR-0009). `platform_stage_mappings` boştu; MarcaDM olay adlarını
onaylamadı. Meta'nın aylık lead hacmi optimizasyon eşiğinin altında (decisions bölüm 2).

## Karar

1. **Katman ayrımı:** dağıtıcı `ad-feedback/application`'da, platformdan bağımsız (`PlatformSender` portu:
   `prepare` saf, `send` ağ). Lead verisine sales-pipeline tablolarından değil, `LeadQueries.outboundContext`
   sorgusuyla ulaşır; aşama eşlemesi ve acil durdurma integration-settings'ten. Outbox tablosunun durum
   geçişleri dağıtıcıya aittir (`ad-feedback/infrastructure`), satırı sales-pipeline açar.
2. **Durum anlamları:** `pending` = sırada; `failed` = geçici hata, `next_attempt_at`'ta yeniden denenecek;
   `sent`, `dead`, `skipped` = bitti (`finished_at`, migration 0007). Alma `FOR UPDATE SKIP LOCKED` ile; alınan
   satırın `next_attempt_at`'ı kilit süresi (5 dk) kadar ileri atılır, böylece ikinci instance ya da çöken süreç
   aynı olayı iki kez göndermez. Yeniden deneme 1, 5, 30, 120, 720 dk; sonra `dead`.
3. **Filtre sırası sabit:** emergency_stop → undone → test_lead → manual_source → no_consent → mapping_missing →
   mapping_disabled → (adaptör) no_match_key. İlk eşleşen neden `skip_reason`'a yazılır.
4. **Onay kuralı (hukuk görüşüne kadar):** platform formu lead'lerinde (Meta, Google) onay platformun formunda
   alınmış sayılır; web formu lead'inde aranan türde (`CONSENT_REQUIRED_TYPE`, varsayılan `kvkk`) verilmiş onay
   şart; her kaynakta aranan türün son kaydı "verilmedi" ise gönderilmez.
5. **Toplu gönderim ve 400:** sağlayıcı başına tek istekte en çok 100 olay. Toplu istek 400 dönerse olaylar tek
   tek yeniden gönderilir; yalnız reddedilen `dead` olur. 429/5xx/zaman aşımı/ağ hatası toplu olarak `failed`.
6. **Olay adları seed'i:** rehberdeki Türkçe adlar `enabled = true` ile seed edildi, optimizasyon hedefi
   QUALIFIED. MarcaDM onayı adları migration ya da Faz 6 ekranıyla değiştirir.
7. **64-bit `lead_id`:** JSON'a sayı olarak `JSON.rawJSON` ile yazılır (Node 22); yoksa yer tutucu değişimi.
   Değer hiçbir zaman JS number'a çevrilmez.
8. **Token:** `META_CAPI_TOKEN`, boşsa `META_SYSTEM_USER_TOKEN` (aynı sistem kullanıcısı). Yalnız Authorization
   başlığında; URL ve gövdede değil. Veri seti kimliği secret değildir; `integration_settings meta/dataset_id`
   ya da `META_DATASET_ID`.
9. **Geriye doldurma** ayrı komut (`scripts/outbox-backfill.ts`): yalnız eksik satırı açar, dağıtıcı gönderir.

## Seçenekler ve neden seçilmediği

- **Gönderim sırasında ayrı `processing` durumu:** tablo CHECK kısıtı değişirdi; kilit süresiyle `next_attempt_at`
  aynı güvenceyi veriyor (inbox'ta da böyle).
- **Dağıtıcının sales-pipeline tablolarını doğrudan okuması:** daha az kod ama modül sınırı ihlali (Genel plan
  kural 2; dependency-cruiser SQL'i göremez, kural yine de geçerli). Tek sorgu ile DTO seçildi.
- **400'de tüm toplu isteği dead yapmak:** bir bozuk olay 99 sağlam olayı düşürürdü. Tek tek yeniden deneme
  istek sayısını yalnız hata anında artırır.
- **Manuel lead'leri kuyruğa hiç yazmamak (sales-pipeline'da filtre):** o zaman admin neden gönderilmediğini
  göremezdi; Genel plan filtreyi dağıtıcıda `skipped + neden` olarak ister.
- **Onay şartını tüm kaynaklara uygulamak:** Meta/Google formlarından onay satırı gelmediği için hiçbir reklam
  lead'i gitmezdi; faz amacı boşa çıkardı. Hukuk görüşü kuralı sıkılaştırabilir (yalnız config ve bir fonksiyon).

## Sonuçlar

- `ENABLED_PROVIDERS=meta` yazılmadan outbox satırı açılmaz; Faz 2'den beri biriken olaylar için geriye doldurma
  komutu bir kez çalıştırılır.
- Acil durdurma sırasında biriken satırlar `skipped (emergency_stop)` olur; otomatik geri gelmez, gerekirse
  yeniden kuyruğa alınır (runbook bölüm 7).
- Faz 5 Google adaptörü yalnız `PlatformSender` uygular; dağıtıcı, filtreler ve rapor değişmez. Google'ın 90 günlük
  yükleme penceresi `prepare` içinde `skip` olarak eklenir (yeni neden: `expired`).
- Faz 6 sağlık paneli `outbound_conversion_events` sütunlarını (status, skip_reason, finished_at) okur; "yeniden
  dene" = `pending` + `attempts = 0`.
