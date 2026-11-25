# ADR-0016: Masaüstü dağıtımı ve gizli bilgiler — kalın .exe + worker mı, merkezi sunucu + ince .exe mi

- Durum: **Kabul edildi** — karar: Yönetim (Elshan), 2026-11-16
- Tarih: 2026-11-13 (taslak)
- İlgili: ADR-0004 (secret deposu), ADR-0005 (hosting, bekliyor), ADR-0015 (web formu çekme modu)

## Bağlam

CRM bilgisayarlara GitHub'dan .exe olarak dağıtılacak; bugün internete açık bir CRM adresi yok. Veritabanı Clever Cloud
PostgreSQL eklentisi `SALES_CRM`; giriş, başka bir programa ait `UNIXPADEL_ST` (MySQL) içindeki `KullaniciBilgileri`
tablosundan okunuyor ve o tabloda **şifreler düz metin** (müşteri kararı). Clever Cloud'da arayüzsüz worker zamanlanmış
işleri çalıştırıyor (ADR-0015). Depoda henüz .exe paketleme yok: bugünkü uygulama bir Node sunucusu (`server/index.mjs`,
Express) ve tarayıcı arayüzü (Vite). Soru: .exe veritabanlarına doğrudan bağlanırsa her bilgisayarda hangi gizli bilgi
bulunur ve bunun yerine merkezi bir sunucu mu kurulmalı?

### Kalın .exe'nin her bilgisayarda taşıyacağı gizli bilgiler (bugünkü sunucunun okuduğu değişkenler)

| Değişken | Ne açar | Bir bilgisayar çalınırsa / eski çalışan saklarsa |
|---|---|---|
| `DATABASE_URL` (ya da `POSTGRESQL_ADDON_*`) | `SALES_CRM`'in tamamı, okuma + yazma | Tüm lead'ler, kişiler, telefonlar, e-postalar, onay kayıtları dışarı alınabilir ya da silinebilir. Clever Cloud eklentisi internetten erişilebilir; kullanıcı başına geri alma yok, şifre değişirse herkese yeni .exe |
| `AUTH_DB_URL` | `UNIXPADEL_ST` (başka programın veritabanı); eklenti kullanıcısı genelde sahibin yetkilerine sahiptir | **Tüm çalışanların düz metin şifreleri** ve öteki programın verisi. CRM'in "salt okunur" kuralı kodda; bağlantı bilgisi yazma yetkisi de verebilir |
| `INBOX_ENCRYPTION_KEY` | Gelen kutusu içeriklerinin şifresi | Veritabanı zaten açık olduğu için ek kayıp küçük; ama .exe'ler gelen kutusunu işleyecekse **her kurulumda aynı değer** gerekir (yoksa worker'ın yazdığı satırı çözemez, satır 10 dk kilitli kalır) |
| `IMAP_MASTER_USER`, `IMAP_MASTER_PASSWORD` | Posta sunucusunda **herkesin posta kutusu** (satışçının kutusunu okuma özelliği) | Şirketin tüm e-postaları |
| `SMTP_USER`, `SMTP_PASSWORD` | Şirket adına e-posta gönderme | Oltalama için şirket adresi |
| `META_*`, `GOOGLE_*` token ve anahtarları | Reklam hesapları (olay gönderme, lead okuma) | Reklam verisi, sahte dönüşüm |
| `CRM_ADMIN_PASSWORD`, `SHEET_SYNC_CSV_URL` | Yerel admin; form tablosu | Admin girişi; tablodaki kişisel veri |

.exe içindeki değerler (gömülü ya da yanındaki `.env`) birkaç dakikada çıkarılabilir; "gizlemek" koruma değildir.

## Seçenekler

1. **Kalın .exe + worker.** .exe bugünkü sunucuyu bilgisayarda çalıştırır ve `SALES_CRM`'e, girişi için `UNIXPADEL_ST`'ye
   doğrudan bağlanır. Worker yalnız zamanlanmış işleri yapar.
2. **Merkezi CRM sunucusu (Clever Cloud) + ince .exe.** Bugünkü `server/index.mjs` Clever Cloud'da tek Node uygulaması
   olarak çalışır (API + arayüz + zamanlanmış işler; worker bu uygulamaya katılır). .exe yalnız sunucu adresini açan bir
   kabuktur (WebView2 / Electron, ya da tarayıcı kısayolu); bilgisayarda gizli bilgi yoktur, kullanıcı kendi şifresiyle
   girer.

| Ölçüt | 1. Kalın .exe + worker | 2. Merkezi sunucu + ince .exe |
|---|---|---|
| Bilgisayardaki gizli bilgi | Yukarıdaki tablonun tamamı (en az `DATABASE_URL` + `AUTH_DB_URL`) | Yok |
| Düz metin şifre tablosu | Her bilgisayardan erişilebilir | Yalnız sunucudan |
| Bir çalışan ayrılınca | Bağlantı şifreleri değişir, herkese yeni .exe | Kullanıcı tabloda "Pasif" yapılır, biter |
| Anahtar değişimi | 4 bilgisayara yeniden dağıtım | Clever Cloud'da bir değişken + yeniden başlatma |
| İnternete açık yüzey | Veritabanları (zaten açık) | + CRM giriş ekranı (HTTPS, hız sınırı, güvenli çerez gerekir) |
| Meta / Google webhook, site push | Yok (Meta yalnız saatlik yedek senkron, site çekme) | Açılabilir: Meta lead'leri anında; `/webhooks/*`, `/forms/*` zaten yazılı |
| Clever Cloud maliyeti | Worker (1 küçük Node) + Postgres | Sunucu (1 Node, arayüz servis ettiği için bir boy büyük olabilir) + Postgres; worker ayrıca gerekmez |
| Yazılım iş yükü | .exe paketleme (Node + PGlite/pg + Vite çıktısı), her sürümde dağıtım, gelen kutusu anahtar uyumu | Sunucuyu Clever Cloud'a dağıtma, giriş sertleştirme (hız sınırı, oturum), ince kabuk ya da kısayol |
| Çevrimdışı çalışma | Yok: veritabanı Paris'te; internet kesilince .exe de çalışmaz | Yok: aynı |
| Gecikme | Her sorgu bilgisayardan Paris'e | Sunucu veritabanıyla aynı bölgede; tarayıcı yalnız sayfa/JSON alır |
| Güncelleme | Her bilgisayarda yeni .exe | Sunucuda bir dağıtım; kabuk nadiren değişir |

Fiyatlar burada yazılmadı: Clever Cloud fiyat sayfasından instance boyutuna göre bakılmalı. İki seçenekte de bir Node
uygulaması ve bir Postgres eklentisi vardır; fark instance boyutundadır.

## Yazılımın önerisi

**2. Merkezi sunucu + ince .exe.** Belirleyici neden: kalın .exe'de `UNIXPADEL_ST` bağlantı bilgisi (ve onunla tüm
çalışanların düz metin şifreleri) ve `SALES_CRM`'in tam erişimi her bilgisayarda olur; bir dizüstü kaybı ya da ayrılan
bir çalışan tüm veriyi alabilir ve kullanıcı başına geri alma yoktur. Merkezi sunucuda bu bilgiler tek yerde durur.
Kod buna hazır: sunucu zaten bir web uygulaması; webhook ve form uçları yazılı. Çevrimdışı çalışma iki seçenekte de yok.

1 seçilirse en azından: `.exe`'ye yalnız `DATABASE_URL` için ayrı, yetkisi kısıtlı bir Postgres kullanıcısı (DML, DDL yok);
`AUTH_DB_URL` için `KullaniciBilgileri` üzerinde yalnız `SELECT` yetkili ayrı MySQL kullanıcısı (öteki programın
sahibi açmalı); `IMAP_MASTER_*` .exe'ye girilmez (posta kutusu okuma kapalı); gelen kutusu işleme ve reklam geri
bildirimi .exe'de kapatılır, yalnız worker yapar (bunun için bir anahtar eklenmeli: bugün zamanlayıcı her süreçte açılır).

## Karar

**2. Merkezi CRM sunucusu (Clever Cloud) + tarayıcı ya da ince kabuk** (Elshan, 2026-11-16: "1. seçeneği yapalım").

- `server/index.mjs` Clever Cloud'da tek Node uygulaması olarak çalışır: arayüz (`dist/`), API, webhook ve form uçları,
  bütün zamanlanmış işler (web sitesi çekme dahil). Ayrı worker uygulaması kurulmaz; `server/worker.mjs` kodda kalır
  (ileride işler ayrılırsa).
- Çalışanlar CRM'i tarayıcıdan açar (`salescrm.unixpadel.com`, ADR-0005 seçenek A). İnce kabuk (.exe) isteğe bağlıdır ve
  yalnız bu adresi açar; içinde gizli bilgi bulunmaz.
- Gizli bilgiler yalnız Clever Cloud ortam değişkenlerindedir (ADR-0004). Bilgisayarlara hiçbir bağlantı bilgisi
  dağıtılmaz.

## Sonuçlar

- Sunucu internete açıktır; üretim kipinde (`NODE_ENV=production`) sertleştirme açılır: giriş deneme sınırı (kullanıcı
  adı ve IP başına), `Secure` oturum çerezi, güvenlik başlıkları, Clever Cloud yük dengeleyicisine güven (1 atlama),
  `CRM_DEV_PASSWORD` yok sayılır, yerel Admin şifresi yalnız `CRM_ADMIN_PASSWORD`'dan okunur (diske yazılmaz),
  veritabanı adresi yoksa sunucu açılmaz (geçici diskte PGlite ile veri kaybı olmasın).
- `GET /health` (oturumsuz): veritabanı ve web sitesi çekme durumu; Clever Cloud sağlık denetimi bunu kullanır.
- Oturumlar sunucu belleğindedir: yeniden dağıtımda herkes yeniden giriş yapar. Tek instance çalışır.
- Kurulum adımları: `docs/runbooks/canliya-alma.md` bölüm 2a.
- Gelen kutusu anahtarı (`INBOX_ENCRYPTION_KEY`) yalnız sunucudadır; masaüstü kurulumlarıyla uyum sorunu kalkar.
- Önerilen, zorunlu olmayan: `AUTH_DB_URL` için `KullaniciBilgileri` üzerinde yalnız `SELECT` yetkili ayrı bir MySQL
  kullanıcısı (öteki programın sahibi açar).
- **Güncelleme (2026-11-25):** CRM `UNIXPADEL_ST`'ye ilk kez yazar. Nitelikli, Teklif gönderildi ya da Kazanıldı
  aşamasındaki lead, geri alma süresi dolunca `MusteriBilgileri`'ne müşteri olarak eklenir ya da orada var olan
  müşteriye bağlanır (`src/bootstrap/stCustomerSync.ts`, bağ tablosu `st_customer_links`). Yalnız ekleme yapılır; var
  olan müşteri değiştirilmez, silinmez. Bağlantı `ST_DB_URL`, yoksa `AUTH_DB_URL`. Önerilen: yalnız `MusteriBilgileri`
  (SELECT, INSERT) ve `UlkelerBilgileri` (SELECT) yetkili ayrı bir MySQL kullanıcısı. `ST_CUSTOMER_SYNC=0` kapatır.
