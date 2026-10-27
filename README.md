# Unixpadel Satış Panosu (v2)

Satış ekibinin ortak müşteri panosu. React + Vite arayüz, Node (Express) sunucu; giriş şirket posta
sunucusuyla (IMAP) yapılır ve müşteriyle yazışılan e-postalar kartın içinde görünür.

```bash
npm install
npm run dev        # API sunucusu (8787) + Vite (http://localhost:5173) birlikte
```

Üretim: `npm run build` sonra `npm start` (sunucu `dist/` klasörünü de servis eder, tek port: 8787).

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
| `npm run test` | Vitest (`src/modules`, `tests`) |
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
`MAIL_ENABLED`, `IMAP_HOST`, `IMAP_PORT`, `MAIL_DOMAIN`, `CRM_DATA` (veri dosyası, varsayılan `server/data/crm.json`).

## Roller

| Hesap | Giriş | Rol |
|-------|-------|-----|
| Elshan | KullaniciBilgileri (Yonetici) | **admin** |
| Admin | admin@unixpadel.com + `server/data/config.json` içindeki `adminPassword` | **admin** (posta kutusu yok) |
| Salah, Yuşa, Ahlem, Mohamed, Simon | KullaniciBilgileri (Temsilci) | satışçı |
| Muhasebe, Fabrika, Lojistik, Gözlemci | KullaniciBilgileri | görüntüleyici |

- **Admin:** tüm satışçıların kartlarını görür (pano varsayılanı "Tüm ekip", satışçı filtresi), her kartı
  taşır, düzenler, sorumlusunu değiştirir, siler; örnek veriyi sıfırlar. Sunucu da bunu uygular (403).
- **Satışçı:** kendi kartları + ortak havuz. Başkasının kartını yalnız görüntüler ("yalnız görüntüleme" notu).
- `adminPassword` ilk açılışta rastgele üretilir ve dosyaya yazılır; dosyadan değiştirebilir ya da
  `CRM_ADMIN_PASSWORD` ortam değişkeniyle ezebilirsiniz.

## Pano: iki görünüm

Panonun sol üstündeki anahtar: **Hat haritası | Kolonlar**. Seçim tarayıcıda hatırlanır; varsayılan hat haritası.

Herkes panoyu **Müşterilerim** görünümünde açar (yönetici dahil); **Ortak havuz** ve **Tüm ekip** bir tık uzaktadır.

**Hat haritası — kişisel (Müşterilerim / Ortak havuz / tek satışçı):** üstte tek bir hat ve beş durak:
her durağın adı, anlamı, kaç müşteri olduğu ve müşteriyi bir sonraki durağa ne taşır ("Dönüş yapıp
fiyat sorarsa → 2. Yeşil hat"). Altında her durağın müşterileri kart olarak durur; kartta ülke, kort,
değer, bu durakta geçen süre ve düz Türkçeyle "şimdi ne yapmalı" satırı (takipsiz / gecikmiş / bugün /
planlı tarih) vardır. Karttaki **▶ Sonraki durak** düğmesi tek tıkla ilerletir; 4. durakta
**Satış tamamlandı** çıkar. Sürükle-bırak ve `Alt + ←/→` da çalışır.

**Hat haritası — ekip (Tüm ekip):** her satır bir satışçı hattı (en altta ortak havuz), sütunlar
1–4 duraklar, en sağda kırmızı hat terminali. Müşteriler bulundukları durağın altında "boncuk" olarak
durur. Boncuğu başka durağa sürüklemek kolonu değiştirir, başka hatta bırakmak sorumluyu değiştirir
(başkasının hattına yalnız yönetici bırakabilir); ikisi birden tek adımdır ve "Geri al" ikisini de
geri alır. Simgeler: 🔥 takipsiz, ⏰ gecikmiş adım, 🕒 bugün, 🏆 satıldı, ⛔ kırmızı hat.

**Kolonlar**: klasik 5 kolonlu pano (aşağıda).

## Pano: 5 kolon

| # | Kolon | Anlamı |
|---|-------|--------|
| 1 | İletişim kuruldu | Ulaştığımız tüm müşteriler |
| 2 | Yeşil hat | Dönüş yaptı, fiyat soruyor |
| 3 | Proforma gönderildi | Teklif müşteride; 3 gün sonrasına otomatik takip araması açılır |
| 4 | Saha ziyareti / planlama | Keşif, ölçü, proje planı |
| 5 | Kırmızı hat | Dönüş yaptı ama olumsuz sonuçlandı; **neden zorunlu**, kartın üstünde görünür |

Satış kapanınca kart kolonunda kalır, "Satış tamamlandı" ile satıldı işareti alır (raporlar bunu kullanır).
Kart sürüklenir, "Taşı" menüsü ya da çekmecedeki kolon düğmeleriyle de taşınır. Planlı adımı olmayan
açık müşteri **takipsiz** sayılır (kırmızı şerit).

## Kimin müşterisi?

Her kartın bir sorumlusu vardır ya da **ortak havuzdadır** (sahipsiz). Panodaki anahtar:
**Müşterilerim · Ortak havuz · Tüm ekip**. Havuzdaki kartta "Üstlen" düğmesi vardır; sorumlu, çekmece
başlığından da değiştirilir. Formlar sayfasında da "Benim + havuz" varsayılan görünümdür.

## Müşteri çekmecesi

Karta tıklayınca sağdan açılır: ad, durak ve "şimdi ne var" satırı → yolculuk çizgisi (durağa tıkla =
taşı) → kimlik kartı (kişi, Ara / WhatsApp / E-posta düğmeleri, değer, kort) → sekmeler: Adımlar · Bilgiler · Notlar.
E-postalar sekmesi `MAIL_ENABLED=1` olunca geri gelir.

E-postalar **kartın sorumlusunun** posta kutusundan canlı okunur: gelen kutusunda müşteriden gelenler,
gönderilenler klasöründe ona gidenler (klasör başına son 40 ileti, 90 sn önbellek). Panel hangi
klasörlerin tarandığını ve kaç ileti içerdiğini yazar; firma alan adlı adreslerde (`@firma.com`) o alan
adından yazan herkes eşleşir, gmail/hotmail gibi adreslerde tam adres aranır. Satıra tıklayınca metin açılır.

- Örnek verideki müşteri adresleri kurgudur; gerçek yazışma görmek için kartın e-postasını gerçekten
  yazıştığınız bir adresle değiştirin ya da yeni müşteri ekleyin.
- Başka bir satışçının kartını açan **admin**, o satışçının kutusunu ancak sunucuda Dovecot *master user*
  tanımlıysa okuyabilir: `IMAP_MASTER_USER` ve `IMAP_MASTER_PASSWORD` (posta sunucusu yöneticisi açar).
  Tanımlı değilse panel bunu söyler ve "Kendi kutumda ara" seçeneği sunar.

## Veri

- Tüm ekip aynı veriyi görür: sunucu `server/data/crm.json` dosyasında tutar (`/api/db/*`).
- `src/data/repository.ts` depolamadan bağımsız arayüz; `src/data/httpRepository.ts` sunucu sürücüsü.
- `db/schema.sql` Postgres şeması; alan adları TypeScript tipleriyle birebir aynı.
- İlk açılışta örnek veri yüklenir (15 müşteri + 955 gerçek form kaydı). Kullanıcı menüsündeki
  "Örnek veriyi sıfırla" herkesin verisini siler.

## Tasarım

- `src/styles.css` başındaki token'lar: 8pt aralık, 1.25 tip ölçeği, sıcak kağıt zemin, kolon tonları
  (slate / yeşil / mavi / amber / kırmızı), açık ve koyu tema.
- `npm run contrast` tüm renk çiftlerini WCAG AA'ya göre ölçer.
- Klavye: kartta `Enter` açar, `Alt + ←/→` kolon değiştirir; `Ctrl + K` arama. Çekmece ve
  diyaloglar native `<dialog>` (odak içeride kalır, `Esc` kapatır).
- Hedef: masaüstü ve tablet (≥1024px).

Eski tek dosyalık takip sayfası `legacy/` klasöründe duruyor.
