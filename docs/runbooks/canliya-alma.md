# Runbook: Canlıya alma (Faz 8)

Kaynak: "Unixpadel — Lead → CRM Entegrasyon Rehberi" (MarcaDM) bölüm 7 ve `docs/yol-haritasi.md` bölüm 7. Bu belge
hosting seçiminden bağımsız adımları yazar. Hosting kararı (ADR-0005, `docs/decisions.md` madde 3) henüz verilmedi;
ona bağlı adımlar "**karar sonrası**" diye işaretlidir.

Kural: bir adım doğrulanmadan sonrakine geçilmez. Gizli anahtarlar yalnız hosting'in gizli ayar deposuna girilir;
e-postaya, sohbete, koda ve bu depoya yazılmaz.

## Sıra

| # | Adım | Kim | Bitti sayılır |
|---|---|---|---|
| 1 | Hosting ve alan adı (ör. `crm.unixpadel.com`, HTTPS) | Yönetim + IT | Adres tarayıcıda açılıyor. **Karar sonrası.** |
| 2 | Postgres 16 (Clever Cloud `SALES_CRM`) ve worker (bölüm 2a) | IT + Yazılım | Worker `/health` 200; şema sürümü 14 |
| 3 | Gizli anahtarlar (aşağıdaki tablo) | IT | Yönetim → Sağlık'ta ilgili satırlar "tanımlı" |
| 4 | Dağıtım: `npm ci`, `npm run build`, `npm start` | Yazılım | `/api/auth/me` 401 dönüyor, giriş ekranı açılıyor |
| 5 | Veri taşıma (aşağıda) | Yazılım | Lead sayıları yerel kopyayla aynı; Özet rapor `--verify` geçiyor |
| 6 | Gelen yön: Meta, Google lead formu, site formu | MarcaDM + Yazılım | Üç test lead'i Lead listesinde, tüm alanlarıyla |
| 7 | KVKK onayı ve aşama adlarının onayı | Hukuk, Satış + MarcaDM | Yazılı onay; `decisions.md` 5, 6, 19 "Verildi" |
| 8 | Giden yön: Meta CAPI, sonra Google Data Manager | MarcaDM + IT + Yazılım | Test Olayları ve Tanılama raporu olayları gösteriyor |
| 9 | Rehberin kontrol listesi (aşağıda) | Hepsi | Sekiz madde işaretli |

## 2. Veritabanı

Yerelde PGlite dosyası kullanılır; canlıda Postgres 16+ şarttır. `DATABASE_URL` tanımlıysa uygulama `pg` sürücüsünü
kullanır ve migration'ları açılışta uygular.

Canlıya çıkmadan önce sorguların gerçek Postgres'te çalıştığı bir kez görülmelidir:

```bash
docker compose -f docker-compose.postgres.yml up -d
```

```bash
DATABASE_URL=postgres://crm@127.0.0.1:54329/crm_smoke npm run db:smoke
```

Duman testi (`scripts/smoke-db.ts`) uygulamanın gerçek kompozisyonunu sentetik veriyle baştan sona çalıştırır: lead
oluşturma, aşama ve geri alma, temas, raporlar, bölge kuralları, kişi birleştirme, arşiv, giden kuyruk, gelen kutusu,
yönetim API'si. Dış servise çağrı yapmaz. Yalnız adı "smoke" ya da "test" içeren veritabanında çalışır.

Durum (2026-11-11): duman testi bellek içi PGlite'ta 8 adımın hepsini geçti. **Gerçek Postgres 16'ya karşı henüz
çalıştırılmadı** (bu bilgisayarda Docker Desktop kapalıydı). Canlıya almadan önce yukarıdaki iki komut çalıştırılmalı.

Yedek: hosting'in günlük Postgres yedeği açık olmalı; canlıya almadan önce bir geri yükleme denenir.

## 2a. Clever Cloud: worker ve SALES_CRM veritabanı

Dağıtım (2026-11): CRM bilgisayarlara masaüstü uygulaması (.exe) olarak dağıtılır; internete açık CRM adresi yoktur.
Clever Cloud'da arayüzsüz, sürekli açık bir Node.js uygulaması (**worker**, `npm run worker`) zamanlanmış işleri
çalıştırır: web sitesi çekme, gelen kutusu → lead, Meta yedek senkronu, reklam geri bildirimi, form tablosu.
Veritabanı Clever Cloud PostgreSQL 16 eklentisi **SALES_CRM** (Paris, encryption at rest açık).

**`UNIXPADEL_ST` (MySQL) başka bir programındır.** CRM orada yalnız `KullaniciBilgileri`'ni okuyarak giriş yapar
(`server/authDb.mjs`, salt okunur). Worker bu veritabanına hiç bağlanmaz; ona `AUTH_DB_URL` girilmez. O veritabanına
yazılmaz, tablo eklenmez, migration çalıştırılmaz.

Belge kaynağı (2026-11-13 okundu): Clever Cloud Node.js, ortam değişkenleri, sağlık denetimi, worker ve PostgreSQL
sayfaları (`https://www.clever.cloud/developers/doc/deploy/applications/nodejs/`,
`…/doc/manage/environment-variables/reference/`, `…/doc/manage/healthcheck/`, `…/doc/manage/workers/`,
`…/doc/deploy/databases/postgresql/`). Özet: uygulama `0.0.0.0` üzerinde `PORT`'u (Clever Cloud 8080 verir) dinlemeli;
başlatma komutu `CC_RUN_COMMAND` ile verilir ve diğer yöntemlerin önüne geçer; `CC_HEALTH_CHECK_PATH` 2xx dönmezse
dağıtım başarısız sayılır; Node sürümü `package.json` → `engines.node` (bugün `>=22`). Worker yalnız `GET /health`
sunar, bu yüzden 8080'i dinler.

### Adımlar

1. **Uygulama oluştur.** Clever Cloud konsolu → Create → an application → **Node.js**; bölge **Paris** (veritabanıyla
   aynı); en küçük boyut, **1 instance**, otomatik ölçekleme kapalı. Ad önerisi: `sales-crm-worker`. Dağıtım yöntemi:
   GitHub deposu (ya da `clever-tools` ile git push). Dağıtılacak dal: `feat/web-pull` main'e birleştikten sonra `main`.
2. **SALES_CRM'e bağla.** Uygulama → **Service dependencies** → "Link add-ons" → `SALES_CRM` → Add. (CLI:
   `clever service link-addon SALES_CRM`.) Bağlantı yeniden dağıtım yapmaz; 4. adımdan sonra `clever restart`.
   Uygulamanın "Environment variables" sayfasında eklentiden gelen `POSTGRESQL_ADDON_URI`, `…_HOST`, `…_PORT`, `…_DB`,
   `…_USER`, `…_PASSWORD` görünür. CRM `DATABASE_URL` yoksa `POSTGRESQL_ADDON_URI`'yi kullanır; ayrıca girilmez.
3. **Ortam değişkenlerini gir** (aşağıdaki tablo). Değerler yalnız Clever Cloud'un ortam değişkeni ekranına girilir;
   e-postaya, sohbete, koda, bu depoya yazılmaz (ADR-0004).
4. **Dağıt ve migration'ı çalıştır.** İlk açılışta worker migration'ları kendisi uygular (`openDatabase`). Logda
   `sales-pipeline hazır … "db":"postgres"` ve `lead-intake hazır … "webPull":true` görünmeli. Ayrı bir bilgisayardan
   `npm run db:migrate` çalıştırmak gerekmez (çalıştırılırsa veritabanı adresi o bilgisayara girmiş olur).
   Bağlantı TLS hatası verirse Clever Cloud belgesi sslmode konusunda bir şey söylemiyor: `DATABASE_URL` olarak
   `POSTGRESQL_ADDON_URI` değerinin sonuna `?sslmode=require` eklenmiş hali girilir.
5. **Worker'ı doğrula.**
   - `GET https://<uygulama>.cleverapps.io/health` → `200 {"ok":true,"webPull":true,"lastPullAt":"…","lastError":null}`.
     Site anahtarı henüz girilmediyse `ok:false`, `lastError:"not_configured"` normaldir; veritabanına ulaşılamıyorsa 503.
   - Şema sürümü 14: Clever Cloud konsolundaki PostgreSQL eklentisinin sorgu ekranından (ya da pgAdmin)
     `SELECT max(version) FROM schema_migrations;` → 14.
   - `docs/runbooks/web-form.md` bölüm 7.5'teki test gönderimi.
   - Masaüstü uygulamasında Yönetim → Sağlık → "Web sitesi formu (çekme)" son turu gösterir.
6. **Anahtar değiştirme.** `WEB_FORM_HMAC_KEY`: web-form runbook'u 7.6. `INBOX_ENCRYPTION_KEY` **değiştirilmez**
   (eski gelen kutusu içerikleri okunamaz hale gelir; 30 gün sonra içerik zaten silinir — değiştirmek gerekirse önce
   bekleyen kuyruğun boşalması beklenir, sonra worker ve tüm masaüstü kurulumları aynı anda güncellenir). Veritabanı
   şifresi: Clever Cloud eklenti ekranından yenilenir, `POSTGRESQL_ADDON_*` kendiliğinden güncellenir, `clever restart`.

### Worker ortam değişkenleri

| Değişken | Değer / not | Gizli |
|---|---|---|
| `CC_RUN_COMMAND` | `npm run worker` | Hayır |
| `CC_HEALTH_CHECK_PATH` | `/health` | Hayır |
| `INBOX_ENCRYPTION_KEY` | `npm run secrets:key`. **Gelen kutusunu işleyen her süreçte aynı değer** (aşağıdaki not) | Evet |
| `WEB_FORM_HMAC_KEY` | Sitenin eklenti ayarıyla aynı | Evet |
| `WEB_PULL_URL` | Sitenin çekme API'si tabanı | Hayır |
| `WEB_PULL_SECONDS`, `WEB_PULL_LIMIT`, `WEB_PULL_MAX_PAGES` | İsteğe bağlı: 120, 50, 10 | Hayır |
| `INTAKE_DEFAULT_COUNTRY` | Ülkesiz yerel telefon için; varsayılan `TR` | Hayır |
| `PUBLIC_BASE_URL` | Bildirim bağlantılarının kökü (internete açık CRM yoksa boş bırakılır) | Hayır |
| `META_SYSTEM_USER_TOKEN`, `META_FORM_IDS` | Meta yedek senkronu, saatte bir (webhook ucu worker'da yoktur; form kimlikleri Yönetim → Ayarlar'dan da girilir) | Token evet |
| `ENABLED_PROVIDERS`, `META_CAPI_TOKEN`, `META_DATASET_ID`, `GOOGLE_DM_SERVICE_ACCOUNT_KEY`, `GOOGLE_ADS_CUSTOMER_ID` | Reklam geri bildirimi (bölüm 8; o adıma kadar boş) | Token ve anahtar evet |
| `SMTP_HOST`, `SMTP_FROM`, `SMTP_USER`, `SMTP_PASSWORD`, `OUTBOX_REPORT_TO` | Günlük "gönderilemeyen olaylar" raporu | Kullanıcı ve şifre evet |
| `SHEET_SYNC_CSV_URL` | Form tablosu eşitlemesi (açık kalacaksa) | Evet (tabloya erişim verir) |

Worker'a **girilmeyecekler:** `AUTH_DB_URL` ve `AUTH_DB_*` (MySQL'e bağlanmaz), `CRM_DEV_PASSWORD`, `CRM_ADMIN_PASSWORD`,
`PGLITE_DIR`, `API_PORT`, `PORT` (Clever Cloud verir), `DATABASE_URL` (yalnız sslmode gerekirse).

Worker'da kullanıcı rehberi (MySQL) olmadığından "yeni lead" bildirimi **uygulama içi** yazılır, e-postası gitmez.

**Not — masaüstü kurulumları ve gelen kutusu:** masaüstü uygulaması aynı veritabanına bağlanırsa kendi süreci de
gelen kutusunu işler (zamanlayıcı her süreçte çalışır; SKIP LOCKED çakışmayı önler). Worker'ın şifrelediği satırı
farklı (ya da hiç) `INBOX_ENCRYPTION_KEY`'i olan bir kurulum kaparsa çözemez: satır 10 dakika kilitli kalır, sonra
yeniden sıraya girer (kayıp yok, gecikme ve hata logu var). Bu yüzden ya her kurulumda aynı anahtar bulunur ya da
masaüstü uygulamasında gelen kutusu işleme kapatılır. Hangisi olacağı ADR-0016 (dağıtım ve gizli bilgiler) kararına
bağlıdır.

## 3. Ortam değişkenleri

Tam liste ve varsayılanlar `.env.example` dosyasındadır. Canlıda en az şunlar girilir:

| Değişken | Ne için | Gizli mi |
|---|---|---|
| `DATABASE_URL` | Postgres bağlantısı (`?sslmode=require` gerekiyorsa adresin sonunda) | Evet |
| `PUBLIC_BASE_URL` | E-posta ve bildirimlerdeki bağlantıların kökü | Hayır |
| `AUTH_DB_URL`, `AUTH_DB_TABLE` | Giriş için şirket kullanıcı tablosu (MySQL) | Evet |
| `CRM_ADMIN_PASSWORD` | Yerel "Admin" hesabı (yoksa `server/data/config.json`) | Evet |
| `INBOX_ENCRYPTION_KEY` | Gelen bildirim içeriğinin şifrelenmesi (`npm run secrets:key`). **Yedeği alınır:** kaybolursa eski içerik okunamaz | Evet |
| `META_APP_SECRET`, `META_VERIFY_TOKEN`, `META_SYSTEM_USER_TOKEN` | Meta webhook doğrulaması ve lead'in Graph API'den çekilmesi | Evet |
| `GOOGLE_LEAD_FORM_KEY` | Google lead formu webhook anahtarı (MarcaDM'e güvenli kanaldan iletilir) | Evet |
| `WEB_FORM_HMAC_KEY` | Site formu aktarıcısının imzası (aynı değer site sunucusunda) | Evet |
| `SMTP_HOST`, `SMTP_FROM`, `SMTP_USER`, `SMTP_PASSWORD` | "Yeni lead" bildirim e-postası; yoksa yalnız uygulama içi bildirim | Kullanıcı ve şifre evet |
| `ENABLED_PROVIDERS` | Geri bildirim açılacak platformlar (`meta`, sonra `meta,google`). **8. adıma kadar boş** | Hayır |
| `META_CAPI_TOKEN`, `META_DATASET_ID` | Meta Conversions API (veri seti kimliği Yönetim → Ayarlar'dan da girilir) | Token evet |
| `GOOGLE_DM_SERVICE_ACCOUNT_KEY`, `GOOGLE_ADS_CUSTOMER_ID` | Google Data Manager API (müşteri kimliği Yönetim → Ayarlar'dan da girilir) | Anahtar evet |
| `OUTBOX_REPORT_TO` | Günlük "gönderilemeyen olaylar" raporunun alıcıları | Hayır |

Canlıda **girilmeyecekler:** `CRM_DEV_PASSWORD` (herkesi aynı şifreyle içeri alır; yalnız yerel deneme),
`META_TEST_EVENT_CODE` ve `GOOGLE_DM_VALIDATE_ONLY` (yalnız staging), `PGLITE_DIR`.

`SHEET_SYNC_CSV_URL` (form tablosu eşitlemesi) Meta webhook'u çalışmaya başlayana kadar açık kalabilir; sonra silinir
(`docs/runbooks/form-tablosu.md`).

## 5. Veri taşıma

Canlı veritabanı boş açılır. Sırayla ve her biri önce `--dry-run` ile (Postgres'te kuru çalıştırma yoksa bir kopya
veritabanında):

1. `npm run db:import-mysql`: eski müşteri ve talep kayıtları (MusteriBilgileri, Clients).
2. `npm run db:import-excel -- <dosya.xlsx> --owners owners.json`, ardından `--verify`
   (`docs/runbooks/excel-aktarimi.md`). Bölge kuralları da buradan yazılır.
3. Form tablosu: `SHEET_SYNC_CSV_URL` tanımlıysa sunucu açılışta kendisi eşitler.
4. Kontrol: Yönetim → Bölgeler'de kurallar; Lead listesinde toplam sayı; Raporlar → Özet rapor.

Yerelde (PGlite) girilen aşama değişiklikleri, temaslar ve notlar bu yolla **taşınmaz**: aktarımlar kaynak dosyalardan
yeniden kurar. Yerelde gerçek çalışma yapıldıysa canlıya geçiş günü kesilir ve o günden sonrası canlıda girilir.

## 6. Gelen yön

- **Meta** (`docs/runbooks/meta-lead-ads.md`): webhook adresi `…/webhooks/meta`, `leadgen` aboneliği, sayfanın
  uygulamaya bağlanması, Lead Erişimi izni. Test: Lead Ads Testing Tool. Yönetim → Ayarlar → Meta'da "Aktif form
  kimlikleri" girilir (yedek senkron bu formları saatte bir kontrol eder).
- **Google lead formu** (`docs/runbooks/google-lead-form.md`): MarcaDM her forma `…/webhooks/google` adresini ve
  anahtarı girer; "Test verisi gönder".
- **Site formu, çekme modu** (`docs/runbooks/web-form.md` bölüm 7, ADR-0015): worker'a `WEB_PULL_URL` ve
  `WEB_FORM_HMAC_KEY` girilir, aynı anahtar sitenin eklenti ayarına girilir. Push aktarıcısı (aşağıdaki eski yol)
  yalnız CRM internete açıksa kullanılır.
- **Site formu, push** (`docs/runbooks/web-form.md` bölüm 1–6): aktarıcı site sunucusuna kurulur; GTM `gclid`, `fbclid`, `_fbc`, `_fbp`
  ve UTM değerlerini 90 gün çerezde tutar ve gizli alanlara yazar.

Sorun olursa Yönetim → Sağlık → "İşlenemeyen bildirimler" hata kodunu gösterir; düzeltmeden sonra "Yeniden dene".
Form alanı tanınmıyorsa Yönetim → Eşlemeler → "Form alanı → lead alanı"ndan eklenir (hemen geçerlidir).

## 8. Giden yön

Önce Meta, sonra Google; her biri ayrı açılır.

1. Yönetim → Eşlemeler'de aşama adlarını kontrol edin (Meta'da olay adı, Google'da dönüşüm işlemi kimliği).
2. Yönetim → Ayarlar'da veri seti kimliğini (Meta) ya da müşteri kimliğini (Google) girin.
3. `ENABLED_PROVIDERS`'a platformu ekleyip sunucuyu yeniden başlatın. Yönetim → Sağlık'ta "Gönderim açık" görünmeli.
4. Bir test lead'inin aşamasını değiştirin; 10 dakika (geri al süresi) sonra olay gider.
   - Meta (`docs/runbooks/meta-capi.md`): Events Manager → Test Olayları'nda `event_source: crm` ve
     `lead_event_source` ile görünür.
   - Google (`docs/runbooks/google-data-manager.md`): Yönetim → Sağlık → "Son gönderilenler"de "Platformdaki durumu
     sor"; birkaç saat sonra Google Ads → Dönüşümler → Tanılama.
5. Bir şey ters giderse Yönetim → Sağlık'ta "Gönderimi durdur" (acil durdurma). Bekleyen olaylar gönderilmez, atlanır.

Excel ve form tablosundan gelen lead'ler: Meta ya da Google kaydı geldiğinde aynı kişiyle eşleşip benimsenir ve o
andan sonra platforma reklam kimliğiyle bildirilir. Hiçbir platform kaydı gelmeyen içe aktarım lead'i bildirilmez.

## 9. Rehberin kontrol listesi

- [ ] Aşama adları ve CRM alanları onaylandı (`decisions.md` 5, 19)
- [ ] Meta test lead'i CRM'e tüm alanlarıyla düştü
- [ ] Google "Test verisi gönder" kaydı CRM'e düştü, `gcl_id` saklandı (lead sayfası → Kaynak detayı)
- [ ] Web formunda `gclid` ve `fbclid` gizli alanlarla geliyor
- [ ] Yedek senkron çalışıyor, çift kayıt oluşmuyor (aynı test lead'i iki kez gelmiyor)
- [ ] Meta Test Olayları'nda tüm aşamalar `lead_id` ile görünüyor
- [ ] Google Tanılama raporunda eşleşmeler görünüyor
- [ ] KVKK onayı alındı (`decisions.md` 6)

## Geri dönüş

- Geri bildirimde sorun: Yönetim → Sağlık → "Gönderimi durdur"; kalıcı kapatma için `ENABLED_PROVIDERS` boşaltılır.
- Gelen akışta sorun: webhook aboneliği platformda kapatılır. Kaçan lead'ler Meta'da yedek senkronla geri gelir;
  Google lead formu yeniden göndermez, MarcaDM dışa aktarım verir.
- Sürüm geri alma: önceki sürüm dağıtılır. Migration'lar yalnız ekleme yapar; 0013'ün geri alma ifadeleri dosyanın
  başında yazılıdır.
