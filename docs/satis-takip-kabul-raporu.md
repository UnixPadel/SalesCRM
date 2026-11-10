# Faz 7g — Satış takip (Excel) uyumu: kabul raporu

Tarih: 2026-11-10 · İş emri: `docs/satis-takip-is-emri.md` · Karar kaydı: `docs/adr/0014-satis-takip-excel-uyumu.md`

## Ne değişti (kısaca)

Excel'deki satış takip dosyası (SATIŞ TAKİP, ÖZET RAPOR, LİSTELER, TEMAS GEÇMİŞİ) CRM'e taşındı. Excel'de bir temas
3–4 yere elle yazılıyordu (✔, Evet + tarih, TEMAS GEÇMİŞİ satırı, sonraki takip); CRM'de tek "Temas kaydet" kaydıdır
ve Excel'in sütunları bu kayıtlardan türetilir.

| Excel | CRM |
|---|---|
| SATIŞ TAKİP (A–AJ, otomatik süzgeç) | **Lead listesi** (`#/list`, açılış sayfası): aynı sütun grupları, başlıkta Excel gibi ▾ menüsü (sayılı değer listesi, sırala, Alt+↓), yöneticide CSV |
| H/I ✔, J–M Evet + tarih, Z/AA/AB | Temas kayıtlarından türetilir (Mail, WhatsApp, Diğer kanal, Dönüş + tarih, Son/İlk temas, Temas sayısı) |
| TEMAS GEÇMİŞİ | Lead'de **Temas kaydet** (kanal, sonuç, not, sonraki takip, müşteri durumu, aşama tek istekte); **Bugün → Temas geçmişi** sekmesi |
| N Müşteri durumu | Lead sayfasında, listede satır içinde ve diyalogda; aşamadan bağımsız |
| O Teklif | "Teklif gönderildi" sonucu ya da Teklif aşaması |
| P–Y ürünler ve çatı ölçüsü | Lead sayfasında **Ürün tercihleri** (yönetici ve lead'in sorumlusu satışçı; `REPS_EDIT_PRODUCTS=0` kapatır) |
| AD–AI form cevapları | **Form cevapları** bloğu; Meta formundan otomatik dolar |
| AJ ve sarı hücreler | **Veri uyarıları** (yöneticide panel, ⚠ sayısı, "Uyarılı" süzgeci; satışçıda telefon ve çatı uyarısı satır içinde) |
| ÖZET RAPOR | **Raporlar → Özet rapor** (5 bölüm, aynı formüller; sıfır olmayan her sayı listede açılır) |
| LİSTELER bölge eşleşmesi | `territory_rules` (aktarımda yazıldı; yeni lead otomatik atanır) |

## Gerçek dosyayla aktarım (yerel PGlite)

Yedek: `server/data/pglite-backup-2026-11-10` (migration 12 öncesi). Migration 12 sonrası: 513 lead korundu,
509 eski kayıt "Kayıt yok (eski)" işaretlendi.

1. `npm run db:import-excel -- <dosya> --dry-run` (geçici kopyada): 159 yeni · 1 zenginleştirme · 15 bölge kuralı ·
   91 e-posta gönderimi (tahmini tarih) · 1 e-posta dönüşü · 1 WhatsApp dönüşü · 2 lead CONTACTED · 37 lead
   "içe aktarmada kontrol" uyarısı · 1 okunamayan telefon · takip tohumu 109 (temsilci başına günde en çok 10).
2. Gerçek koşu: aynı rapor; toplam 672 lead, 203 aktivite.
3. `--verify`: ✔ CRM Özet rapor = Excel ÖZET RAPOR (izinli farklar dışında). Formül sağlaması tuttu (önbellek değerleri
   yeniden hesapla aynı).
4. İkinci koşu: "Değişiklik yok."

Sorumlu eşleşmesi: Yusa Bedir → 32 (44) · Simon Sharpe → 28 (31) · Ahlem → 47 (22) · Salah → 46 (11).
Çözülemeyenler ortak havuzda, "Excel'deki sorumlu" etiketiyle: Faruk 8 · ATANMADI 7 · Mehmet 6 · Beyza 4 (yalnız pasif
kullanıcı) · Almanya Distribütörü 3.

**Enes (2026-11-10, kullanıcı kararı):** satis@ adresi iki aktif kullanıcıdaydı (26, 51); Enes → **Amro Abdulvahit (51)**.
`--owners {"Enes": "51"}` ile yeniden koşu: 23 havuz lead'i 51'e atandı (24. lead zaten ondaydı), 7 bölge kuralı yazıldı
(US AE BG CA QA NO CH; toplam 22), 23 takip planlandı. `--verify` ✔; ikinci koşu "Değişiklik yok".

### Excel ↔ CRM (kapsam: Excel listesi)

| Gösterge | Excel | CRM | Not |
|---|---|---|---|
| Toplam lead | 160 | 160 | |
| Mail atılan | 91 (%56,9) | 91 (%56,9) | |
| WhatsApp'tan aranan | 0 | 1 | A1: WhatsApp dönüşü "Evet" ama ✔ yoktu |
| Hiç ulaşılmamış | 69 (%43,1) | 69 (%43,1) | |
| Dönüş alınan | 2 | 2 | |
| Teklif / Alıcı | 0 / 0 | 0 / 0 | |
| Standard tercih eden | 0 | 1 | A2: adet var, ✔ yok |
| Kapatma potansiyeli | 52 | 52 | |
| 3 ay içinde · hiç | 21 | 21 | §5'in diğer satırları da aynı |
| Enes → Amro (51) | 24 · mail 16 · WA 0 · hiç 8 · dönüş 1 | 24 · 16 · 1 · 8 · 1 | A1 (WhatsApp dönüşü bu satırda) |
| Ortak havuz | 28 · mail 18 · hiç 10 (kalan etiketler) | 28 · 18 · 0 · 10 · 0 | A3 |

## Tarayıcı kontrolleri (yerel, 2026-11-10)

Yönetici (Elshan) ve satışçı (Yuşa) oturumlarıyla, `crm-test-login` önizlemesinde:

- ✔ Lead listesi açılış sayfası; `#/inbox` listeye açılıyor. 670 lead, sütun grupları, yapışkan Lead tarihi + Ad soyad.
- ✔ Başlık menüsü (Mail): "✔ Evet (91) · ✘ Hayır (71) · Kayıt yok (eski) (508)"; Excel kapsamında Mail = Hayır → 69 satır.
- ✔ Özet rapor (Excel listesi): yukarıdaki tablo ekranda aynı; "Hiç ulaşılmamış 69" hücresi listeyi
  "Rapordan açıldı: Hiç ulaşılmamış · 69 lead [Rapora dön]" çubuğuyla 69 satırla açıyor.
- ✔ Lead sayfası: tek birincil "Temas kaydet", "Aşama: … ▾" menüsü, Temas özeti, Müşteri durumu, Ürün tercihleri,
  Form cevapları, zaman çizelgesinde temas satırları.
- ✔ Temas kaydet: WhatsApp + Dönüş alındı + not + İlgili + "Aşamayı İletişim kuruldu yap" tek Kaydet'le; bildirim
  "Temas kaydedildi · Aşama: İletişim kuruldu · Takip: 13 Kas Cum 09:00 [Geri al]"; başlıktaki "Temas kaydını geri al"
  aşamayı, durumu ve temas kaydını birlikte geri aldı.
- ✔ Bugün: "3 ay içinde kurulum planlayan 21 açık lead'e hiç ulaşılmadı. [Listeyi aç]" şeridi; satırlarda 44 px
  "Tamamla…"; Temas geçmişi sekmesi süzgeçleriyle listeliyor (tahmini tarihler "≈").
- ✔ Pano: 4 satırlık kart (ad · ürün/kort · tek durum çipi · sorumlu ve son temas), Takipsiz / Hiç ulaşılmamış / Sıcak /
  Uyarılı (yönetici) çipleri, "1 filtre · Filtreleri temizle".
- ✔ Satışçı: CSV düğmesi, "Uyarılı" çipi ve Kontrol sütunu yok; havuz satırlarında "Üstlen"; lead sayfasında uyarı
  paneli yok, ürünler salt okunur ve açıklamalı, durum alanında "Değiştirince lead size atanır".
- ✔ 375 px: Lead listesi, lead sayfası, Özet rapor, Bugün, Pano'da yatay sayfa kaydırması yok (tablo kendi kabında kayar).
- ✔ Konsol: uygulama hatası yok (iç içe `colgroup` uyarısı bulundu ve düzeltildi).

## Bilinen sınırlar

- Postgres'te `--dry-run` yok (yalnız PGlite kopyasında); canlıya almada önce kopya veritabanında denenir.
- Bölge kuralları ekranı (7b "Bölgeler" sekmesi) henüz yok; kurallar aktarım betiğiyle yazıldı.
- Teklif tutarı Excel'de olmadığından içe aktarılan teklifler tutarsızdır; Kazanıldı/Kaybedildi otomatik yapılmaz
  (rapor "aday" listesi verir).
