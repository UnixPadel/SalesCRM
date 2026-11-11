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
| 2 | Postgres 16 ve `DATABASE_URL` | IT | `npm run db:migrate` hatasız; şema sürümü 13 |
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
- **Site formu** (`docs/runbooks/web-form.md`): aktarıcı site sunucusuna kurulur; GTM `gclid`, `fbclid`, `_fbc`, `_fbp`
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
