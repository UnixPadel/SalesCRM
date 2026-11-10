# Faz 7 — Yönetim paneli: iş emri (taslak, onay bekliyor)

Tarih: 2026-11-10. Kaynak: `docs/yol-haritasi.md` bölüm 6 satır 7 (Genel plan Faz 6) + `docs/faz6d-kabul-raporu.md`
"Bilinen eksikler" 1–3. Hosting kararı (ADR-0005) **ertelendi**; Faz 7 ondan bağımsızdır, yerel PGlite ile biter.

Amaç: bugün SQL ya da ortam değişkeniyle yapılan her ayarı admin ekrandan yapar; gelen ve giden akışın
sağlığını görür; takılan satırları yeniden kuyruğa alır. Dört parça, dört kabul raporu değil **tek** kabul raporu
(`docs/faz7-kabul-raporu.md`), her parça ayrı commit dizisi.

## Parçalar

| # | Parça | Süre | Ekran |
|---|---|---|---|
| 7a | Sağlık paneli: gelen kutusu + outbox durumları, dead/failed satırları yeniden kuyruğa alma, acil durdurma | 1,5 gün | `#/admin` → Sağlık |
| 7b | Ayar ve eşleme ekranları: aşama → platform olayı, form alanı → lead alanı, sağlayıcı ayarları, EUR kurları | 1,5 gün | `#/admin` → Eşlemeler · Ayarlar |
| 7c | Google `requestStatus`: gönderilen isteklerin platformdaki akıbeti | 0,5 gün | Sağlık panelinde satır detayı |
| 7d | Kişi birleştirme ve kuruluş arşivleme (6d kalanları) | 1–1,5 gün | Kişiler sayfası |

Sıra: 7a → 7b → 7c → 7d. Her parçanın sonunda `npm run verify` yeşil ve tarayıcı kontrolü.

## 7a — Sağlık paneli

**Ne görünür (yalnız admin):**
- Gelen kutusu (`inbound_webhook_events`): sağlayıcı × durum sayıları (pending, processing, done, failed), son 24 saatte
  alınan, en eski bekleyen; **failed** satır listesi (sağlayıcı, tür, alınma zamanı, deneme, hata kodu/metni, lead bağı).
- Outbox (`outbound_conversion_events`): sağlayıcı × durum sayıları (pending, failed, dead, skipped, sent), atlama nedeni
  dağılımı, son dağıtım turu; **dead** ve **failed** satır listesi (aşama olayı, lead, deneme, son yanıt kodu, hata).
- Dağıtıcı/gönderici durumu: hangi sağlayıcı yapılandırıldı (`bootAdFeedback.providers`), `ENABLED_PROVIDERS`, acil durdurma
  anahtarı (`integration_settings <provider>/outbound_enabled`) — **ekrandan aç/kapat**.
- Payload temizliği: son temizlik zamanı ve bekleyen (30 günden eski) payload sayısı.

**Yapılabilen:** dead → pending (yeniden kuyruğa al, tek ya da toplu), failed → şimdi dene (`next_attempt_at = now`),
inbox failed → pending (yeniden işle). Her işlem log'a `actorUserId` ile yazılır; kişisel veri yok.

**Kod:**
- `ad-feedback/application/ports.ts` → `OutboxRepository` ek: `stats()`, `list({status, provider, limit})`, `requeue(ids, now)`.
  `health.ts` (yeni): `OutboxHealthQueries` + `RequeueOutbound` komutu (saf kural: yalnız `dead`/`failed` yeniden
  kuyruğa alınır; `skipped`/`sent` reddedilir → `outbox.not_requeueable`).
- `lead-intake/application/ports.ts` → `InboxRepository` ek: `stats()`, `listFailed(limit)`, `requeue(ids, now)`;
  `health.ts`: `InboxHealthQueries` + `RequeueInbound`.
- Postgres uygulamaları + bellek içi sahteler; testler (`outbox.test.ts`, `inbox.test.ts`, application testleri).
- API: **yeni router** `integration-settings/api/adminRouter.ts`, sunucuda `app.use("/api/admin", auth, adminOnly, router)`.
  Uçlar: `GET /health`, `GET /outbox?status=&provider=`, `POST /outbox/requeue {ids}`, `GET /inbox/failed`,
  `POST /inbox/requeue {ids}`, `POST /providers/:provider/outbound {enabled}`. Admin dışı → 403 `admin_only`.
- UI: `src/pipeline/admin/AdminPage.tsx` (sekmeler: Sağlık · Eşlemeler · Ayarlar), `HealthTab.tsx`; üst menüde **Yönetim**
  yalnız admin'e görünür; rota `#/admin`. 60 sn'de bir yenilenir, "Şimdi yenile" düğmesi.

## 7b — Ayar ve eşleme ekranları

**Eşlemeler sekmesi**
- Aşama → platform olayı (`platform_stage_mappings`): sağlayıcı başına altı aşama satırı; olay adı / dönüşüm işlemi
  kimliği, açık/kapalı, optimizasyon hedefi (sağlayıcı başına en çok bir). Boş olay adı kaydedilemez (`mapping.event_name_required`).
- Form alanı → lead alanı (`form_field_mappings`): sağlayıcı ve form (varsayılan `*` ya da form kimliği); satır ekle, hedef
  seç (`full_name … ignore`), aktif/pasif, sil. Aynı sağlayıcı+form+alan tek satır (DB indeksi zaten var → `mapping.duplicate`).
- Kaydedilen eşleme **hemen** geçerli (depolar her çağrıda okur; önbellek yok). Dead/skipped `mapping_missing` satırları
  için ekranda "eşleme eklendikten sonra yeniden kuyruğa al" ipucu (7a ile bağ).

**Ayarlar sekmesi**
- Sağlayıcı ayarları (`integration_settings`, secret olmayanlar): Meta `dataset_id`, `page_id`, `form_ids`; Google
  `customer_id`, `login_customer_id`; `outbound_enabled` (7a ile aynı anahtar). Secret'lar **gösterilmez, girilmez**;
  yalnız "tanımlı / tanımlı değil" rozeti (ortam değişkeni adıyla; ADR-0004).
- **EUR kurları**: `integration_settings app/eur_rates` (JSON). Öncelik: ayar → `EUR_RATES` env → varsayılan. Pano ve
  raporlar kurları her istekte ayardan okur (60 sn önbellek). Geçersiz JSON reddedilir (`parseEurRates` zaten var).
  Kur satırı: para birimi, EUR karşılığı, son güncelleme.

**Kod:**
- `integration-settings/domain`: `validateStageMapping`, `validateFieldMapping`, `validateEurRates` saf fonksiyonlar + testler.
- `ports.ts` ek: `StageMappingRepository.upsert`, `FieldMappingRepository.upsert/remove/list`; Postgres + bellek içi.
- `application`: `IntegrationSettings` ek: `saveStageMapping`, `saveFieldMapping`, `removeFieldMapping`, `eurRates()`.
- `sales-pipeline`: `eurRates` statik değer yerine `EurRatesSource` portu (fonksiyon); bootstrap ayardan besler. Mevcut
  `parseEurRates`/`DEFAULT_EUR_RATES` kalır.
- API (`/api/admin`): `GET/PUT /stage-mappings/:provider`, `GET/PUT/DELETE /field-mappings/:provider`,
  `GET/PUT /settings/:provider`, `GET/PUT /eur-rates`.
- UI: `MappingsTab.tsx`, `SettingsTab.tsx`; metinler TR/EN (`admin.*`).

## 7c — Google requestStatus

- Migration `0012_faz7_outbox_request_id.sql`: `outbound_conversion_events.request_id text` (+ `organizations.archived_at`,
  `persons.merged_into_id` 7d için aynı migration'da).
- `SendResult ok` → `requestId` taşır (Google istemcisi zaten döndürüyor); `markSent(ids, code, now, requestId)`.
  Meta için boş.
- Google istemcisine `retrieveStatus(requestIds)` eklenir (`POST …/v1/requestStatus:retrieve`; alan adları ADR-0012 ve
  Google belgesinden kod yazılırken doğrulanır). Saf çevirici: platform yanıtı → `{requestId, status: processing|success|
  partial|failure, errorCount, warningCount}`.
- API: `GET /api/admin/outbox/:id/status` (yalnız `sent` + `request_id` dolu satır; Google dışı → 409 `status.unsupported`).
  Sonuç satır detayında gösterilir; sayfa toplu sorgulamaz (kota).
- Google göndericisi yapılandırılmamışsa düğme pasif, açıklama "servis hesabı anahtarı yok".

## 7d — Kişi birleştirme ve kuruluş arşivleme

- **Kişi birleştirme** (`MergePersons` komutu, tek transaction): hedef kişi kalır; kaynağın lead'leri, aktiviteleri
  (lead üzerinden), kuruluş bağı hedefe taşınır; hedefte boş olan e-posta/telefon/firma kaynaktan dolar; kaynak satırı
  **silinmez**, `merged_into_id` alır ve listelerde gizlenir (arama yine bulur, "→ birleşti" rozeti). Aynı kişi, zaten
  birleşmiş kaynak ya da döngü reddedilir (`person.merge_invalid`). Görüntüleyici yapamaz; satışçı yalnız iki kaynağı da
  görebiliyorsa (lead görünürlüğü) birleştirir, admin her zaman.
- **Kuruluş arşivleme** (`ArchiveOrganization`): `archived_at` dolar; listelerden ve seçim kutularından düşer, bağlı lead
  ve kişiler **kalır** (lead detayında "arşivlendi" rozeti). Geri alma: `UnarchiveOrganization`. Silme yok.
- API: `POST /persons/:id/merge {sourceId}`, `POST /organizations/:id/archive`, `POST /organizations/:id/unarchive`.
- UI: Kişiler sayfasında kişi satırında "Birleştir" (hedef seçimi aramayla), kuruluş satırında "Arşivle"; filtre "arşivlenenleri göster".

## 7e — Müşteri bilgilerini yalnız yönetici değiştirir (2026-11-10 isteği)

Elshan Bey dışındaki satışçılar müşteri bilgilerini değiştiremez. Satışçı **yapabilir:** kendi lead'ini bir sonraki aşamaya
taşır, aktivite ekler/tamamlar, havuzdan üstlenir, not yazar. Satışçı **yapamaz:** kişi kimliği (ad, e-posta, telefon, firma),
kuruluş kaydı (oluştur/düzenle/arşivle), fırsat alanları (tutar hariç kort sayısı/modeli, beklenen kapanış, kuruluş bağı),
lead'i başkasına atama, silme, birleştirme. Kural **sunucuda** (`application` katmanı: `ensureAdmin` ya da yeni
`Permission` kuralı, saf ve testli) ve arayüzde (düğmeler gizli, formlar salt okunur, "yalnız yönetici" ipucu).
Görüntüleyici zaten hiçbir şeyi değiştiremez. Tutar: Teklif/Kazanıldı adımında satışçı girer (aşama kuralı), sonradan
değişiklik yöneticide.

## 7f — Eski müşteri listesinin aktarımı (MySQL `b5l1shhnklxmq4ogmpjc`)

İki tablo var:

| Tablo | Satır | İçerik | Öneri |
|---|---|---|---|
| `MusteriBilgileri` | 390 | Ad, telefon (382), e-posta (369), adres, VAT, ülke (`UlkelerBilgileri.IsoKodu`), açan kullanıcı. **321'i** `SiparisAlTablo`'da en az bir sipariş/teklifle bağlı | Her satır → kişi + lead (`source = import`). Siparişi olan → **WON** (tutar: son siparişin `ToplamFiyat`/`ParaTipi`), olmayan → **CONTACTED**. Sorumlu: `CreatedByKullaniciID` (pasif/eşleşmeyen → havuz) |
| `Clients` | 188 | Ad soyad, e-posta (tekil), telefon, ülke adı, şehir, talep metni (`details`), açan kullanıcı, tarih | Her satır → kişi + lead `NEW` (gelen kutusu), talep metni `notes`; e-postası `MusteriBilgileri`'nde olan **aynı kişiye** bağlanır, ikinci lead açılmaz |

Betik: `npm run db:import-mysql` (`scripts/import-mysql-customers.ts`, `bootstrap/importMysql.ts`), `db:migrate-legacy` ile aynı
yöntem: aynı komutlar (`CreateLead`, `ChangeLeadStage`), eski kimlik `platform_lead_id = mysql:<tablo>:<id>` ile yeniden
çalıştırma güvenli; kuru çalıştırma `--dry-run`; rapor (açılan, var olan, atlanan + neden). Ülke `IsoKodu` ile, telefon
`NumaraBirimi` ile E.164'e; kişisel veri loglanmaz. `UlkelerBilgileri` sözlüğü yalnız çeviri için okunur. Gelen olaylar
`import` kaynağında platformlara **gitmez** (dağıtıcı `manual_source` atlar).

## Çatışmalar ve kararlar (onay için)

| # | Konu | Önerim |
|---|---|---|
| 1 | Admin API nerede? | Yeni `integration-settings/api` router'ı `/api/admin`; ad-feedback ve lead-intake'e yalnız `application` kapısından erişir (modül kuralı 3). Sağlık sorguları ilgili modülde kalır, router birleştirir |
| 2 | Yeniden kuyruğa alınan dead satır tekrar dead olursa? | Normal deneme döngüsü (1, 5, 30, 120, 720 dk) baştan başlar: `attempts = 0`. Log'a `requeuedBy` yazılır |
| 3 | EUR kurları env'den ayara geçince `EUR_RATES` ne olur? | Yalnız **ilk** değer/fallback. Ayar varsa env yok sayılır; `.env.example` buna göre güncellenir, decisions.md 24 "Verildi" olur |
| 4 | Kişi birleştirmede kaynak silinsin mi? | Hayır, `merged_into_id` ile kalır (geri izlenebilirlik; lead_stage_events kişiye değil lead'e bağlı, bozulmaz) |
| 5 | Kuruluş silme? | Yok, yalnız arşiv (6d kararı korunur) |
| 6 | `requestStatus` toplu mu? | Hayır, satır başına istekle (kota ve basitlik); gerekirse Faz 8 sonrası zamanlayıcı |
| 7 | Yönetim menüsü kime? | Yalnız `admin` rolü; görüntüleyici ve satışçı `#/admin` yazarsa "yetki yok" sayfası |

## Bitti tanımı (Genel plan)

- İş kuralları saf ve testli (`validate*`, `RequeueOutbound` kuralı, `MergePersons` kuralları)
- Dış bağımlılıklar port arkasında; Postgres + bellek içi uygulamalar
- Tek transaction: birleştirme, yeniden kuyruğa alma toplu işlemleri
- Logda kişisel veri yok; secret ekranda görünmez
- Arayüz TR/EN; sözlük testi geçer (admin router sağlayıcı adını yalnız veriden alır)
- Migration `0012` geri alınabilir; `migrate.test.ts` güncel
- Kabul raporu `docs/faz7-kabul-raporu.md`; README "Yönetim paneli" bölümü; yol haritası durumu; ADR-0013 eki (kişi birleştirme, arşiv)
- `decisions.md` 24 (EUR kurları) → Verildi; madde 19 (olay adları) ve 22 (dönüşüm işlemleri) artık ekrandan girilebilir notu

## Kabul kriterleri

| Kriter | Doğrulama |
|---|---|
| Admin SQL'siz ayar değiştirir | Tarayıcıda: Meta olay adı değiştir → `platform_stage_mappings` güncel; EUR kuru değiştir → pano toplamı değişir |
| Dead satır yeniden kuyruğa alınır ve dağıtıcı onu tekrar dener | Test: dead → requeue → `claimDue` satırı döner; API 200 |
| Acil durdurma ekrandan | Anahtar kapalıyken dağıtıcı `emergency_stop` atlar (mevcut test) + ekran değeri DB ile aynı |
| requestStatus sonucu görünür | Sahte Google uçlu test: `PROCESSING`/`SUCCESS` çevrimi; UI satır detayı |
| Birleştirme ve arşiv kuralları | Application testleri: lead taşındı, kaynak gizli, döngü reddi; arşivli kuruluş seçim kutusunda yok |
