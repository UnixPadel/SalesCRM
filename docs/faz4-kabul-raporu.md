# Faz 4 — Meta geri bildirimi: kabul raporu

Tarih: 2026-10-30. Kapsam: Faz 4 iş emri (platformdan bağımsız dağıtıcı, Meta Conversions API adaptörü, geriye
doldurma, testler). Kapsam dışı: kampanya hedefini "Dönüşüm Lead'leri"ne çevirmek (MarcaDM), sağlık paneli arayüzü (Faz 6).

Onaylanan varsayılanlar (2026-10-30, Elshan): olay adları seed'i rehberdeki Türkçe adlarla ve açık, optimizasyon hedefi
QUALIFIED; `META_DATASET_ID` / `META_CAPI_TOKEN` (boşsa sistem kullanıcısı token'ı) / `META_TEST_EVENT_CODE`;
acil durdurma `integration_settings meta/outbound_enabled`; gönderim sırasında `pending` + kilit süresi, geçici hata
`failed`; onay kuralı (web formu lead'inde `kvkk` şart, platform formlarında platformda alınmış sayılır); toplu 100 ve
400'de tek tek yeniden deneme; sales-pipeline'a `outboundContext` sorgusu; `JSON.rawJSON` ile 64-bit `lead_id`;
geriye doldurma komutu.

## Görevler ve commit'ler

| Görev | Commit | Durum |
|---|---|---|
| Her dakika çalışan worker: `pending` ve zamanı gelmiş satırlar, 10 dk bekleme | `ad-feedback/application`, `ad-feedback/infrastructure`, `bootstrap` | Tamam — `DispatchOutbox.runOnce`, `outbox-dispatch@60000ms`; bekleme `next_attempt_at`'ta (Faz 1), `SKIP LOCKED` + 5 dk kilit |
| Platform başına toplu gönderim | `ad-feedback/application` | Tamam — sağlayıcı başına gruplama, `OUTBOX_BATCH_SIZE` (100) |
| Yanıt sınıflandırması: 2xx sent; 400 dead; 429/5xx/zaman aşımı → 1, 5, 30, 120, 720 dk, sonra dead | `ad-feedback/application`, `adapters/meta-capi` | Tamam — toplu 400'de tek tek yeniden deneme, yalnız hatalı olay dead |
| Gönderim filtreleri → skipped + neden | `ad-feedback/application` | Tamam — manual_source, test_lead, no_consent, mapping_missing, mapping_disabled, emergency_stop, undone, no_match_key |
| Geri alınan aşamanın olayı skipped | Faz 1 (`undoStageChange`) + dağıtıcı ikinci kontrol | Tamam |
| Dead-letter satırları için günlük e-posta raporu | `ad-feedback/application`, `bootstrap`, migration 0007 | Tamam — `DeadLetterReport` 24 saat, `OUTBOX_REPORT_TO`; `finished_at` sütunu |
| Meta normalleştirme stratejisi ve SHA-256 | `ad-feedback/builders` | Tamam — `normalize.ts`; bilinen örnek değerler testte |
| Saf payload builder (`event_name`, `event_time`, `action_source`, `lead_id`, `em`, `ph`, `event_source`, `lead_event_source`, WON `value`/`currency`) | `ad-feedback/builders` | Tamam — `buildMetaEvent`, 4 snapshot |
| `lead_id` 64-bit güvenli serileştirme | `ad-feedback/builders` | Tamam — `serializeMetaBatch` (`JSON.rawJSON`, yer tutucu yedeği); testte 18446744073709551615 bozulmadan |
| Web formu lead'leri: `action_source: website` + `_fbc`/`_fbp` | `ad-feedback/builders` | Tamam — `event_source_url` = landing_url, `lead_id` yok |
| CAPI adaptörü; Graph sürümü config'te; staging'de Test Olayları kodu | `adapters/meta-capi` | Tamam — `META_GRAPH_API_VERSION` (lead-intake ile aynı), `META_TEST_EVENT_CODE` |
| Tek seferlik geriye doldurma komutu | `ad-feedback` + `scripts/outbox-backfill.ts` | Tamam — `--provider meta --since --sources --dry-run`; yalnız eksik satır |
| `platform_stage_mappings` Meta olay adları | `db:` 0006 | Varsayılanla kodlandı; MarcaDM onayı **bekliyor** (madde 19) |
| Veri seti ID'si ve token secret deposunda | — | **Yazılım dışı, bekliyor** (madde 17); adlar sabit |

Commit kimlikleri `git log --oneline` ile; sıra: db 0006 → integration-settings → sales-pipeline outboundContext →
builders → application → meta-capi → infrastructure + 0007 → bootstrap → geriye doldurma → docs → kabul raporu.

## Test planı

| Madde | Nerede | Sonuç |
|---|---|---|
| Builder snapshot testleri; hash için bilinen örnek değerler | `builders/meta/meta-builder.test.ts` (12 test, 4 snapshot; sha256("test@example.com") = 973dfe46…, sha256("905321234567") = 7e330815…) | Yeşil |
| Dağıtıcı: sahte sunucuyla 200, 400, 429, 500 ve zaman aşımı | `application/dispatcher.test.ts` (FakeSender ile; 400 tek/toplu, 429→500→timeout→503→500→500 dizisi, fırlatan gönderici), `adapters/meta-capi/meta-capi.test.ts` (sahte fetch ile gerçek sınıflandırma: 200, 400, 401, 429, 500, 503, Graph kodu 4, AbortSignal zaman aşımı, ağ hatası) | Yeşil |
| Geri alınan aşamanın olayı platforma gitmiyor | `dispatcher.test.ts` "geri alınan aşamanın olayı", `infrastructure/outbox.test.ts` "geri alma … skipped (undone)" (gerçek Undo) | Yeşil |
| Aynı aşama olayı iki kez gönderilmiyor | `dispatcher.test.ts` (ikinci turda claimed 0; kilit süresince ikinci claim boş), `outbox.test.ts` (sent satır yeniden alınmaz; UNIQUE stage_event_id+provider), `bootstrap/adFeedback.test.ts` | Yeşil |
| Uçtan uca kompozisyon | `bootstrap/adFeedback.test.ts`: gerçek CreateLead/ChangeLeadStage → outbox → dağıtıcı → sahte CAPI; beş aşama (NEW, CONTACTED, QUALIFIED*, PROPOSAL*, WON) tek gövdede, `lead_id` 1234567890123456789 ham gövdede sayı, `event_source`/`lead_event_source`, WON tutarı, `test_event_code`, token yalnız başlıkta | Yeşil |

Komutlar ve çıktı (2026-10-30):

```
npm run verify            → lint 0 hata / 11 uyarı (Faz 0 öncesi arayüz kodu), Prettier temiz, tsc (iki proje) temiz,
                            depcruise 0 ihlal (1 bilgi: server/authDb.d.mts orphan), secretlint temiz;
                            ilk koşuda 5 PGlite dosyası 10 sn kanca zaman aşımına takıldı (29 dosya paralel, yük),
                            vitest hookTimeout 60 sn / testTimeout 30 sn yapıldı → 29 test dosyası / 300 test yeşil
npx vitest run --coverage → domain + application + builders satır kapsamı %99.38 (eşik %90), fonksiyon %100
```

## Kabul kriterleri ve doğrulama

### 1. Events Manager Test Olayları'nda tüm aşamalar `lead_id`, `event_source` ve `lead_event_source` ile görünüyor

- **Yerel karşılık (otomatik):** `bootstrap/adFeedback.test.ts` — sahte Conversions API'ye giden gövdede beş olayın
  hepsinde `action_source: system_generated`, `user_data.lead_id` (64-bit, sayı), `custom_data.event_source: crm`,
  `lead_event_source: Unixpadel CRM`; `test_event_code: TEST99`. Payload biçimi snapshot'larda.
- **Gerçek doğrulama:** staging + veri seti kimliği + token (madde 17) gelince runbook bölüm 2 adımlarıyla. **Bekliyor.**
- **Yerel smoke (2026-10-30):** `crm-webhook-smoke` ile sunucu `ENABLED_PROVIDERS=meta` ve token'sız açıldı:
  log `ad-feedback hazır (meta: false, enabledProviders: [meta])` ve uyarı `hiçbir gönderici yapılandırılmadı:
  outbox satırları pending bekler`; `outbox-dead-letter-report` işi kuruldu ve açılışta `satır yok` yazdı. Web lead'i
  arayüz oturumuyla CONTACTED'a taşındı (API 200, olay `sequence: 2`); outbox satırının açıldığı PGlite testinde
  (`outbox.test.ts`) doğrulanıyor. Gerçek Meta'ya gönderim yerelde bilerek yapılmadı.

### 2. Veri setinin CRM kurulum ekranında hata yok

Yazılım dışı; MarcaDM'in veri setini oluşturup token'ı teslim etmesinden ve staging'de ilk olayların gitmesinden
sonra Events Manager'da kontrol edilir (runbook bölüm 2). **Bekliyor.**

### 3. Aylık Meta lead hacmi eşiğin altındaysa MarcaDM'e yazılı raporlandı; akış ölçüm amaçlı açık

Hacim ≈ 134/ay (eşik 200–250): **altında**. Bildirim metni `docs/decisions.md` madde 18'de hazır; gönderim yönetimde.
Akış tasarımı ölçüm amaçlı çalışmaya uygun: hedef değiştirilmeden olaylar gider, `is_optimization_target` yalnız bilgi.

## Bitti tanımı (Genel plan) — bu faz

- [x] İş kuralı domain/application katmanında ve testli (filtre sırası `skipReasonFor`, onay kuralı `consentAllows`,
      yeniden deneme planı, builder saf)
- [x] Dış çağrı bir port arkasında, sahte uygulamayla testli (`PlatformSender`, `CapiClient` sahte fetch,
      `OutboxRepository` bellek içi + PGlite, `ReportMailer` kayıt eden sahte)
- [x] Logda kişisel veri yok (dağıtıcı ve CAPI logları yalnız kimlik, durum, kod, fbtrace; rapor e-postasında
      e-posta/telefon yok — testte doğrulandı)
- [x] Hata türü sınıflandırılmış (ok / retry / dead; Graph geçici kodları; zaman aşımı; yapılandırma eksikleri retry)
- [x] Config ve secret kodda değil (`META_DATASET_ID`, `META_CAPI_TOKEN`, `META_TEST_EVENT_CODE`, `OUTBOX_*`,
      `CONSENT_REQUIRED_TYPE` yalnız bootstrap `readSecret`/`loadConfig`; token yalnız başlıkta; `.env.example` yer tutucu)
- [x] Arayüz metinleri TR ve EN (yeni arayüz metni yok; rapor e-postası TR, iç kullanım)
- [x] ADR yazıldı (ADR-0011)
- [x] Sözlük testi: `sales-pipeline` ve `integration-settings/domain` platform adı içermiyor (`outboundContext`,
      `StageMapping` nötr adlarla)

## Bilinen eksikler ve sonraki adımlar

1. **Veri seti kimliği, token, `ENABLED_PROVIDERS=meta`** (madde 17) olmadan gönderim yok; satırlar `pending` birikir,
   token gelince gider (10 dk kuralı yine uygulanır; birikmiş satırlar hemen).
2. **Geriye doldurma** staging/canlıda bir kez çalıştırılır (`--dry-run` ile önce sayılır). Yerel kuru çalıştırma 0 aday
   döndü (temiz veritabanı).
3. **Olay adları** MarcaDM onayına kadar seed'deki Türkçe adlar; ad değişikliği Meta modelini yeniden eğitir.
4. **Onay kuralı** hukuk görüşüne (madde 6, 16) kadar varsayılan; `CONSENT_REQUIRED_TYPE` ve `consentAllows` tek noktada.
5. **Acil durdurma** sırasında biriken satırlar `skipped (emergency_stop)` olur, geri açılınca otomatik gitmez
   (runbook bölüm 7 ile yeniden kuyruğa alınır). Faz 6 "yeniden dene" düğmesi bunu kolaylaştırır.
6. **Web formu lead'leri** Meta'da Dönüşüm Lead'leri eğitimine girmez (plan notu); ölçüm için gider. `client_user_agent`
   ve `client_ip_address` toplanmıyor (eşleşme kalitesi düşük olabilir); Faz 3 aktarıcısına eklenebilir.
7. **Birden fazla instance:** dağıtıcı `SKIP LOCKED` ile güvenli; dead-letter raporu her instance'ta çalışırsa aynı
   e-posta birden fazla gidebilir (tek instance varsayımı; hosting kararına bağlı).
8. Faz 2–3'ün yazılım dışı eksikleri (hosting, Meta token/Lead Erişimi, Google anahtarı, SMTP, site aktarıcısı) sürüyor.

>>>

