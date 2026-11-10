# Unixpadel Satış Panosu (v2)

Satış ekibinin ortak müşteri panosu. React + Vite arayüz, Node (Express, tsx) sunucu; giriş şirket
kullanıcı tablosuyla yapılır.

```bash
npm install
npm run dev        # API sunucusu (8787) + Vite (http://localhost:5173) birlikte
```

Üretim: `npm run build` sonra `npm start` (sunucu `dist/` klasörünü de servis eder, tek port: 8787).

## Satış pipeline'ı (Faz 1)

Lead'ler, aşamalar ve aşama geçmişi `src/modules/sales-pipeline` altında, Postgres'te tutulur
(`DATABASE_URL`; yoksa yerelde PGlite `server/data/pglite`). Arayüz: **Gelen kutusu** (`#/inbox`),
**lead detayı** (`#/lead/<id>`) ve **Pano** (`#/pipeline`, 6 sütun). Kurallar sunucuda
(`src/modules/sales-pipeline/domain`):

| Aşama | Kod | Ek bilgi |
|---|---|---|
| Yeni lead | `NEW` | otomatik, lead açıldığında |
| İletişim kuruldu | `CONTACTED` | — |
| Nitelikli | `QUALIFIED` | üç soru, üçü de "evet" |
| Teklif gönderildi | `PROPOSAL` | — |
| Kazanıldı | `WON` | tutar + para birimi; terminal |
| Kaybedildi | `LOST` | neden (sabit liste); terminal |

- Yalnız ileri; atlanan aşamalar aynı anda `auto_fill` olarak yazılır. Yanlış tık için **10 dakika geri al**
  (olay silinmez, `undone_at` alır; outbox satırları `skipped` olur).
- Aşama değişikliği + aşama olayı + etkin platform başına outbox satırı **tek transaction**. Faz 1'de
  platform yok (`ENABLED_PROVIDERS` boş), outbox satırı yazılmaz.
- Satışçı kendi lead'lerini ve bölgesindeki (ülke kuralı) havuz lead'lerini görür; havuzdaki lead'i
  değiştiren onu üstlenir. Admin hepsini görür ve atar; görüntüleyici salt okunur.
- Mükerrer kişi: aynı normalize e-posta ya da E.164 telefon → aynı kişiye bağlı yeni lead.
- Görünen adlar ve kayıp nedenleri `stage_definitions` / `lost_reasons` tablolarından (TR/EN); dil
  kullanıcı menüsünden değişir.

Komutlar: `npm run db:migrate` (şema), `npm run db:migrate-legacy -- --dry-run` (eski JSON veriyi
taşıma provası; `--dry-run` olmadan yazar; sorumlu adları kullanıcı tablosundan ya da
`--owners "Ad=ID,..."` ile eşlenir). Bugün / Kişiler / Raporlar sayfaları geçiş süresince eski JSON
veriyle çalışır.


## Gelen lead akışı (Faz 2)

Meta Lead Ads ve Google Ads lead formları `src/modules/lead-intake` üzerinden düşer:

- **Webhook uçları** (oturumsuz, genel JSON ayrıştırıcıdan önce bağlı): `GET/POST /webhooks/meta`
  (`hub.challenge`; `X-Hub-Signature-256` ham gövde üzerinde, sabit zamanlı) ve `POST /webhooks/google`
  (`google_key`). Doğrulanan bildirim `inbound_webhook_events` tablosuna **şifreli** yazılır ve hemen 200
  döner. Gövde sınırı 1 MB, IP başına hız sınırı.
- **İşleyici** (her 5 sn): inbox → kaynak adaptörü → `InboundLeadDto` → Faz 1 `CreateLead`. Geçici hata
  1, 5, 30, 120, 720 dk sonra yeniden denenir; kalıcı hata `failed`. Aynı bildirim iki kez → tek lead.
- **Meta:** lead'in tamamı Graph API'den `leadgen_id` ile çekilir; `field_data` → `form_field_mappings`;
  eşlenmeyen alan "ek yanıt". Saatlik yedek senkron son 2 saatin lead'lerini aynı inbox'a yazar.
  Kurulum: `docs/runbooks/meta-lead-ads.md`, `npx tsx scripts/meta-subscribe.ts --page <PAGE_ID>`.
- **Google:** `user_column_data` → `column_id` eşlemesi, `gcl_id` → `lead_attribution.gclid`, `is_test`
  → test lead; tanınmayan sütun yok sayılır. Kurulum: `docs/runbooks/google-lead-form.md`.
- **Bildirim:** `LeadCreated` olayında atanan satışçıya başlıktaki zilde bildirim ve (SMTP varsa) e-posta.
- Yerel deneme: `.claude/launch.json` içindeki `crm-webhook-smoke` ayarı sahte secret'larla açar;
  `scripts/dev.mjs --set=KEY=VALUE` ile `.env`'e dokunmadan değişken verilir.

## Web sitesi formu (Faz 3)

unixpadel.com formu aynı inbox'a `web` sağlayıcısıyla düşer; gelen kutusunda "Web" rozetiyle görünür:

- **Uç:** `POST /forms/web` (oturumsuz, genel JSON ayrıştırıcıdan önce). Ham gövde üzerinde
  `X-Webform-Signature: sha256=<HMAC>` ve `X-Webform-Timestamp` (±300 sn); IP başına dakikada 120, 256 KB.
  Anahtar `WEB_FORM_HMAC_KEY` yalnız CRM ve site sunucusunda, tarayıcıya inmez.
- **Gövde:** `submission_id` (site üretir; tekrar → aynı lead), `fields` → `form_field_mappings` (`web`,
  seed `0005`; eşlenmeyen alan ek yanıt), `attribution` (gclid, gbraid, wbraid, fbclid, fbc, fbp, UTM,
  landing_url) → `lead_attribution`, `consents` → `lead_consents` (aydınlatma metni sürümüyle),
  `honeypot` dolu → lead açılmaz ama 200.
- **Site tarafı:** `integrations/web-form-relay/` bağımlılıksız Node aktarıcısı formu alır, önce diske yazar,
  imzalayıp CRM'e iletir; CRM kapalıysa kuyrukta tutup yeniden dener (hiçbir gönderim kaybolmaz).
  Kurulum ve başka dil için sözleşme: `docs/runbooks/web-form.md`, karar: ADR-0010.
- Yerel deneme: `crm-webhook-smoke` + `web-form-relay-smoke` launch ayarları.

## Meta geri bildirimi (Faz 4)

Her aşama değişikliği 10 dakika sonra (geri alma hakkı) Meta'ya CRM olayı olarak gider; dağıtıcı platformdan
bağımsızdır ve Faz 5'te Google için de kullanılır (`src/modules/ad-feedback`):

- **Kuyruk:** aşama değişikliği `outbound_conversion_events`'e aynı transaction'da satır yazar
  (`ENABLED_PROVIDERS=meta` olmadan yazılmaz). Durumlar: pending → sent | dead | skipped; geçici hata `failed`.
- **Dağıtıcı** (her dakika, `SKIP LOCKED`): filtreler → `skipped` + neden (acil durdurma, geri alma, test, manuel/
  import, onay yok, eşleme yok/kapalı, eşleştirme anahtarı yok); sağlayıcı başına toplu gönderim (100); 2xx `sent`,
  400 `dead` (toplu istekte tek tek yeniden denenir), 429/5xx/zaman aşımı 1, 5, 30, 120, 720 dk sonra, sonra `dead`.
- **Meta:** `POST /{DATASET_ID}/events`; `event_name` `platform_stage_mappings`'ten (seed `0006`), `lead_id` 64-bit
  sayı, `em`/`ph` SHA-256, `custom_data.event_source = crm`, `lead_event_source = Unixpadel CRM`, WON'da (girildiyse PROPOSAL'da da) tutar;
  web formu lead'leri `action_source: website` + `fbc`/`fbp`. Staging'de `META_TEST_EVENT_CODE`.
- **Günlük dead-letter raporu** `OUTBOX_REPORT_TO` adreslerine; **acil durdurma** `integration_settings`
  `meta/outbound_enabled`. Geriye doldurma: `npx tsx scripts/outbox-backfill.ts --provider meta --dry-run`.
- Kurulum ve işletme: `docs/runbooks/meta-capi.md`; kararlar ADR-0011.

## Google geri bildirimi (Faz 5)

"Nitelikli" ve "Kazanıldı" aşamaları Google Ads'e dönüşüm olarak gider; Faz 4'ün dağıtıcısı değişmeden kullanılır,
Google yalnız bir gönderici ekler (`src/modules/ad-feedback/adapters/google-data-manager`, builder `builders/google`):

- **Data Manager API** `POST /v1/events:ingest`; servis hesabı JWT → OAuth token (kütüphanesiz), yalnız Authorization
  başlığında; hedef = Google Ads müşteri kimliği + dönüşüm işlemi (`platform_stage_mappings`, seed `0008` kapalı; kimlik
  gelince açılır). Staging'de `GOOGLE_DM_VALIDATE_ONLY=1` ile doğrulama modu.
- **Normalleştirme:** e-posta küçük harf, boşluksuz, gmail/googlemail'de nokta ve `+` sonrası silinir; telefon E.164 `+`
  dahil; SHA-256 hex. Aynı telefon için Meta ve Google hash'leri farklıdır (test bunu doğrular).
- **Pencere:** tıklama kimliğiyle 90 gün, yalnız e-posta/telefonla 63 gün (config'te); aşımı `skipped: expired`.
  Meta formu lead'leri varsayılanda Google'a gitmez (`GOOGLE_SEND_SOURCES`).
- Kurulum ve işletme: `docs/runbooks/google-data-manager.md`; belge doğrulaması ve kararlar ADR-0012.

## Satış panosu: aktiviteler (Faz 6a)

Pipedrive benzeri fırsat yönetimi yeni veri modeli üzerinde geri geliyor (plan: `docs/yol-haritasi.md`, karar:
ADR-0013). Lead = fırsat; ayrı "deal" kaydı yok. Faz 6a:

- **Aktiviteler** (`activities`): arama, e-posta, toplantı, teklif gönderimi, saha ziyareti; lead detayında eklenir,
  tamamlanır, silinir. API: `POST /api/pipeline/leads/:id/activities`, `POST /activities/:id/done`,
  `DELETE /activities/:id`, `GET /activities/today`.
- **Kural 1, takipsiz:** açık aşamadaki lead'in açık aktivitesi yoksa kartta kırmızı "Takipsiz" rozeti; aksi halde
  sonraki aktivitenin vadesi görünür (`openActivities`, `nextActivity`, `rotting` liste ve detayda).
- **Kural 2, teklif takibi:** "Teklif gönderildi"ye giriş 3 gün sonra 09:00 (Europe/Istanbul) için arama açar;
  10 dakikalık geri al onu da siler.
- **Bugün** sayfası: gecikmiş / bugün / yaklaşan; satışçı kendi ve havuzdaki lead'lerin işlerini, admin hepsini görür.
  Üst menüdeki rozet gecikmiş + bugün sayısıdır.

## Satış panosu: fırsat alanları, filtreler, kolon istatistikleri (Faz 6b)

- **Fırsat alanları lead'de:** kort sayısı, kort modeli, beklenen kapanış (`court_count`, `court_model`,
  `expected_close_date`). Yeni lead formunda ve lead detayında "Düzenle" ile; firma, şehir, ürün ilgisi ve not da
  oradan düzenlenir. API: `PATCH /api/pipeline/leads/:id` (yalnız gönderilen alanlar değişir; boş değer temizler).
  Tutar aşama olayında kalır (Teklif / Kazanıldı); e-posta ve telefon 6d'de.
- **Kural 4, kolon istatistikleri:** her kolon başlığında adet, toplam tutar (EUR'a çevrilmiş) ve ortalama bekleme
  günü; `GET /api/pipeline/board` filtrelenmiş kümeyle birlikte döner. Kurlar `EUR_RATES` ortam değişkeni
  (`{"USD":0.92,"GBP":1.17,"TRY":0.027}`), yoksa bu varsayılan; Faz 7'de ekrandan düzenlenecek.
- **Filtreler:** sorumlu (ben / ortak havuz / kişi) · ülke · takipsiz. URL'de taşınır
  (`#/pipeline?owner=me&country=TR&rotting=1`), tarayıcıda hatırlanır; panoya parametresiz girince son filtre uygulanır.
- **Kart:** kort sayısı, son tutar, beklenen kapanış (geçmişse turuncu) ve aşamada geçen gün.

## Satış panosu: raporlar (Faz 6c)

"Raporlar" sayfası artık yeni aşama olaylarından (`leads` + `lead_stage_events`) üretilir; eski JSON rapor sayfası
kaldırıldı. API: `GET /api/pipeline/reports?months=12` (1–36 ay). Satışçı kendi + havuzdaki lead'leri, admin hepsini
görür; test lead'leri hiçbir rapora girmez.

- **KPI:** açık hat değeri (son teklif tutarıyla), bu ay kazanılan, kazanma oranı (kapananlar içinde), gelen lead.
- **Aylık kazanılan:** Kazanıldı olayının ayına göre (Europe/Istanbul takvimi), EUR karşılığı (`EUR_RATES`).
- **Aşamaya göre dönüşüm:** o aşamaya ulaşıp kapanan lead'lerden kazanılanların payı; açık lead'ler oranı sulandırmaz.
- **Ülkeye göre açık hat**, **kayıp nedenleri** (son Kaybedildi olayındaki kod), **kaynağa göre lead** (dönemde
  oluşturulanlar ve kazanılanları).
- Dönem 6 / 12 / 24 ay, tarayıcıda hatırlanır. Boş veride sayfa sıfır çubuklar ve "—" ile çalışır.

## Satış panosu: kişiler ve kuruluşlar (Faz 6d)

Faz 6 bu parçayla tamamlandı; arayüzün tamamı yeni modelde çalışır, eski JSON panosu ve `/api/db/*` kaldırıldı.

- **Kuruluşlar** (`organizations`): kulüp / yatırımcı / distribütör / yüklenici / diğer; aynı ad + ülke tek kayıt.
  Kişiler ve lead'ler kuruluşa bağlanır (`organization_id`); lead'deki serbest `company` metni geçiş süresince kalır.
  API: `GET/POST /api/pipeline/organizations`, `PATCH /organizations/:id`.
- **Kişiler** sayfası (`#/contacts`): Kuruluşlar ve Kişiler sekmeleri, sunucuda arama; kuruluş satırı açılınca bağlı
  kişiler ve görünür lead'leri; kişi satırında lead çipleri (aşama, tutar). `GET /persons?q=&organizationId=`.
- **Kimlik düzenleme:** lead detayındaki Kişi panelinden ad, e-posta, telefon; lead ve bağlı kişi birlikte güncellenir,
  e-posta ya da telefondan biri kalmalı, başka kişiye kayıtlı e-posta/telefon reddedilir. `PATCH /leads/:id/contact`.
- **Üst menü araması** sunucudan: görünür lead'ler, kişiler, kuruluşlar (`GET /search?q=`).
- `npm run db:migrate-legacy` eski kuruluşları ve 28 aktiviteyi de taşır; yeniden çalıştırmak güvenlidir (`legacy_id`).

Sonraki: Faz 7 yönetim paneli (eşleme ve ayar ekranları, sağlık paneli, kurlar), Faz 8 canlıya alma.

## Satış takip: Excel uyumu (Faz 7g)

Excel satış takip dosyasının bütün işlevleri CRM'de (`docs/satis-takip-is-emri.md`, ADR-0014,
`docs/satis-takip-kabul-raporu.md`). Temas bir kez kaydedilir; Excel'in ✔, Evet + tarih, son/ilk temas ve temas sayısı
sütunları bu kayıtlardan türetilir.

- **Lead listesi** (`#/list`, açılış sayfası; eski "Gelen kutusu"nun yerinde): Excel'in sütun grupları, başlıkta ▾
  menüsü (sayılı değer listesi, sıralama, Alt+↓), hızlı çipler (Hiç ulaşılmamış, Sıcak, Takipsiz, yöneticide Uyarılı),
  arama (ad, telefon, e-posta, Excel No), satır içinde "Temas kaydet" ve müşteri durumu, yöneticide CSV (`;`, UTF-8 BOM).
- **Temas kaydet** (lead sayfası, liste satırı, Bugün "Tamamla…", panoda NEW → İletişim kuruldu): kanal, sonuç, not,
  sonraki takip, müşteri durumu ve aşama tek istekte (`POST /api/pipeline/leads/:id/contacts`); 10 dk geri al
  (`POST /contact-logs/:id/undo`) aşamayı da geri alır. WhatsApp / e-posta / arama bağlantısından tek dokunuşla kayıt.
- **Lead sayfası:** Temas özeti, Müşteri durumu, Ürün tercihleri (adet 1–29, çatı ölçüsü), Form cevapları, yöneticide
  Veri uyarıları ("Kontrol edildi").
- **Bugün:** Yapılacaklar | Temas geçmişi; hiç ulaşılmamış sıcak lead şeridi.
- **Raporlar → Özet rapor:** Excel ÖZET RAPOR'un 5 bölümü (`GET /api/pipeline/reports/tracking`), kapsam "Excel
  listesi"; sıfır olmayan her sayı o lead'leri listede açar.
- **Aktarım:** `npm run db:import-excel -- <dosya.xlsx> [--dry-run] [--owners owners.json] [--verify]`
  (`docs/runbooks/excel-aktarimi.md`).
- Ürün tercihlerini lead'in sorumlusu satışçı da girer (havuz lead'ini önce üstlenir); `REPS_EDIT_PRODUCTS=0` yalnız
  yöneticiye bırakır.

## Geliştirme kuralları (Faz 0'dan itibaren)

- Mimari kararlar `docs/adr/` altında; açık kararlar ve sahipleri `docs/decisions.md`.
- Yeni kod `src/modules/` altındaki modüler yapıya yazılır; sınırlar `src/modules/README.md` ve `.dependency-cruiser.cjs`.
- Her PR'da `npm run verify` yeşil olmalı: lint, format, tip kontrolü, mimari test, secret tarama, testler.
  `npm run build` de önce bunu çalıştırır. CI aynı zinciri `.github/workflows/ci.yml` ile koşar.
- PR şablonundaki "Bitti tanımı" listesi her PR'da işaretlenir.

| Komut | Ne yapar |
|---|---|
| `npm run lint` | ESLint (typescript-eslint, react-hooks) |
| `npm run format` / `format:check` | Prettier |
| `npm run typecheck` | `tsc` arayüz + modüller |
| `npm run arch` | dependency-cruiser katman ve modül kuralları |
| `npm run secrets` | secretlint |
| `npm run test` / `test:coverage` | Vitest; kapsam eşiği domain + application ≥ %90 |
| `npm run db:migrate` / `db:migrate-legacy` | Şema migration'ları / eski JSON veriyi taşıma |
| `npm run verify` | Hepsi sırayla |

## Giriş ve şifreler

Giriş, şirketin **KullaniciBilgileri** tablosuyla yapılır (Clever Cloud MySQL):
**kullanıcı adı ya da e-posta** + tablodaki şifre (`Sifre`, düz metin). Yalnız `Durum = Aktif` olanlar
girebilir. Şifre sunucuda karşılaştırılır; tarayıcıya ya da günlüğe yazılmaz.

Kurulum: `.env.example` → `.env`; `AUTH_DB_URL` satırına Clever Cloud bağlantısını yazın
(panelden kopyalanan MySQL bağlantı adresi; biçim `.env.example` içinde). Sunucu açılışta tabloyu okuyup kayıt sayısını
günlüğe yazar. Yardımcı betikler: `node scripts/list-users.mjs` (kim girebilir, şifresiz),
`node scripts/test-login.mjs` (giriş kontrolünü gerçek tabloyla dener, şifre yazdırmaz).

- **Ad:** tablodaki `Ad` (ör. "Mohamed"); eski ekip üyeleri panodaki yazımı korur (`Yusa` → "Yuşa").
- **Rol:** `YetkiTuru = Yonetici` → yönetici; `Temsilci` → satışçı; Muhasebe / Fabrika / Lojistik /
  Gözlemci → **görüntüleyici** (her şeyi görür, hiçbir şeyi değiştiremez; sunucu da reddeder).
- Satışçı listesi (kime müşteri atanabilir) tablodan gelir: `/api/users` → aktif Yönetici + Temsilci.
- `AUTH_DB_URL` tanımlı değilse eski yöntem çalışır: @unixpadel.com adresi + posta şifresi (IMAP).
- Yerelde denemek için: `CRM_DEV_PASSWORD=birsey npm run dev` → herkes o şifreyle girer. Gerçek sunucuda **asla**.

**E-posta okuma şimdilik kapalı** (`MAIL_ENABLED=0`): çekmecede E-postalar sekmesi yok, sunucu posta
sunucusuna bağlanmaz. Geri açmak için `.env` içinde `MAIL_ENABLED=1`.

Ortam değişkenleri: `API_PORT` (8787), `AUTH_DB_URL`, `AUTH_DB_TABLE` ve `AUTH_DB_*_COL` (bkz. `.env.example`),
`MAIL_ENABLED`, `IMAP_HOST`, `IMAP_PORT`, `MAIL_DOMAIN`, `CRM_DATA` (yalnız `db:migrate-legacy` girdisi: eski JSON dışa aktarımı, varsayılan `server/data/crm.json`),
`DATABASE_URL` (Postgres; yoksa PGlite), `PGLITE_DIR`, `UNDO_WINDOW_MINUTES` (10), `ENABLED_PROVIDERS` (Faz 4–5), `EUR_RATES` (Faz 6b),
Faz 2: `INBOX_ENCRYPTION_KEY`, `META_*`, `GOOGLE_LEAD_FORM_KEY`, `SMTP_*`, `PUBLIC_BASE_URL`, `INTAKE_*`, `BACKFILL_*` (hepsi `.env.example` içinde).

## Roller

| Hesap | Giriş | Rol |
|-------|-------|-----|
| Elshan | KullaniciBilgileri (Yonetici) | **admin** |
| Admin | admin@unixpadel.com + `server/data/config.json` içindeki `adminPassword` | **admin** (posta kutusu yok) |
| Salah, Yuşa, Ahlem, Mohamed, Simon | KullaniciBilgileri (Temsilci) | satışçı |
| Muhasebe, Fabrika, Lojistik, Gözlemci | KullaniciBilgileri | görüntüleyici |

- **Admin:** tüm lead'leri görür (pano filtresi "Tüm sorumlular"), her lead'in aşamasını, sorumlusunu ve
  alanlarını değiştirir. Sunucu da bunu uygular (403).
- **Satışçı:** kendi lead'leri + ortak havuz (bölge kuralına göre). Başkasının lead'ini görmez; havuzdakini üstlenir.
- **Görüntüleyici:** her şeyi okur, hiçbir şeyi değiştiremez.
- `adminPassword` ilk açılışta rastgele üretilir ve dosyaya yazılır; dosyadan değiştirebilir ya da
  `CRM_ADMIN_PASSWORD` ortam değişkeniyle ezebilirsiniz.

## Ekranlar

Hepsi yeni satış pipeline'ından (`/api/pipeline/*`, Postgres; yerelde PGlite):

| Sayfa | Ne gösterir |
|---|---|
| **Gelen kutusu** (`#/inbox`) | Yeni lead'ler, kaynak rozeti, "geleli" sayacı (1 sa turuncu, 24 sa kırmızı), üstlen |
| **Pano** (`#/pipeline`) | 6 aşama, sürükle-bırak (yalnız ileri; 10 dk geri al), filtreler sorumlu · ülke · takipsiz (URL'de, hatırlanır), kolon başlığında adet · toplam EUR · ort. gün; kartta kort, tutar, beklenen kapanış, sonraki aktivite / Takipsiz |
| **Lead detayı** (`#/lead/<id>`) | Sonraki aşama (Nitelikli 3 soru, Teklif tutarı, Kazanıldı tutar, Kaybedildi neden), Kişi (düzenle), Proje (fırsat alanları, kuruluş), aktiviteler, zaman çizelgesi, kaynak detayı |
| **Bugün** (`#/activities`) | Gecikmiş · bugün · yaklaşan aktiviteler, tek tıkla tamamla |
| **Kişiler** (`#/contacts`) | Kuruluşlar ve kişiler, arama, bağlı lead'ler |
| **Raporlar** (`#/reports`) | Aylık kazanılan, aşamaya göre dönüşüm, ülkeye göre açık hat, kayıp nedenleri, kaynağa göre lead |

Davranış kuralları ve veri modeli: `docs/yol-haritasi.md` bölüm 3–4, ADR-0013. Eski 5 kolonlu pano, hat haritası,
müşteri çekmecesi ve e-posta paneli Faz 6d ile kaldırıldı (e-posta okuma `MAIL_ENABLED` ile sunucuda duruyor,
arayüzü yeniden eklenmedi).

## Veri

- Tek kaynak Postgres (`DATABASE_URL`; yoksa yerel PGlite `server/data/pglite`). Şema `db/migrations/*.sql`, açılışta
  uygulanır (`npm run db:migrate` elle de çalıştırır).
- Eski JSON dışa aktarımı (`server/data/crm.json`, git dışı) yalnız `npm run db:migrate-legacy` girdisidir.
- Gerçek kişi verisi depoda yoktur (`docs/decisions.md` madde 5).

## Tasarım

- `src/styles.css` başındaki token'lar: 8pt aralık, 1.25 tip ölçeği, sıcak kağıt zemin, kolon tonları
  (slate / yeşil / mavi / amber / kırmızı), açık ve koyu tema.
- `npm run contrast` tüm renk çiftlerini WCAG AA'ya göre ölçer.
- Klavye: kartta `Enter` açar; `Ctrl + K` arama. Diyaloglar native `<dialog>` (odak içeride kalır, `Esc` kapatır).
- Hedef: masaüstü ve tablet; telefonda Kanban yatay kaydırma, listeler tek sütun.

Eski tek dosyalık takip sayfası `legacy/` klasöründe duruyor; canlıya alma öncesi silinir (Faz 8).
