# Runbook: Canlıya alma (Faz 8)

Kaynak: "Unixpadel — Lead → CRM Entegrasyon Rehberi" (MarcaDM) bölüm 7 ve `docs/yol-haritasi.md` bölüm 7. Bu belge
canlıya alma adımlarını yazar. Hosting kararı verildi (2026-11-16, ADR-0005 A ve ADR-0016): CRM, Clever Cloud'da tek
Node uygulaması olarak çalışır; çalışanlar `crm.unixpadel.com` adresini tarayıcıdan açar. Kurulum bölüm 2a'dadır.

Kural: bir adım doğrulanmadan sonrakine geçilmez. Gizli anahtarlar yalnız hosting'in gizli ayar deposuna girilir;
e-postaya, sohbete, koda ve bu depoya yazılmaz.

## Sıra

| # | Adım | Kim | Bitti sayılır |
|---|---|---|---|
| 1 | Clever Cloud uygulaması ve alan adı `crm.unixpadel.com` (bölüm 2a) | IT + Yazılım | Adres HTTPS ile açılıyor, giriş ekranı görünüyor |
| 2 | Postgres 16 (Clever Cloud `SALES_CRM`), uygulamaya bağlı (bölüm 2a) | IT + Yazılım | `/health` 200; şema sürümü 14 |
| 3 | Gizli anahtarlar (aşağıdaki tablo) | IT | Yönetim → Sağlık'ta ilgili satırlar "tanımlı" |
| 4 | Dağıtım: GitHub `main` → Clever Cloud (derleme ve başlatma kendiliğinden) | Yazılım | `/api/auth/me` 401 dönüyor, giriş ekranı açılıyor |
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

## 2a. Clever Cloud: CRM uygulaması ve SALES_CRM veritabanı

Dağıtım (ADR-0016, 2026-11-16): CRM, Clever Cloud'da **tek Node.js uygulamasıdır**: arayüz, API, webhook ve form uçları,
bütün zamanlanmış işler (web sitesi çekme, gelen kutusu → lead, Meta yedek senkronu, reklam geri bildirimi, form
tablosu). Ayrı worker kurulmaz (`server/worker.mjs` kodda kalır, kullanılmaz). Çalışanlar `https://crm.unixpadel.com`
adresini tarayıcıdan açar; bilgisayarlarda hiçbir bağlantı bilgisi bulunmaz. Veritabanı Clever Cloud PostgreSQL 16
eklentisi **SALES_CRM** (Paris, encryption at rest açık).

**`UNIXPADEL_ST` (MySQL) başka bir programındır.** CRM orada yalnız `KullaniciBilgileri`'ni okuyarak giriş yapar
(`server/authDb.mjs`, salt okunur). O veritabanına yazılmaz, tablo eklenmez, migration çalıştırılmaz. Önerilir:
`AUTH_DB_URL` için o tabloda yalnız `SELECT` yetkili ayrı bir MySQL kullanıcısı (öteki programın sahibi açar).

Belge kaynağı (2026-11-16 okundu): Clever Cloud Node.js, ortam değişkenleri, build hook'ları, yük dengeleyiciler ve alan
adları sayfaları (`https://www.clever.cloud/developers/doc/deploy/applications/nodejs/`,
`…/doc/manage/environment-variables/reference/`, `…/doc/manage/build-hooks/`, `…/doc/network/load-balancers/`,
`…/doc/manage/domain-names/`). Özet:
- Uygulama `0.0.0.0` üzerinde `PORT`'u dinler (üretim kipinde sunucu bunu kendisi yapar).
- devDependencies varsayılan olarak **kurulmaz**; arayüzü derleyen Vite devDependency olduğundan
  `CC_NODE_DEV_DEPENDENCIES=install` gerekir. Derleme `CC_POST_BUILD_HOOK` ile yapılır; hook hata verirse dağıtım durur.
- Başlatma: `CC_RUN_COMMAND` yoksa `package.json` → `scripts.start` (`npm start`).
- Yük dengeleyici istemci adresini `X-Forwarded-For`'un **sonuna** ekler; sunucu üretimde 1 atlamaya güvenir
  (giriş deneme sınırı bu adresi kullanır).
- Alt alan adı: `CNAME` → `domain.par.clever-cloud.com.`; TLS sertifikası Let's Encrypt ile kendiliğinden.
- Instance diski kalıcı değildir: veri yalnız Postgres'te durur; sunucu üretimde veritabanı adresi yoksa açılmaz.

### Adımlar

1. **Kodu GitHub'a al.** `UnixPadel/SalesCRM` deposunda `main` dalı güncel olmalı (yerel dallar birleştirilip push).
2. **Uygulama oluştur.** Clever Cloud konsolu → Create → an application → **Node.js**; bölge **Paris** (veritabanıyla
   aynı); en küçük boyut (yetmezse bir boy büyük), **1 instance**, otomatik ölçekleme kapalı (oturumlar bellekte).
   Ad önerisi: `sales-crm`. Dağıtım: GitHub deposu `UnixPadel/SalesCRM`, dal `main`.
3. **SALES_CRM'e bağla.** Uygulama → **Service dependencies** → "Link add-ons" → `SALES_CRM` → Add.
   "Environment variables" sayfasında `POSTGRESQL_ADDON_URI` ve ilgili değişkenler görünür; CRM `DATABASE_URL` yoksa
   `POSTGRESQL_ADDON_URI`'yi kullanır, ayrıca girilmez.
4. **Ortam değişkenlerini gir** (aşağıdaki tablo). Gizli değerler yalnız bu ekrana girilir; e-postaya, sohbete, koda,
   bu depoya yazılmaz (ADR-0004).
5. **HTTPS'i zorunlu yap.** Uygulama → Domain names (ya da Information) → **Force HTTPS** açık. Oturum çerezi üretimde
   `Secure`'dur; HTTP üzerinden giriş çalışmaz.
6. **Dağıt.** İlk dağıtımda migration'lar açılışta uygulanır. Logda `[crm] üretim kipi: …`, `sales-pipeline hazır …
   "db":"postgres"` ve `lead-intake hazır … "webPull":true` görünmeli. Bağlantı TLS hatası verirse `DATABASE_URL`
   olarak `POSTGRESQL_ADDON_URI` değerinin sonuna `?sslmode=require` eklenmiş hali girilir.
7. **Alan adı.** Uygulama → Domain names → `crm.unixpadel.com` ekle. DNS yönetiminde (IT / MarcaDM):
   `crm` için `CNAME` → `domain.par.clever-cloud.com.` Sertifika kendiliğinden gelir (birkaç dakika).
8. **Doğrula.**
   - `GET https://crm.unixpadel.com/health` → `200 {"ok":true,"webPull":true,…}`. Site anahtarı henüz girilmediyse
     `ok:false`, `lastError:"not_configured"` normaldir; veritabanına ulaşılamıyorsa 503.
   - `https://crm.unixpadel.com` giriş ekranını açar; şirket kullanıcı adıyla ve Admin hesabıyla giriş denenir.
   - Şema sürümü 14: PostgreSQL eklentisinin sorgu ekranından `SELECT max(version) FROM schema_migrations;`.
   - `docs/runbooks/web-form.md` bölüm 7.5'teki test gönderimi.
9. **Çalışanlara dağıtım.** Adres paylaşılır; Edge/Chrome'da "Uygulama olarak yükle" ya da masaüstü kısayolu yeterlidir.
   İnce kabuk (.exe) isteğe bağlıdır ve yalnız bu adresi açar.
10. **Anahtar değiştirme.** `WEB_FORM_HMAC_KEY`: web-form runbook'u 7.6. `INBOX_ENCRYPTION_KEY` **değiştirilmez**
    (eski gelen kutusu içerikleri okunamaz hale gelir). Veritabanı şifresi: eklenti ekranından yenilenir,
    `POSTGRESQL_ADDON_*` kendiliğinden güncellenir, uygulama yeniden başlatılır. Yeniden başlatmada herkes yeniden giriş
    yapar (oturumlar bellekte).

### CRM uygulamasının ortam değişkenleri

| Değişken | Değer / not | Gizli |
|---|---|---|
| `NODE_ENV` | `production` (Secure çerez, deneme sınırı, yük dengeleyiciye güven, veritabanı zorunlu) | Hayır |
| `CC_NODE_DEV_DEPENDENCIES` | `install` (arayüz derlemesi için Vite) | Hayır |
| `CC_POST_BUILD_HOOK` | `npm run build:only` | Hayır |
| `CC_HEALTH_CHECK_PATH` | `/health` | Hayır |
| `PUBLIC_BASE_URL` | `https://crm.unixpadel.com` | Hayır |
| `AUTH_DB_URL` (gerekirse `AUTH_DB_TABLE`) | Giriş için şirket kullanıcı tablosu (`UNIXPADEL_ST`, salt okunur) | Evet |
| `CRM_ADMIN_PASSWORD` | Yerel Admin hesabı; en az 12 karakter, yoksa Admin kapalı | Evet |
| `INBOX_ENCRYPTION_KEY` | `npm run secrets:key`; yedeği güvenli yerde saklanır, değiştirilmez | Evet |
| `WEB_FORM_HMAC_KEY` | `npm run secrets:key`; aynı değer sitenin "Shared key" alanında | Evet |
| `WEB_PULL_URL` | `https://www.unixpadel.com/?rest_route=/unixpadel/v1/crm` | Hayır |
| `WEB_PULL_SECONDS`, `WEB_PULL_LIMIT`, `WEB_PULL_MAX_PAGES` | İsteğe bağlı: 120, 50, 10 | Hayır |
| `INTAKE_DEFAULT_COUNTRY` | Ülkesiz yerel telefon için; varsayılan `TR` | Hayır |
| `SMTP_HOST`, `SMTP_FROM`, `SMTP_USER`, `SMTP_PASSWORD`, `OUTBOX_REPORT_TO` | "Yeni lead" e-postası ve günlük rapor (yoksa yalnız uygulama içi bildirim) | Kullanıcı ve şifre evet |
| `META_*`, `GOOGLE_*`, `ENABLED_PROVIDERS` | Meta / Google gelen ve giden yön (bölüm 6, 8; o adımlara kadar boş) | Token ve anahtar evet |
| `SHEET_SYNC_CSV_URL` | Form tablosu eşitlemesi (açık kalacaksa) | Evet (tabloya erişim verir) |

**Girilmeyecekler:** `CRM_DEV_PASSWORD` (üretimde zaten yok sayılır), `PGLITE_DIR`, `ALLOW_PGLITE_IN_PRODUCTION`,
`API_PORT`, `PORT` (Clever Cloud verir), `IMAP_MASTER_*` (posta kutusu okuma kapalı, `MAIL_ENABLED` boş).

## 3. Ortam değişkenleri

Tam liste ve varsayılanlar `.env.example` dosyasındadır. Canlıda en az şunlar girilir:

| Değişken | Ne için | Gizli mi |
|---|---|---|
| `DATABASE_URL` | Postgres bağlantısı (`?sslmode=require` gerekiyorsa adresin sonunda) | Evet |
| `PUBLIC_BASE_URL` | E-posta ve bildirimlerdeki bağlantıların kökü | Hayır |
| `AUTH_DB_URL`, `AUTH_DB_TABLE` | Giriş için şirket kullanıcı tablosu (MySQL) | Evet |
| `CRM_ADMIN_PASSWORD` | Yerel "Admin" hesabı; en az 12 karakter. Üretim kipinde yoksa Admin hesabı kapalıdır (dosyaya yazılmaz) | Evet |
| `INBOX_ENCRYPTION_KEY` | Gelen bildirim içeriğinin şifrelenmesi (`npm run secrets:key`). **Yedeği alınır:** kaybolursa eski içerik okunamaz | Evet |
| `META_APP_SECRET`, `META_VERIFY_TOKEN`, `META_SYSTEM_USER_TOKEN` | Meta webhook doğrulaması ve lead'in Graph API'den çekilmesi | Evet |
| `GOOGLE_LEAD_FORM_KEY` | Google lead formu webhook anahtarı (MarcaDM'e güvenli kanaldan iletilir) | Evet |
| `WEB_FORM_HMAC_KEY` | Site formu imzası (çekme ve push); aynı değer sitenin eklenti ayarında | Evet |
| `WEB_PULL_URL` | Sitenin çekme API'si: `https://www.unixpadel.com/?rest_route=/unixpadel/v1/crm` | Hayır |
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
- **Site formu, çekme modu** (`docs/runbooks/web-form.md` bölüm 7, ADR-0015): CRM uygulamasına `WEB_PULL_URL` ve
  `WEB_FORM_HMAC_KEY` girilir, aynı anahtar sitenin eklenti ayarına (WP admin → Settings → Unixpadel Static → Sales CRM
  connection → Shared key) girilir. Push aktarıcısı (aşağıdaki eski yol) gerekmez.
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
