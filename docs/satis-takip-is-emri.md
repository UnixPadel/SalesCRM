# Satış takip (Excel) uyumu — iş emri

Tarih: 2026-11-10. Kod adı: **Faz 7g**. Durum: kesin tasarım, uygulamaya hazır. Açık sorularda (§8) varsayılan uygulanır.

> - **Bağlayıcı kararlar:** orkestratör kararları D1–D11, Faz 7e yetki kuralı (`REP_EDITABLE_LEAD_FIELDS = ["notes"]`) ve yol haritasındaki kural: aşama yalnız `ChangeLeadStage` ile değişir. Altı aşama ve kuralları değişmez.
> - **Migration 0012** bu işindir. Faz 7c'nin planladığı migration **0013** olur (`docs/faz7-is-emri.md` 7c satırı güncellendi; Bitti tanımındaki "0012" S1'de düzeltilir).
> - **Kaynak:** `UNIXPADEL_Satis_Takip_Duzeltilmis.xlsx` (SATIŞ TAKİP 160 satır, ÖZET RAPOR, LİSTELER, TEMAS GEÇMİŞİ). Bu belgede müşteri adı, telefonu ya da e-postası yoktur. Ekip adları ve KullaniciID'ler ekip verisidir.
> - **Kelime testi** (`tests/architecture/vocabulary.test.ts`): sales-pipeline, integration-settings/domain ve shared içinde platform adı geçmez. Reklam yüzeyi opak kodla (`ig`, `fb`) tutulur, etiketi yalnız `src/i18n`'dedir. Form metnini bilen kod lead-intake ve bootstrap'tadır.
> - **Eleştiri izleri:** köşeli parantezdeki etiketler üç incelemeye işaret eder: [K-…] kapsam, [U-…] kullanıcı deneyimi, [M-…] mimari. Reddedilenler Ek A'da, uygulananların yeri Ek B'dedir.

---

## 1. Özet

### 1.1 Excel'in işlevi

Excel dört iş görüyor:
1. Lead başına tek satırda iletişim, ulaşım, dönüş, müşteri durumu, teklif, ürün ve form cevaplarını tutar.
2. Her teması TEMAS GEÇMİŞİ'ne kanal, sonuç, not ve sonraki takip tarihiyle yazar.
3. ÖZET RAPOR'da ekip performansını ve bekletilen sıcak lead'leri formülle gösterir.
4. LİSTELER'de seçenekleri ve ülke → sorumlu eşleşmesini tutar.

Bilişsel yük ve tutarsızlık aynı yerden geliyor: bir temas üç-dört kez elle girilir (H/I ✔, J–M Evet + tarih, TEMAS GEÇMİŞİ satırı, Z/AA/AB). Ürün ✔ ile adet, çatı ✔ ile ölçü ayrı ayrı girilir.

### 1.2 Temel fikir

- **Tek eylem: "Temas kaydet"** (kanal + sonuç + isteğe bağlı not ve sonraki takip). H, I, J, K, L, M, Z, AA, AB ve TEMAS GEÇMİŞİ satırı bu kayıttan sunucuda türetilir (D2). En sık durum, "mesaj attım, cevap yok", iletişim satırındaki çubuktan **tek tıkla** kaydedilir (§5.2).
- **Türet, sorma:** teklif (D3), çatı alanı, kort toplamı, veri uyarıları (D6), sıcak lead ve "hiç ulaşılmadı" hesaplanır. "Hiç ulaşılmadı" Excel'deki gibi **yalnız temas kayıtlarına** bağlıdır, aşamaya bakmaz [K-B1].
- **Aynı tanımlar:** "Özet rapor" sekmesi ÖZET RAPOR'un formüllerini birebir uygular (D8). Excel içe aktarıldığında sayılar aynı çıkar. İzinli farklar §6.8'de kod kod listelidir ve `--verify` her farkı bir gerekçe koduna bağlar.
- **Excel'e benzeyen liste:** "Lead listesi" sayfası (D9) Gelen kutusunun yerini alır: sütun grupları, Excel otomatik filtresi gibi başlık menüleri, telefon → WhatsApp, e-posta → mail, CSV. Menü yine 5 öğedir (Hick) [U-I15].

### 1.3 Karşılaştırma tablosu (Excel öğesi → bugün → yeni durum)

**SATIŞ TAKİP sütunları**

| Excel öğesi | Bugün programda | Yeni durum |
|---|---|---|
| A No | Yok | İçe aktarmada `extra_answers.excel_no`, yeniden çalıştırma anahtarı. Lead listesinde gizli "Excel No" sütunu (Sütunlar menüsünden açılır). Arama kutusu No ile de bulur [U-M11]. Kaynak detayında "Excel satır no". |
| B Lead Tarihi | `leads.created_at` | Aynı. Listede "Lead tarihi" sütunu; filtre ay gruplu değer listesi + özel aralık. İçe aktarmada B günü 09:00 (İstanbul). |
| C Ad Soyad | Kişi `full_name` | Aynı. Listede yapışkan sütun, lead sayfasına bağlantı. |
| D Ülke "Ad (CC)" | `leads.country` ISO-2, sonradan düzenlenemiyor | Aynı kod. Görünen ad `Intl.DisplayNames('tr')` + kısa ad istisnaları (US → ABD, AE → BAE, HK → Hong Kong) + "(CC)" [K-M6]. `country` LeadFields'a girer, yalnız yönetici düzeltir. |
| E Sorumlu Kişi | `assigned_user_id`, NULL = Ortak havuz | Aynı. NULL her yerde nötr **"Ortak havuz"** etiketi (gelen kutusu ikonu), uyarı değildir [U-I9]. Excel'den gelen havuz lead'inde "Excel'deki sorumlu: Enes" çipi (`extra_answers.excel_owner`) [K-I4]. Bölge kuralı yeni lead'i otomatik atar (D7). |
| F Telefon (WhatsApp) | wa.me bağlantısı, kayıt tutmaz | WhatsApp yeni sekmede açılır. Telefon satırının altında kalıcı çubuk: "WhatsApp'ta mesaj gönderdiniz mi? [Evet, kaydet] [Ayrıntı ekle] [Göndermedim]" [U-I6]. Ayrı "Ara" (tel:) bağlantısı Telefon kanalıdır. |
| G E-posta | mailto | Aynı çubuk, kanal E-posta. |
| H Mail Atıldı mı? | Türetilemez | Türetilir: tamamlanmış e-posta teması varsa ✔ Evet. |
| I WhatsApp'tan Arandı mı? | Türetilemez, WhatsApp türü yok | Türetilir: tamamlanmış `whatsapp` teması (mesaj ya da WhatsApp araması). GSM araması "Telefon" kanalıdır, I'ya girmez [K-I6]. |
| J Mail Dönüşü Alındı mı? | Yok | Türetilir: e-posta kanalında dönüş sayılan temas var mı. Dönüş = sonuç Dönüş alındı / Olumsuz / Anlaşma sağlandı **ya da** "Müşteri cevap verdi" işaretli Takip edilecek / Teklif gönderildi [U-B3]. |
| K Mail Dönüş Tarihi | Yok | Türetilir: o kanaldaki ilk dönüş temasının zamanı. J/K çelişkisi oluşamaz. |
| L / M WhatsApp dönüşü + tarih | Yok | J/K gibi, WhatsApp kanalı. |
| N Müşteri Durumu | Yok | `leads.customer_status`: 5 kod, NULL = "Durum girilmedi". Sahip satışçı, havuz lead'ini üstlenen satışçı (lead ona atanır) ve yönetici değiştirir. Aşamadan bağımsızdır (D1). Lead sayfasında "Müşteri" grubunda [U-B2], listede satır içi seçimle [U-I12]. |
| O Teklif Verildi mi? | Yalnız raporda "Teklif aşamasına ulaşan" | Türetilir (D3): geri alınmamış "Teklif gönderildi" aşama olayı ya da "Teklif gönderildi" sonuçlu/türlü tamamlanmış temas. "Teklif gönderildi" sonucu kaydedilirken aşama da "Teklif gönderildi"ye geçer, pano sütunu ile rapor aynı sayıyı verir [U-I3]. Elle bayrak yok. |
| P–U Standard / Panoramic / Full Panoramic ✔ + adet | Tek `court_count`, serbest `court_model` | `qty_standard`, `qty_panoramic`, `qty_full_panoramic` 1–29; NULL = tercih yok. Kutu işaretlenince adet 1 gelir ve odak adete geçer; kutu kaldırılınca adet silinir [U-M3]. "✔ var adet yok" ve "adet var ✔ yok" oluşamaz. |
| V Kapatma (Çatı) ✔ | "Roof Top Kanopi" yalnız metin | `roof_wanted` boolean |
| W / X Çatı genişliği / uzunluğu (m) | Yok | `roof_width_m`, `roof_length_m` numeric(5,2), 0'dan büyük. Ölçü yazılınca Kapatma kendiliğinden işaretlenir [K-I3]. |
| Y Çatı Alanı = W×X | Yok | Türetilir (`roofAreaM2`, 2 ondalık), saklanmaz. Ölçü eksikse "Çatı ölçüsü eksik" uyarısı. |
| Z Son Temas Tarihi | Yok | Türetilir: en son tamamlanmış temas. Tahmini tarih "≈" ile gösterilir. |
| AA İlk Temas Tarihi | Yok | Türetilir: en eski tamamlanmış temas. |
| AB Temas Sayısı | Yok | Türetilir: tamamlanmış aktivite sayısı. İçe aktarmadan sonra Excel'den farklıdır (§1.4). |
| AC Notlar / Sonraki Adım | `lead.notes` + sonraki açık aktivite | Aynı. Kartta ve listede son temas sonucu da görünür. Temas notu temas kaydında tutulur. |
| AD Kurulum Yeri | `extra_answers` ham metin, katlı panelde | `install_site`, 7 kod. Intake doldurur. Satışçıya salt okunur, yönetici düzeltir (D5). |
| AE Kurulum Zamanı | Aynı | `install_timeline`, 4 kod. "3 ay içinde" ve açık aşama = **Sıcak lead**. |
| AF Müşteri Profili | Aynı | `customer_profile`, 6 kod |
| AG Kort Sayısı | Ham metin | `court_count_band`, 4 kod. Formda kesin sayı varsa `court_count` da dolar. |
| AH Platform | `extra_answers.platform` ('fb'/'ig') | `ad_surface` opak kod. Etiket yalnız i18n'de. |
| AI Kampanya | `campaign_name`, katlı panelde | Aynı sütun. Form cevapları bloğunda, listede ve Özet rapor filtresinde (tam eşleşme) görünür. Kimse düzenlemez. |
| AJ Veri Uyarısı | Yok (yalnız `country_raw`) | Hesaplanan uyarılar (D6), saklanmaz. Excel'de AJ dolu ya da içe aktarmada sorun bulunan satır **"İçe aktarma kontrolü"** uyarısı alır; yönetici "Kontrol edildi" diyene kadar durur [K-I9]. |

**SATIŞ TAKİP sayfa davranışları**

| Excel öğesi | Bugün | Yeni durum |
|---|---|---|
| Satır 1 sütun grupları | Yok | Listede iki satırlı başlık (`<colgroup>` + `<th scope="colgroup">`). Gruplar katlanabilir; Ürünler ve Form cevapları varsayılan katlı, tek özet sütunla. |
| Dondurulmuş bölme G3 | Yok | Yapışkan başlık satırları; Lead tarihi + Ad soyad yapışkan sütun. Excel A–F'yi dondurur; 375 px'te altı sütun sığmadığı için bilerek iki sütun [K-M9]. Mobilde yalnız Ad soyad. |
| Otomatik filtre (başlık okları) | Pano: sorumlu, ülke, kaynak, takipsiz | Her başlıkta tek ▾ düğmesi, Excel'in menüsüyle aynı: sırala, sayılı değer listesi, arama, Uygula/Temizle; Alt+↓ açar [U-I11]. Hızlı filtreler: Hiç ulaşılmamış, Sıcak, Takipsiz, Uyarılı (yönetici). |
| Telefon/e-posta köprüleri | Var, kayıt yok | Bağlantı açılır, satır içi kayıt çubuğu çıkar. |
| Sarı: J=Evet ama K boş ya da tersi (L/M aynı) | Yok | Oluşamaz: dönüş tarihli bir temastır. |
| Sarı: P ✔ adet yok ya da tersi (R/S, T/U) | Yok | Oluşamaz: adet = tercih. |
| Sarı: V ✔ ama W/X boş | Yok | Kayda izin var. Hesaplanan uyarı `roof_size_missing`. |
| Sarı: W/X dolu ama V ✔ değil | Yok | Oluşamaz: ölçü girilince Kapatma işaretlenir. İçe aktarmada `roof_wanted = true` + içe aktarma sorunu [K-I3]. |
| Sarı: E = ATANMADI | Yok | Nötr "Ortak havuz" etiketi + sorumlu filtresinde "Ortak havuz". Uyarı sayılmaz. |
| Sarı: AJ dolu | Yok | Yöneticide: Kontrol sütunu, "Uyarılı" filtresi, lead sayfası paneli. Satışçıda yalnız işini etkileyen uyarı, ilgili bilginin yanında [U-I18]. |

**ÖZET RAPOR** (Raporlar → **"Özet rapor"** sekmesi; eski sekme "Aşama raporu" olur [U-I16]; tanımlar §3.3.7'de)

| Excel öğesi | Bugün | Yeni durum |
|---|---|---|
| B1 başlık, B2 kampanya ve "elle yazmayın" satırı | Yok | Sekme başlığı + kapsam çipleri "Tüm lead'ler (n) · Excel listesi (160)" (son seçim hatırlanır) + kapsam satırı. Excel listesi seçiliyken "Excel ÖZET RAPOR ile aynı kapsam" yazar. Elle giriş yok. |
| İlk / son lead tarihi = MIN/MAX(B) | Yok | `header.firstLeadAt` / `lastLeadAt`, filtrelenmiş kümede |
| Rapor tarihi = TODAY() | Yok | `header.reportDate` = bugün (İstanbul) |
| §1 Toplam Lead, Mail Atılan, WhatsApp'tan Aranan, Hiç Ulaşılmamış | Yok (toplam yalnız dönemle) | `basics.total`, `mailSent`, `whatsappSent`, `neverReached` |
| §1 Dönüş Alınan (mail veya WhatsApp) | Yok | `basics.replied`, etiket **"Dönüş alınan (tüm kanallar)"** [K-M4] |
| §1 Teklif Verilen, Alıcı Müşteri | ≈ PROPOSAL'a ulaşan | `basics.proposalGiven` (D3), `basics.buyers` |
| §1 "toplam içindeki pay" | Yok | `basics.share.*` = x/total. Toplam 0 ise 0 (Excel `IF(B7=0,0,…)`). |
| §2 Sorumlu Kişi satırları | Yok | Aktif satış kullanıcıları **her zaman** (lead'i 0 olsa da, oranlar "–"), ada göre sabit sırada; lead'i olan pasif sahip "(pasif)" ekiyle; "Ortak havuz" en sonda [K-M3]. Havuz satırı açılır: Excel'deki sorumlu etiketine göre alt satırlar, Excel'in 10 satırını birebir verir [K-I4]. |
| §2 Lead · Mail · WhatsApp · Hiç · Dönüş · Teklif · Alıcı | Yok | Aynı sütunlar. Yeni sütun **"Kayıt yok (eski)"** yalnız > 0 ise görünür [K-I2]. |
| §2 Ulaşma Oranı = (Lead − Hiç)/Lead | Yok | `reachRate` = ulaşılan / (lead − eski kayıt). Payda 0 ise "–". Excel kümesinde eski kayıt 0 olduğundan Excel formülüyle aynıdır. |
| §2 Dönüş Oranı = Dönüş/(Lead − Hiç) | Yok | `replyRate` = dönüş / ulaşılan. Payda 0 ise "–". |
| §2 Teklif Oranı = Teklif/Lead | Yok | `proposalRate`. Lead 0 ise "–". |
| §2 TOPLAM satırı, B23 tanım notu | Yok | `byOwnerTotal` (satırların toplamı). Not: "Hiç ulaşılmadı = hiçbir kanaldan temas kaydı olmayan lead; temas geçmişi bilinmeyen eski kayıtlar 'Kayıt yok (eski)' sütunundadır. Ulaşma oranı = ulaşılan / (lead − eski kayıt). Dönüş oranı = dönüş alınan / ulaşılan." |
| §2 koşullu biçimler (C veri çubuğu, F > 0) | Yok | Lead sütununda satır içi orantılı çubuk (`aria-hidden`, sayı metin olarak kalır); Hiç > 0 hücresinde ⚠ ikon + sayı [K-M1]. |
| §3 Müşteri Durumu × Sorumlu (5 durum + Durum Girilmedi + Toplam + TOPLAM) | Yok | `statusByOwner[]` §2 ile aynı satırlar ve sıra + toplam satırı. Sıfır olmayan hücre kalın [K-M1]. |
| §4 Ürün satırları (Standard, Panoramic, Full Panoramic, Kapatma) | Yok | `products[]`, 4 satır: Tercih eden (`preferred`, çubuklu), Teklif verilenler içinde, Teklif verilenlerin %'si (÷ toplam teklif; payda 0 → "–"), Alıcılar içinde, Toplam adet / Kapatma m² |
| §4 Kapatma potansiyeli (AD = "Tam kapalı / çatılı kort") | Yok | `closingPotential` |
| §5 Kurulum zamanı satırları × Lead, Hiç, Dönüş, Teklif, Ulaşılmama Oranı | Yok | `byInstallTimeline[]` sabit sırada; "Belirtilmemiş" yalnız lead > 0 ise. `neverRate` = hiç / (lead − eski kayıt). Yalnız "3 ay içinde" satırında alev ikonu + "Sıcak" [U-M12]; hiç > 0 ise etiket "3 ay içinde kurulum planlayan 21 lead'e hiç ulaşılmadı" [U-B1d]. |

**LİSTELER**

| Excel öğesi | Bugün | Yeni durum |
|---|---|---|
| Müşteri Durumu listesi (5) | Yok | `CUSTOMER_STATUSES` (domain) + DB CHECK + i18n; her kodun tonu ve ikonu var (§3.2) [K-M2] |
| Sorumlu Kişi listesi (Yusa Bedir, Simon Sharpe, Ahlem, Enes, Salah, Beyza, Mehmet, Faruk, Almanya Distribütörü, ATANMADI) | `/api/users` (aktif Yonetici/Temsilci) | Seçim kutuları aktif satış kullanıcıları + "Ortak havuz". Ad gösterimi bütün dizinden; pasifler "(pasif)" ekiyle. Kullanıcı olmayan etiketler içe aktarmada havuza düşer, etiket saklanır ve raporlanır (D7). |
| Tik ✔ / ✘, Evet / Hayır | Yok | Türetilen değerler ikon + metinle gösterilir; elle girilmez. CSV'de Excel'in sembolleri korunur [K-M9]. |
| Adet 1–29 | Yok | Adet alanı 1–29 + DB CHECK |
| Ülke (37) | Bütün ISO kodları | Değişmez; program her ülkeyi kabul eder. |
| Ülke → Sorumlu bölge eşleşmesi (37) | `territory_rules` boş | İçe aktarma betiği tohumlar (e-posta, sonra ad). 15 ülke çözülür, 22'si raporlanır. Düzenleme ekranı 7b "Bölgeler" sekmesi (§5.8). |
| TEMAS GEÇMİŞİ kanal listesi (Telefon, WhatsApp, E-posta, Toplantı, Diğer) | 5 aktivite türü, WhatsApp/Diğer yok | `CONTACT_CHANNELS` = call, whatsapp, email, meeting, other. `call` TR etiketi Excel'deki gibi **"Telefon"** [K-I6]. |
| TEMAS GEÇMİŞİ sonuç listesi (6) | Yok | `ACTIVITY_OUTCOMES`, 6 kod |

**NASIL KULLANILIR ve LİSTELER K notları**

| Kural | Yeni durum |
|---|---|
| 1. Her temastan sonra hücreden ✔/✘, Evet/Hayır seç | Tek "Temas kaydet" işlemi ya da iletişim çubuğunda "Evet, kaydet". ✔ ve Evet sunucuda türetilir. |
| 2. Başlık oklarıyla filtrele ("Mail Atıldı mı?" → ✘) | Lead listesi başlık menüleri (Mail → ✘ Hayır). Filtreler URL'de kalır, rapor bağlantıları aynı biçimi kullanır. |
| 3. Müşteri Durumu ve Sorumlu yalnız listeden | Seçim kutusu + DB CHECK. Sorumlu yalnız ekip kullanıcısı ya da havuz. |
| 4. Birden fazla ürün ✔ + her ✔'in sağına adet | Ürün tercihleri düzenleyicisi: çoklu işaret, işaretlenince adet 1, 1–29 |
| 5. ÖZET RAPOR otomatik | Özet rapor. Elle sayı yok; sıfır olmayan her sayı Lead listesine bağlanır. |
| 6. Sarı hücre = uyarı | Hesaplanan veri uyarıları; Excel tutarsızlıklarının çoğu yapısal olarak oluşamaz. |
| 7. Yeni lead son satırın altına | Form lead'leri otomatik gelir. Elle giriş için "Yeni lead" diyaloğu. |
| 8. Telefon → WhatsApp, e-posta → yeni mail | Aynı; ayrıca satır içi kayıt çubuğu |
| K4: dönüş Evet ise tarihi K/M'ye yaz | Dönüş tek kayıttır: kanal + dönüş sonucu. Tarih kaydın zamanıdır. |
| K5 / K6: ürüne adet, Kapatma ise W/X, Y otomatik | Ölçü alanları Kapatma satırındadır; ölçü yazmak Kapatma'yı işaretler; m² canlı hesaplanır. |
| K7: her görüşmeyi TEMAS GEÇMİŞİ'ne ayrı satır yaz | Kayıt lead sayfasında, listede ya da Yapılacaklar'da yapılır, No seçilmez. "Kaydeden" otomatik dolar. |
| K8: Z/AA/AB otomatik, eski satırları silme | Türetilir. Tamamlanmış teması yalnız yönetici siler. Satışçı kendi kaydını 10 dakika içinde geri alır. |
| K9 / K10: sarı kurallar, liste kaynakları | Yukarıdaki tablo; `GET /reference` kod listeleri |

**TEMAS GEÇMİŞİ sayfası**

| Excel sütunu | Bugün | Yeni durum |
|---|---|---|
| Müşteri No / Müşteri Adı | Yok | `activities.lead_id`; ad lead'den |
| Temas Tarihi | `done_at` = tıklama anı | `done_at` = seçilen zaman (varsayılan şimdi; ileri tarih ve 2024-01-01 öncesi yasak). İçe aktarmada tahmini olabilir (`date_estimated`). |
| İletişim Kanalı | type (5 tür) | type, yeni `whatsapp` ve `other` ile |
| Görüşme Sonucu | Yok | `activities.outcome` (+ `customer_replied`) |
| Görüşme Notları | Yalnız planlama notu | `activities.result_note` |
| Sorumlu Kişi (otomatik) | `created_by_user_id` (planlayan) | `done_by_user_id` = "Kaydeden"; lead sahibi ayrıca görünür |
| Sonraki Takip Tarihi | Ayrı adımda AddActivity | Aynı işlemde açık aktivite |
| Sayfanın bütünü | Bugün sayfası yalnız açık aktiviteler | Bugün → **"Temas geçmişi"** sekmesi: ekip çapında temas günlüğü, Excel'deki her sütuna filtre [U-I15][K-M10] |

### 1.4 Bilerek farklı olanlar

- **Ulaşıldı bütün kanalları kapsar** (Telefon, Toplantı, Diğer dahil); Excel'de yalnız mail ve WhatsApp vardı. Excel'den gelen veride sonuç aynıdır. Telefon (GSM) araması "WhatsApp'tan aranan"a girmez [K-I6].
- **Dönüş bütün kanallardır**; Toplantı varsayılan olarak "Dönüş alındı" ile kaydedilir. CRM'de e-posta kanalıyla kaydedilen gelen e-posta "Mail atılan"a da sayılır [K-M4].
- **Temas geçmişi bilinmeyen eski kayıtlar** (MySQL aktarımı ve 0012 öncesinde aşaması ilerlemiş, tamamlanmış aktivitesi olmayan lead'ler; yaklaşık 509) "Hiç ulaşılmadı"ya sayılmaz; "Kayıt yok (eski)" olarak ayrı gösterilir ve oranların paydasından çıkar [K-B1][K-I2]. Bunun dışında temas kaydı olmayan her lead, aşaması ne olursa olsun "Hiç ulaşılmadı"dır.
- **Müşteri durumu aşamayı değiştirmez.** "İlgisiz" seçilince diyalog işaretsiz bir "Aşamayı 'Kaybedildi' yap" satırı gösterir; çelişki kalırsa bilgi uyarısı çıkar (`status_stage_conflict`).
- **"Teklif gönderildi" sonucu aşamayı taşır** (§5.3). Teklif sayısı pano ile raporda aynıdır.
- **"İletişim kuruldu" cevap gelince önerilir** (§8 soru 5): cevapsız mesaj lead'i "Yeni"de bırakır; kart "Son temas 2 g önce" ile işlendiğini gösterir.
- **İçe aktarmadan sonra Z/AA/AB Excel'den farklıdır:** Excel'de 160 satırın hepsinde AB = 0'dır (TEMAS GEÇMİŞİ boş); CRM ✔ ve Evet işaretlerinden 1–2 tahmini (≈) temas üretir [K-M4].
- **Ürün ✘ (açıkça istemiyor) ile boş ayrılmaz**; ikisi de "tercih yok"tur [K-M4].
- **Sorumlu satırları:** Excel LİSTELER'in sabit 10 satırını gösterir; CRM ekip kullanıcılarını gösterir, kullanıcı olmayanlar havuz satırının altında Excel etiketiyle kırılır.
- **Uyarı görünürlüğü:** yönetici bütün uyarıları görür; satışçı yalnız işini etkileyen üç uyarıyı (telefon kodu uyumsuz, telefon geçersiz, çatı ölçüsü eksik) bilginin yanında görür [U-I18].

---

## 2. Kullanıcı akışları (önce / sonra)

| Akış | Excel (işlem / yazılan alan) | Program (işlem / yazılan alan) | Uygulanan ilke |
|---|---|---|---|
| Satışçının sabahı | ~8 işlem + iki sayfa arasında No ile zihinsel eşleme | 1 tık, 0 alan | Jakob (Pipedrive "Bugün"), Miller |
| WhatsApp mesajı, cevap yok | ~14 işlem / 3 alan | 2 tık / 0 alan | Fitts, Hick, türetme |
| Müşteri dönüşü + müşteri durumu | ~17 işlem / 3 alan | 4 tık / 0 alan (not isteğe bağlı) | Progressive disclosure |
| Ürün tercihleri (2 Panoramic + kapatma 20×10) | 11 işlem / 2 alan | 6 işlem / 2 alan, anında doğrulama | Gestalt ortak bölge, satır içi doğrulama |
| Yöneticinin "bekletilen sıcak lead" incelemesi | ~14 işlem (3 filtre) + filtre temizleme | 2 tık (sayıya tıkla → liste) | Önce özet, sonra detay; Fitts |
| Yeni sıcak lead | ~10 alan elle kopyalama + bölge bakışı | 0 işlem (otomatik atama + etiket + bildirim) | Varsayılan, türetme |

**2.1 Satışçının günü**
- *Önce:* Excel açılır. E sütununda kendi adına filtrelenir (4 işlem), H=✘ filtrelenir (4). TEMAS GEÇMİŞİ'nde H ≤ bugün filtresi kurulur (4). No'lar SATIŞ TAKİP'le zihinde eşleştirilir.
- *Sonra:* Bugün açılır (1 tık), "Yapılacaklar" sekmesi: Gecikmiş / Bugün / Yaklaşan. Satırda lead adı, kanal ikonu, son temas sonucu ve "Tamamla…" düğmesi. Üstte yalnız gerektiğinde tek şerit: "3 ay içinde kurulum planlayan 4 açık lead'e hiç ulaşılmadı. [Listeyi aç]". Şeritteki sayı, açılan listedeki satır sayısıyla aynıdır (tek tanım, test edilir) [U-B1b]. Excel aktarımından sonra takipler beş iş gününe dağıtılmış gelir (§6.3, soru 6).
- *İlke:* tek birincil liste, en fazla bir şerit (Hick); üç grup (Miller).

**2.2 Temas kaydı: WhatsApp mesajı, sonra dönüş**
- *Önce, ilk temas (~14 işlem, 3 alan):* F hücresine tıklanır, mesaj gönderilir. I'da ✔ seçilir (3). TEMAS GEÇMİŞİ'ne geçilir, boş satır bulunur, No seçilir (160 satırlık liste), tarih, kanal, sonuç, not ve sonraki takip yazılır.
- *Önce, dönüş (~17 işlem, 3 alan):* L'de Evet, M'ye tarih, TEMAS GEÇMİŞİ'ne yeni satır, Müşteri Durumu için 3 işlem daha.
- *Sonra, ilk temas (2 tık, 0 alan):*
  1. Lead sayfasında ya da listede telefona tıklanır. WhatsApp yeni sekmede açılır. CRM'de telefon satırının altında çubuk belirir: "WhatsApp'ta mesaj gönderdiniz mi? [Evet, kaydet] [Ayrıntı ekle] [Göndermedim]".
  2. "Evet, kaydet". Sunucu varsayılanları uygular: kanal WhatsApp, sonuç "Dönüş bekleniyor", zaman şimdi; vadesi bugüne kadar gelmiş aynı kanallı bir plan varsa onu tamamlar; sonraki takip "WhatsApp takibi · 2 gün sonra 09:00". Aşama değişmez. Bildirim: "Temas kaydedildi · Takip: Per 13 Kas 09:00 [Geri al]".
- *Sonra, dönüş (4 tık):* Yapılacaklar'da "Tamamla…" → diyalog tamamlama modunda açılır ("Bu kayıt 'WhatsApp takibi · Per 13 Kas' işini tamamlar"), kanal özet satırdadır → "Dönüş alındı" çipi → Müşteri durumu alanı belirir, "İlgili" seçilir → "Aşamayı 'İletişim kuruldu' yap" işaretli gelir → Kaydet.
- *Kazanç:* yaklaşık 25 işlem ve 6 yazılan alan daha az. J/K, L/M çelişkisi oluşamaz. Z/AA/AB kendiliğinden doğru kalır.
- *İlke:* güvenli varsayılan (giden mesajda "Dönüş bekleniyor"), işlem içeriğin yanında (Fitts), tarih ve takip katlı (progressive disclosure), kalıcı çubuk sayfadan kaybolmaz.

**2.3 Ürün tercihleri (yönetici; satışçı için anahtar §8 soru 1)**
- *Önce (11 işlem / 2 alan):* R ✔, S adedi, V ✔, W ve X yazılır; Y formülle gelir. Eksik adet ya da ölçü sarı yanar ama kayıt olur.
- *Sonra (6 işlem / 2 alan):* Lead sayfası Proje → Düzenle → Panoramic kutusu (adet 1, odak adette) → "+" (2) → Genişlik'e 20 yazılır (Kapatma kendiliğinden işaretlenir) → Uzunluk'a 10 → canlı "Çatı alanı: 200,00 m²" → Kaydet. 1–29 dışı adet ya da 0 ölçü alandan çıkınca satır içinde hata verir.
- *İlke:* her ürün kendi satırında, kutu ve adet yan yana (Gestalt yakınlık); Excel'deki sıra (Jakob).

**2.4 Yöneticinin rapor incelemesi**
- *Önce:* ÖZET RAPOR'da "3 ay içinde · Hiç ulaşılmadı 21" görülür. Bu 21 lead için SATIŞ TAKİP'te AE, H ve I filtreleri kurulur (~12 işlem), sonra temizlenir.
- *Sonra:* Raporlar → Özet rapor (sekme ve kapsam hatırlanır) → "21" → Lead listesi `#/list?from=report&scope=excel&contact=never&f_timeline=m0_3` açılır. Üstte dönüş çubuğu: "Rapordan açıldı: 3 ay içinde · Hiç ulaşılmadı · 21 lead [Rapora dön]". Hatırlanan liste filtresi bu açılışta uygulanmaz; satır sayısı hücreyle aynıdır (test) [U-B1a].
- *İlke:* önce özet, tıkla detay. Sayının kendisi hedeftir.

**2.5 Sıcak lead takibi**
- *Önce:* reklam dışa aktarımından satır elle kopyalanır (~10 alan). Sorumlu LİSTELER'deki ülke tablosundan seçilir. Sıcaklık yalnız renkle görünür.
- *Sonra:* form lead'i gelir. Intake `install_timeline = m0_3` yazar. Ülke kuralı sahibi atar. Sahibe giden bildirim "Sıcak lead: {ad} · 3 ay içinde" diye başlar. Kartta "Sıcak · 3 ay" etiketi (alev ikonu + metin). İlk temasa kadar Bugün şeridinde sayılır. Satışçının işlem sayısı 0.

**2.6 Panoda sürükleme**
- Temas kaydı olmayan bir lead "Yeni"den "İletişim kuruldu"ya bırakılınca "Temas kaydet" diyaloğu açılır; aşama satırı sabit "İletişim kuruldu"dur. İkincil bağlantı "Yalnız aşamayı taşı" eski davranışı korur [K-B1]. `ChangeLeadStage` değişmez.

---

## 3. Veri modeli

### 3.1 Migration `db/migrations/0012_faz7g_satis_takip.sql`

```sql
-- Faz 7g: Satış takip (Excel) uyumu (ADR-0014, docs/satis-takip-is-emri.md).
-- Temas = tamamlanmış aktivite; kanal = aktivite türü. Türetilen her şey (H–M, O, Y, Z/AA/AB, uyarılar)
-- sorguda hesaplanır, sütun yok. Bölüm 6'daki veri düzeltmeleri geri alınamaz.

-- 1) Aktivite türleri: whatsapp ve other (kısıt adı canlı kopyada doğrulandı).
ALTER TABLE activities DROP CONSTRAINT activities_type_check;
ALTER TABLE activities ADD CONSTRAINT activities_type_check
  CHECK (type IN ('call','email','whatsapp','meeting','proposal_sent','site_visit','other'));

-- 2) Temas kaydı: tek "Temas kaydet" işleminin geri alma bilgisi.
CREATE TABLE contact_logs (
  id                    uuid PRIMARY KEY,
  lead_id               uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  actor_user_id         text NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),   -- geri alma penceresi buradan sayılır
  completed_activity_id uuid REFERENCES activities(id) ON DELETE SET NULL,
  prev_type             text,          -- tamamlanan planın önceki türü ve konusu (geri almada geri yazılır)
  prev_subject          text,
  status_changed        boolean NOT NULL DEFAULT false,
  status_before         text,
  status_after          text,
  stage_change_id       uuid,          -- aynı işlemde ChangeLeadStage'in change_id'si
  assigned_on_log       boolean NOT NULL DEFAULT false
);
CREATE INDEX contact_logs_lead_idx ON contact_logs (lead_id, created_at DESC);

-- 3) Aktivite: temas sonucu, cevap işareti, not, yapan, tahmini tarih, kayıt bağları.
ALTER TABLE activities
  ADD COLUMN outcome          text,
  ADD COLUMN customer_replied boolean NOT NULL DEFAULT false,
  ADD COLUMN result_note      text NOT NULL DEFAULT '',
  ADD COLUMN done_by_user_id  text,
  ADD COLUMN date_estimated   boolean NOT NULL DEFAULT false,
  ADD COLUMN log_id           uuid REFERENCES contact_logs(id) ON DELETE SET NULL,  -- satırı açan ya da tamamlayan kayıt
  ADD COLUMN next_of_log_id   uuid REFERENCES contact_logs(id) ON DELETE SET NULL;  -- bu satır o kaydın "sonraki takip"i
ALTER TABLE activities
  ADD CONSTRAINT activities_outcome_check CHECK (outcome IS NULL OR outcome IN
      ('reply_received','awaiting_reply','proposal_sent','follow_up','negative','agreed')),
  ADD CONSTRAINT activities_outcome_done   CHECK (outcome IS NULL OR done_at IS NOT NULL),
  ADD CONSTRAINT activities_estimated_done CHECK (NOT date_estimated OR done_at IS NOT NULL),
  ADD CONSTRAINT activities_replied_check  CHECK (NOT customer_replied OR outcome IN ('follow_up','proposal_sent'));
CREATE INDEX activities_done_idx        ON activities (lead_id, done_at)    WHERE done_at IS NOT NULL;
CREATE INDEX activities_history_idx     ON activities (done_at DESC, id DESC) WHERE done_at IS NOT NULL;
CREATE INDEX activities_log_idx         ON activities (log_id)         WHERE log_id IS NOT NULL;
CREATE INDEX activities_next_of_log_idx ON activities (next_of_log_id) WHERE next_of_log_id IS NOT NULL;

-- 4) Lead: müşteri durumu (D1), ürünler (D4), form cevapları (D5), reklam yüzeyi, kontrol edilen uyarılar (D6),
--    temas geçmişi bilinmeyen eski kayıt işareti.
ALTER TABLE leads
  ADD COLUMN customer_status         text,
  ADD COLUMN qty_standard            smallint,
  ADD COLUMN qty_panoramic           smallint,
  ADD COLUMN qty_full_panoramic      smallint,
  ADD COLUMN roof_wanted             boolean NOT NULL DEFAULT false,
  ADD COLUMN roof_width_m            numeric(5,2),
  ADD COLUMN roof_length_m           numeric(5,2),
  ADD COLUMN install_site            text,
  ADD COLUMN install_timeline        text,
  ADD COLUMN customer_profile        text,
  ADD COLUMN court_count_band        text,
  ADD COLUMN ad_surface              text,
  ADD COLUMN checked_warnings        text[] NOT NULL DEFAULT '{}',
  ADD COLUMN contact_history_unknown boolean NOT NULL DEFAULT false;
ALTER TABLE leads
  ADD CONSTRAINT leads_customer_status_check CHECK (customer_status IS NULL OR customer_status IN
      ('interested','not_interested','project_phase','collecting_prices','buyer_ready')),
  ADD CONSTRAINT leads_qty_standard_check       CHECK (qty_standard       IS NULL OR qty_standard       BETWEEN 1 AND 29),
  ADD CONSTRAINT leads_qty_panoramic_check      CHECK (qty_panoramic      IS NULL OR qty_panoramic      BETWEEN 1 AND 29),
  ADD CONSTRAINT leads_qty_full_panoramic_check CHECK (qty_full_panoramic IS NULL OR qty_full_panoramic BETWEEN 1 AND 29),
  ADD CONSTRAINT leads_roof_width_check  CHECK (roof_width_m  IS NULL OR roof_width_m  > 0),
  ADD CONSTRAINT leads_roof_length_check CHECK (roof_length_m IS NULL OR roof_length_m > 0),
  ADD CONSTRAINT leads_roof_dims_need_roof CHECK (roof_wanted OR (roof_width_m IS NULL AND roof_length_m IS NULL)),
  ADD CONSTRAINT leads_install_site_check CHECK (install_site IS NULL OR install_site IN
      ('covered_court','no_site_yet','indoor_hall','beach_windy','rooftop','existing_ground','other')),
  ADD CONSTRAINT leads_install_timeline_check CHECK (install_timeline IS NULL OR install_timeline IN
      ('m0_3','m3_6','m6_12','researching')),
  ADD CONSTRAINT leads_customer_profile_check CHECK (customer_profile IS NULL OR customer_profile IN
      ('investor','club_operator','private_home','public_facility','hospitality_residential','distributor')),
  ADD CONSTRAINT leads_court_count_band_check CHECK (court_count_band IS NULL OR court_count_band IN
      ('1','2_3','4_6','7_plus')),
  ADD CONSTRAINT leads_ad_surface_check CHECK (ad_surface IS NULL OR ad_surface ~ '^[a-z0-9_]{1,32}$');
CREATE INDEX leads_campaign_name_idx ON leads (campaign_name) WHERE campaign_name IS NOT NULL;
CREATE INDEX leads_excel_no_idx      ON leads ((extra_answers->>'excel_no')) WHERE extra_answers ? 'excel_no';

-- 5) Form alanı eşleme hedefleri (intake; kısıt adı canlı kopyada doğrulandı).
ALTER TABLE form_field_mappings DROP CONSTRAINT form_field_mappings_target_field_check;
ALTER TABLE form_field_mappings ADD CONSTRAINT form_field_mappings_target_field_check CHECK (target_field IN
  ('full_name','first_name','last_name','email','phone','country','city','company','product_interest','notes',
   'extra','ignore','install_site','install_timeline','customer_profile','court_count'));

-- 6) Veri düzeltmeleri (kişisel veri yok; geri alınamaz).
UPDATE leads   SET country = 'FR' WHERE country = 'FX';   -- eski UlkelerBilgileri kodu (10 lead, 9 kişi)
UPDATE persons SET country = 'FR' WHERE country = 'FX';
UPDATE leads SET ad_surface = CASE lower(extra_answers->'mysql'->>'platform')
    WHEN 'instagram' THEN 'ig' WHEN 'website' THEN 'web' WHEN 'whatsapp' THEN 'whatsapp' END
  WHERE ad_surface IS NULL AND extra_answers->'mysql'->>'platform' IS NOT NULL;
UPDATE leads SET ad_surface = extra_answers->>'platform'
  WHERE ad_surface IS NULL AND extra_answers->>'platform' ~ '^[a-z0-9_]{1,32}$';
-- Temas geçmişi bilinmeyen eski kayıtlar: "Hiç ulaşılmadı"ya değil "Kayıt yok (eski)"ye sayılır.
UPDATE leads l SET contact_history_unknown = true
  WHERE (l.current_stage <> 'NEW' OR l.extra_answers ? 'mysql' OR l.platform_lead_id LIKE 'mysql:%')
    AND NOT EXISTS (SELECT 1 FROM activities a WHERE a.lead_id = l.id AND a.done_at IS NOT NULL);
```

Notlar:
- `contact_logs` bir temas grubudur [M-B2]. Rol sütunu yoktur; rol bağlardan çıkar: `log_id = X` ve `contact_logs.completed_activity_id` = satır → tamamlanan plan; `log_id = X`, diğer satırlar → bu kaydın eklediği temas; `next_of_log_id = X` → bu kaydın sonraki takibi. Bir sonraki takip daha sonra başka bir kayıtla tamamlanırsa `next_of_log_id` X olarak kalır, `log_id` yeni kaydı gösterir; ilk kaydı geri almak tamamlanmış satırı silmez.
- `contact_history_unknown` bir köken olgusudur, uyarı değildir. 0012'den sonra yalnız `db:import-mysql` (Faz 8'deki Postgres koşusu dahil) `true` yazar. Excel aktarımı yazmaz.
- `court_model` ve `product_interest` olduğu gibi kalır (§3.4).
- Görünüm (VIEW) ya da türetilmiş sütun yok: kural SQL'e taşınırsa domain'le çift kopya olur, sahte depolar paylaşamaz, her kural değişikliği migration ister.
- Ürünler jsonb değil sütundur: dört sabit ürün için CHECK basit kalır, genel `updateFields` jsonb dizisi sorununa girmez.

### 3.2 Kod listeleri (kod · TR · EN)

**Aktivite türü / temas kanalı.** Diyalogda 5 kanal görünür. `proposal_sent` ve `site_visit` yalnız o türde planlı bir aktivite tamamlanırken çıkar.

| Kod | TR | EN | Diyalogdaki kısa açıklama |
|---|---|---|---|
| call | Telefon | Call | GSM araması |
| whatsapp | WhatsApp | WhatsApp | Mesaj ya da WhatsApp araması |
| email | E-posta | E-mail | — |
| meeting | Toplantı | Meeting | — |
| other | Diğer | Other | — |
| proposal_sent | Teklif hazırlama | Proposal prep | (yalnız planlayıcıda ve tamamlamada) [U-I3] |
| site_visit | Saha ziyareti | Site visit | — |

Excel kanal eşlemesi: Telefon → call, WhatsApp → whatsapp, E-posta → email, Toplantı → meeting, Diğer → other.

**Temas sonucu** (`ACTIVITY_OUTCOMES` Excel sırasıyla; ekranda sıklık sırası `OUTCOME_DISPLAY_ORDER`; ★ = dönüş sayılır)

| Ekran sırası | Kod | TR | EN | Sonuç altındaki yardım satırı |
|---|---|---|---|---|
| 1 | awaiting_reply | Dönüş bekleniyor | Awaiting reply | Mesaj gönderildi ya da arama açılmadı. |
| 2 | reply_received ★ | Dönüş alındı | Reply received | Müşteri cevap verdi ya da görüştünüz. |
| 3 | follow_up | Takip edilecek | To follow up | Müşteriyle konuşuldu, ileri bir tarihte tekrar aranacak. |
| 4 | proposal_sent | Teklif gönderildi | Proposal sent | Teklif iletildi; aşama "Teklif gönderildi" olur. |
| 5 | negative ★ | Olumsuz | Negative | Müşteri ilgilenmiyor. |
| 6 | agreed ★ | Anlaşma sağlandı | Agreement reached | Müşteri kabul etti. |

"Müşteri cevap verdi" işareti (`customer_replied`) yalnız Takip edilecek ve Teklif gönderildi sonuçlarında görünür; işaretliyse temas dönüş sayılır. Telefon, Toplantı ve Saha ziyaretinde işaretli, diğer kanallarda işaretsiz gelir [U-B3].

**Müşteri durumu** (renk tek başına anlam taşımaz; her kodun ikonu ve metni var) [K-M2]

| Kod | TR | EN | Ton · ikon |
|---|---|---|---|
| interested | İlgili | Interested | bilgi · onay işaretli daire |
| not_interested | İlgisiz | Not interested | olumsuz · çizgili daire |
| project_phase | Proje aşamasında | Project stage | nötr · cetvel |
| collecting_prices | Fiyat toplama aşaması | Collecting prices | uyarı · fiyat etiketi |
| buyer_ready | Alıcı - proje hazır | Buyer – project ready | olumlu · yıldız |
| (NULL) | Durum girilmedi | No status | soluk · tire |

**Ürünler** (adet 1–29; çatı m): standard · Standard · Standard; panoramic · Panoramic · Panoramic; full_panoramic · Full Panoramic · Full Panoramic; roof · Kapatma (çatı) · Cover (roof). Gösterim "2 Panoramic · Kapatma 20 × 10 m (200 m²)"; "×" adet için kullanılmaz [U-M3].

**Kurulum yeri**

| Kod | TR | EN |
|---|---|---|
| covered_court | Tam kapalı / çatılı kort | Fully covered / roofed court |
| no_site_yet | Henüz arazi/yer yok | No site yet |
| indoor_hall | Kapalı salon | Indoor hall |
| beach_windy | Sahil / rüzgârlı alan | Beach / windy area |
| rooftop | Çatı üstü (rooftop) | Rooftop |
| existing_ground | Mevcut zemin (asfalt/beton) | Existing ground (asphalt/concrete) |
| other | Diğer | Other |

**Kurulum zamanı** (yalnız "3 ay içinde" ikonla vurgulanır [U-M12])

| Kod | TR | EN | Isı |
|---|---|---|---|
| m0_3 | 3 ay içinde | Within 3 months | hot ("Sıcak", alev ikonu) |
| m3_6 | 3-6 ay | 3–6 months | warm |
| m6_12 | 6-12 ay | 6–12 months | cool |
| researching | Şimdilik araştırıyor | Just researching | cold |

**Müşteri profili:** investor · Yeni tesis açacak yatırımcı · Investor opening a new facility; club_operator · Kulüp sahibi / işletmeci · Club owner / operator; private_home · Ev için özel kort · Private court for a home; public_facility · Okul / belediye / spor tesisi · School / municipality / sports facility; hospitality_residential · Otel / resort / konut projesi · Hotel / resort / residential project; distributor · Distribütör / bayi · Distributor / dealer.

**Kort sayısı bandı:** `1` = 1 kort · `2_3` = 2-3 kort · `4_6` = 4-6 kort · `7_plus` = 7+ kort. Banttan gelen değer "(form)" ekiyle gösterilir: "2-3 kort (form)" [U-M4].

**Reklam yüzeyi** (`ad_surface`, opak kod; etiket yalnız `src/i18n` `surface.*`): `ig` = Instagram · `fb` = Facebook · `web` = Web sitesi / Website · `whatsapp` = WhatsApp. Bilinmeyen kod olduğu gibi gösterilir.

**Veri uyarıları** (`dataWarnings`; "Satışçı" = satışçıya görünür mü)

| Kod | Önem | Satışçı | TR | EN |
|---|---|---|---|---|
| phone_country_mismatch | warn | ✔ telefonun yanında | Telefon kodu {phoneCode}, lead ülkesi {country}; aramadan önce kontrol edin. Yöneticide: "…; ülkeyi ve sorumluyu kontrol edin." [K-M11] | Phone code {phoneCode}, lead country {country}; check before calling |
| phone_invalid | warn | ✔ telefonun yanında | Telefon numarası geçersiz görünüyor | Phone number looks invalid |
| phone_unreadable | warn | — | Formdaki telefon okunamadı; numara kaydedilmedi | Phone on the form was unreadable and not saved |
| country_missing | warn (`source = import` ise info) [M-M15] | — | Ülke girilmemiş | Country missing |
| contact_before_lead | warn | — | İlk temas, lead tarihinden önce | First contact is before the lead date |
| roof_size_missing | warn | ✔ ürünlerin yanında ("müşteriden ölçüyü isteyin") | Kapatma seçili ama çatı ölçüsü eksik | Cover selected but roof size missing |
| import_review | warn | — | İçe aktarmada kontrol gerekiyor: {issues} | Import needs review: {issues} |
| country_from_phone | info | — | Ülke formda yoktu; telefon kodundan atandı | Country was missing; taken from the phone code |
| dial_code_assumed | info | — | Telefonda ülke kodu yoktu; {dialCode} eklendi | No country code on the phone; {dialCode} added |
| status_stage_conflict | info | — | Müşteri durumu ({status}) aşamayla ({stage}) çelişiyor | Customer status ({status}) conflicts with stage ({stage}) |

"warn" uyarıları yöneticide kart sayısına (⚠ n), Kontrol sütununa ve "Uyarılı" filtresine girer. "info" yalnız lead sayfasındaki panelde görünür.

**İçe aktarma sorunları** (`extra_answers.import_issues`, `import_review` uyarısının parametresi) [K-I9]

| Kod | TR |
|---|---|
| excel_warning | Excel'de veri uyarısı vardı (AJ) |
| k_without_j / m_without_l | Dönüş tarihi var ama dönüş "Evet" değil (mail / WhatsApp) |
| reply_before_lead | Dönüş tarihi lead tarihinden önce |
| qty_without_tick / tick_without_qty | Ürün adedi işaretsiz / işaretli ürünün adedi yok |
| roof_dims_without_tick | Çatı ölçüsü var ama Kapatma işaretli değildi |
| status_unknown | Müşteri durumu listede yok |

### 3.3 Domain tipleri ve saf fonksiyonlar (`src/modules/sales-pipeline/domain/`)

**3.3.1 `activity.ts` (değişir)**
```ts
export const ACTIVITY_TYPES = ["call","email","whatsapp","meeting","proposal_sent","site_visit","other"] as const;
export const CONTACT_CHANNELS = ["call","whatsapp","email","meeting","other"] as const satisfies readonly ActivityType[];
export const ACTIVITY_OUTCOMES = ["reply_received","awaiting_reply","proposal_sent","follow_up","negative","agreed"] as const;
export type ActivityOutcome = (typeof ACTIVITY_OUTCOMES)[number];
export const OUTCOME_DISPLAY_ORDER: readonly ActivityOutcome[] =
  ["awaiting_reply","reply_received","follow_up","proposal_sent","negative","agreed"];
export const REPLY_OUTCOMES: readonly ActivityOutcome[] = ["reply_received","negative","agreed"];
export const isReply = (o: ActivityOutcome | null, customerReplied: boolean): boolean =>
  customerReplied || (o !== null && REPLY_OUTCOMES.includes(o));
// Activity'ye eklenir: outcome: ActivityOutcome | null; customerReplied: boolean; resultNote: string;
//   doneByUserId: string | null; dateEstimated: boolean; logId: string | null; nextOfLogId: string | null;
// DEFAULT_SUBJECTS += { whatsapp: "WhatsApp", other: "Temas" }
export const FOLLOW_UP_SUBJECTS: Record<ActivityType, string> = { call: "Takip araması", whatsapp: "WhatsApp takibi",
  email: "E-posta takibi", meeting: "Toplantı", other: "Takip", proposal_sent: "Teklif takibi", site_visit: "Saha ziyareti" };
```
`isRotting` / `summarizeActivities` değişmez (açık aktiviteye bakar).

**3.3.2 `contact.ts` (yeni)**
```ts
export interface ContactAggregateRow { leadId: string; type: ActivityType; outcome: ActivityOutcome | null;
  customerReplied: boolean; estimated: boolean; n: number; firstAt: Date; lastAt: Date }
export interface ChannelFacts { count: number; firstAt: Date; lastAt: Date; firstReplyAt: Date | null; firstReplyEstimated: boolean }
export type ContactState = "contacted" | "legacy" | "never";
export interface ContactSummary {
  state: ContactState; count: number;
  firstAt: Date | null; firstAtEstimated: boolean; lastAt: Date | null; lastAtEstimated: boolean;
  lastOutcome: ActivityOutcome | null; lastType: ActivityType | null;
  replied: boolean; firstReplyAt: Date | null;
  channels: Partial<Record<ActivityType, ChannelFacts>>;
  proposalContactAt: Date | null;   // outcome=proposal_sent ya da type=proposal_sent olan ilk temas
}
export function aggregateContacts(acts: readonly Activity[]): ContactAggregateRow[];
  // yalnız doneAt dolu; anahtar leadId|type|outcome|customerReplied|estimated (SQL GROUP BY ile aynı)
export function summarizeContacts(rows: readonly ContactAggregateRow[], historyUnknown: boolean): ContactSummary;
```
Kurallar:
- `count` = Σn; `firstAt` = min, `lastAt` = max.
- `state`: count > 0 → `contacted`; değilse `historyUnknown` → `legacy`; değilse `never`. **Aşamaya bakılmaz** [K-B1].
- Dönüş yapışkandır: sonraki "Dönüş bekleniyor" önceki dönüşü silmez. `firstReplyAt` = `isReply` satırlarının en küçük `firstAt`'i (kanal bazında ve genel).
- Eşit zaman sıralaması (`lastOutcome`, `lastType` ve `firstAt` seçimi): önce `isReply` satırı, sonra `proposal_sent`, sonra diğerleri; sonra tahmini olmayan; sonra tür ve sonuç alfabetik [K-I7].

Temas kuralları (domain verisi; sunucu varsayılanları bundan hesaplar, UI kural yazmaz) [M-B1]:
```ts
export const CONTACT_RULES = {
  defaultOutcome: { call: "awaiting_reply", email: "awaiting_reply", whatsapp: "awaiting_reply", other: "awaiting_reply",
                    meeting: "reply_received", site_visit: "reply_received", proposal_sent: "proposal_sent" },
  repliedFlagOutcomes: ["follow_up", "proposal_sent"],
  repliedDefaultTypes: ["call", "meeting", "site_visit"],
  statusOutcomes: ["reply_received", "negative", "agreed", "proposal_sent"],   // + customerReplied işaretliyse
  statusSuggestsLost: ["not_interested"],
  contactedOnOutbound: false,     // §8 soru 5: cevapsız gönderimde "İletişim kuruldu" önseçilsin mi
  nextAfterDays: { awaiting_reply: 2, reply_received: 3, follow_up: 3, proposal_sent: 3, negative: null, agreed: null },
  nextHour: 9,
  futureToleranceMinutes: 5,
  minContactDate: "2024-01-01",   // Excel DV alt sınırı [K-M5]
  noteMax: 4000,
} as const;
export type StageLineMode = "fixed" | "checked" | "unchecked" | "checked_if_replied";
export function stageLine(i: { outcome: ActivityOutcome; current: StageCode }): { target: StageCode; mode: StageLineMode } | null;
export function suggestNext(i: { outcome: ActivityOutcome; type: ActivityType; now: Date; current: StageCode;
  stageTarget: StageCode | null; timeZone: string }): { type: ActivityType; dueAt: Date; subject: string } | null;
export function pickCompletable(open: readonly Activity[], type: ActivityType, now: Date, timeZone: string): Activity | null;
export function validateContact(i: { type: unknown; outcome: unknown; customerReplied: boolean; occurredAt: Date; now: Date;
  note: string; completingType: ActivityType | null; timeZone: string }):
  Result<{ type: ActivityType; outcome: ActivityOutcome; customerReplied: boolean; occurredAt: Date; note: string }, RuleError>;
```
- `stageLine` sırayla:
  1. Terminal aşama → null.
  2. `proposal_sent` ve aşama PROPOSAL'dan önce → `{PROPOSAL, fixed}` (§5.3; atlanan aşamalar mevcut kuralla `auto_fill` olur).
  3. `agreed` → `{WON, unchecked}`.
  4. `negative` → `{LOST, unchecked}`.
  5. Aşama NEW: `reply_received` → `{CONTACTED, checked}`; `follow_up` → `{CONTACTED, checked_if_replied}`; `awaiting_reply` → `{CONTACTED, contactedOnOutbound ? checked : unchecked}`.
  6. Diğer → null. QUALIFIED hiç önerilmez (3 soru diyalogu gerekir).
- `suggestNext`: terminal aşama, `stageTarget ∈ {PROPOSAL, WON, LOST}` (PROPOSAL'da `ChangeLeadStage` "Teklif takibi"ni açar; çift arama olmaz) ya da `nextAfterDays` null → null. Tür: call/email/whatsapp aynı kanal, diğerleri call. `dueAt = atLocalHour(now + gün, 9, tz)`.
- `pickCompletable`: açık aktivitelerden vadesi bugünün sonuna (tz) kadar gelenler; önce aynı tür, sonra en erken vade; yoksa null. Gelecekteki planlar varsayılan olmaz [M-I8][U-I5].
- `validateContact` hataları: `contact.type` (kanal dışı tür; `proposal_sent`/`site_visit` yalnız `completingType` aynıysa) [M-M5], `contact.outcome`, `contact.future` (> şimdi + 5 dk), `contact.too_old` (< 2024-01-01, İstanbul günü), `contact.note_too_long`, `contact.replied_flag` (işaret yalnız follow_up/proposal_sent).

**3.3.3 `products.ts` (yeni)**
```ts
export const COURT_PRODUCTS = ["standard","panoramic","full_panoramic"] as const;
export const PRODUCT_QTY_MAX = 29;
export interface ProductPrefs { standard: number | null; panoramic: number | null; fullPanoramic: number | null;
  roof: { wanted: boolean; widthM: number | null; lengthM: number | null } }
export const EMPTY_PRODUCTS: ProductPrefs;
export function parseProductPrefs(raw: unknown): Result<ProductPrefs, RuleError>;
  // değiştirme anlamı: eksik anahtar = null/false. Adet tam sayı 1–29 ya da null (product.qty_range).
  // Ölçü: sayı ya da "10,5" / "10.5"; 0 < x ≤ 999.99; 2 ondalığa yuvarlanır (product.roof_size).
  // wanted=false iken ölçü → product.roof_dims_without_roof (UI ölçü yazılınca wanted'ı işaretler).
export const courtTotal = (p: ProductPrefs): number => (p.standard ?? 0) + (p.panoramic ?? 0) + (p.fullPanoramic ?? 0);
export function roofAreaM2(p: ProductPrefs): number | null;   // iki ölçü de doluysa round2(w*l)
export function hasAnyProduct(p: ProductPrefs): boolean;
export function productSummary(p: ProductPrefs): { code: ProductCode; qty?: number; widthM?: number; lengthM?: number; areaM2?: number | null }[];
```

**3.3.4 `leadProfile.ts` (yeni):** `CUSTOMER_STATUSES` (+ ton/ikon anahtarı), `INSTALL_SITES`, `INSTALL_TIMELINES`, `CUSTOMER_PROFILES`, `COURT_COUNT_BANDS` (sıra §3.2). `timelineHeat(t)`; `isHotLead(lead) = lead.installTimeline === "m0_3" && !isTerminal(lead.currentStage)`; `AD_SURFACE_RE = /^[a-z0-9_]{1,32}$/`; `bandForCount(n)`: 1 → "1", 2–3 → "2_3", 4–6 → "4_6", ≥ 7 → "7_plus".

**3.3.5 `dataQuality.ts` (yeni)**
```ts
export type WarningCode = "phone_country_mismatch"|"phone_invalid"|"phone_unreadable"|"country_missing"|"contact_before_lead"|
  "roof_size_missing"|"import_review"|"country_from_phone"|"dial_code_assumed"|"status_stage_conflict";
export const WARNING_CODES: readonly WarningCode[];
export const REP_VISIBLE_WARNINGS: readonly WarningCode[] = ["phone_country_mismatch","phone_invalid","roof_size_missing"];
export interface DataWarning { code: WarningCode; severity: "warn"|"info"; checked: boolean; params?: Record<string, string> }
export function dataWarnings(lead: Lead, contact: ContactSummary, timeZone: string): DataWarning[];
export const visibleWarnings = (all: DataWarning[], isAdmin: boolean) =>
  isAdmin ? all : all.filter((w) => REP_VISIBLE_WARNINGS.includes(w.code) && !w.checked);
export const PROVENANCE_KEYS = { country: ["country_source", "country_raw"], phone: ["phone_raw", "dial_code_assumed"] } as const;
export const WARNINGS_CLEARED_BY = { country: ["country_missing","country_from_phone","phone_country_mismatch"],
  phone: ["phone_invalid","phone_unreadable","dial_code_assumed","phone_country_mismatch"] } as const;
```
Kurallar:
- `phone_country_mismatch`: `lead.phoneE164` ve `lead.country` dolu, `getCountryCallingCode(country) !== parse(phoneE164).countryCallingCode` (ülke değil arama kodu karşılaştırılır; yerelde 1 yanlış pozitifi giderir) [M-M2].
- `phone_invalid`: numara var, `valid === false` (`shared/normalization/phone.ts`'e `valid` ve `callingCode` eklenir).
- `phone_unreadable`: telefon null, `extraAnswers.phone_raw` dolu.
- `country_missing`: country null; `source = import` ise info.
- `contact_before_lead`: `calendarDay(contact.firstAt) < calendarDay(lead.createdAt)`.
- `roof_size_missing`: `roof.wanted` ve ölçülerden biri boş.
- `import_review`: `extraAnswers.import_issues` boş değil (param `issues`).
- `country_from_phone`: `extraAnswers.country_source === "phone"`; `dial_code_assumed`: `extraAnswers.dial_code_assumed` dolu.
- `status_stage_conflict`: (not_interested ∧ açık aşama) ya da (buyer_ready ∧ LOST).
- `checked` = kod `lead.checkedWarnings` içinde.

**3.3.6 Lead ve alanlar**
- `lead.ts` Lead'e eklenir: `customerStatus`, `products: ProductPrefs`, `installSite`, `installTimeline`, `customerProfile`, `courtCountBand`, `adSurface` (products dışında hepsi `| null`), `checkedWarnings: string[]`, `contactHistoryUnknown: boolean`.
- `opportunity.ts` LeadFields'a (S5'te) eklenir: `country` (`/^[A-Z]{2}$/`), `products`, `installSite`, `installTimeline`, `customerProfile`, `courtCountBand`, `adSurface`. `customerStatus` LeadFields'ta **değildir** (ayrı komut, D1).
- `parseLeadFields` katı mod (PATCH): geçersiz kod → RuleError `lead.<alan>`. `parseLeadFieldsLenient` (intake, içe aktarma): geçersiz kod düşer, `{fields, dropped: {key, raw}[]}` döner; lead yine oluşur.

**3.3.7 `trackingReport.ts` (yeni)**
```ts
export function proposalFacts(current: StageCode, liveEvents: readonly StageEvent[], contact: ContactSummary):
  { given: boolean; at: Date | null; via: "stage" | "contact" | null };
  // stageAt = geri alınmamış ilk PROPOSAL olayı (auto_fill dahil); at = min(stageAt, contact.proposalContactAt)
export interface LeadTracking { contact: ContactSummary; proposal: ReturnType<typeof proposalFacts>;
  warnings: DataWarning[]; hot: boolean; courtTotal: number | null; roofAreaM2: number | null }
export function leadTracking(lead: Lead, liveEvents: readonly StageEvent[], rows: readonly ContactAggregateRow[],
  timeZone: string): LeadTracking;   // liste, pano, Bugün ve rapor: tek türetme yolu
export const isHotUncontacted = (lead: Lead, t: LeadTracking) => t.hot && t.contact.state === "never";  // şerit = liste [K-I8]
export function buildTrackingReport(i: { items: { lead: Lead; t: LeadTracking }[]; teamIds: readonly string[] | null;
  now: Date; timeZone: string }): TrackingReport;
```
`domain/reports.ts` içindeki "aşamaya ulaştı" koşulu `reachedStage(code, current, liveEvents)` olarak dışa açılır; `proposalFacts` bunu kullanır.

Metrik tanımları (N = kapsamdaki lead):

| Metrik | Tanım |
|---|---|
| total | N |
| mailSent / whatsappSent | `channels.email?.count > 0` / `channels.whatsapp?.count > 0` |
| neverReached / legacyNoContact / contacted | `state` = never / legacy / contacted |
| replied | `contact.replied` |
| proposalGiven | `proposal.given` |
| buyers | `customerStatus === "buyer_ready"` |
| share.x | N > 0 ? x/N : 0 |
| byOwner satırları | `teamIds` (aktif satış kullanıcıları; null ise yalnız lead'i olanlar) ∪ lead'i olan sahipler; havuz (null) en sonda. Ada göre sıralama UI'da yapılır. |
| byOwner.reachRate | (lead − legacy) > 0 ? contacted/(lead − legacy) : null |
| byOwner.replyRate | contacted > 0 ? replied/contacted : null |
| byOwner.proposalRate | lead > 0 ? proposal/lead : null |
| poolBreakdown | havuz lead'leri `extraAnswers.excel_owner` etiketine göre; null = "Excel'de sorumlu yok". Aynı sütunlar. |
| statusByOwner | byOwner ile aynı satırlar × {5 kod, none} + toplam |
| products.preferred | adet > 0 (kort) / `roof.wanted` (kapatma) |
| amongProposals / amongBuyers | preferred ∧ proposalGiven / preferred ∧ buyers |
| shareOfProposals | proposalGiven > 0 ? amongProposals/proposalGiven : null |
| totalQty / totalAreaM2 | Σ adet / Σ roofAreaM2 (null atlanır) |
| closingPotential | install_site = covered_court |
| byInstallTimeline | 4 kod sabit sırada + `null` satırı (lead > 0 ise); sütunlar lead, never, legacy, replied, proposal; neverRate = (lead − legacy) > 0 ? never/(lead − legacy) : null |

Excel kümesinde `legacy` = 0 olduğundan oranlar Excel formülleriyle aynıdır: (Lead − Hiç)/Lead ve Dönüş/(Lead − Hiç).

### 3.4 `court_count` ve `court_model` kararı (D4)

- `court_count` ürün satırlarından **yazılmaz** [M-M3]. Formdan gelen kesin sayıyı korur; ürünler temizlenince kaybolmaz.
- Ürün adedi varken gelen PATCH `courtCount` reddedilir (`court_count.derived`), iki kaynak çelişmesin.
- Ekranda doğrudan kort sayısı girişi yoktur. Gösterim sırası: `courtTotal` > 0 → "Toplam kort: 2 (ürünlerden)"; yoksa `court_count` → "4 kort"; yoksa bant → "2-3 kort (form)" [U-M4].
- `court_model` eski bilgidir, salt okunur; UI artık yazmaz. Yönetici ürün panelinde "Eski model bilgisi: …" satırını görür ve elle ürüne çevirir (yerelde 1 lead). Otomatik eşleme yok (Klasik = Standard varsayımı satış onayı ister). `COURT_MODELS` veri listesi formlardan kalkar.
- `product_interest` (intake hedefi) kalır; Proje panelinde "Ürün ilgisi (formdan)".
- ADR-0014 bu kararı yazar; ADR-0013'e "aktivite türü listesi genişledi, `contact_logs`" eki eklenir.

---

## 4. Uygulama ve API

### 4.1 Komutlar (`src/modules/sales-pipeline/application/`)

| Komut | Dosya | Girdi → çıktı | Kurallar |
|---|---|---|---|
| `LogContact` | `contacts.ts` (yeni) | `LogContactInput` → `{logId, activity, next, stage: {changeId}\|null, assignedTo, undoUntil}` | Adımlar aşağıda. Aşamayı yalnız `ChangeLeadStage` çağırarak değiştirir. Log'a yalnız id'ler. |
| `UndoLogContact` | `contacts.ts` | `{logId, actor}` → `{undone: true, stageUndone: boolean}` | Adımlar aşağıda. |
| `ContactForm` (sorgu) | `contacts.ts` | `{leadId, actor}` → `ContactFormDto` | Diyaloğun ihtiyaç duyduğu her şey: açık işler, `completableId`, (tür × sonuç) varsayılanları, izinler. |
| `SetCustomerStatus` | `leadStatus.ts` (yeni) | `{leadId, status: code\|null, actor}` → Lead | `loadActionableLead`. Admin, sahip ya da havuz lead'inde satışçı (lead ona atanır + `LeadAssigned`). |
| `CheckWarning` / `UncheckWarning` | `leadStatus.ts` | `{leadId, code, actor}` → Lead | `requireAdmin`; kod `WARNING_CODES` içinde; idempotent. |
| `UpdateLeadFields` | `updateLeadFields.ts` | yeni anahtarlar (S5) | Aşağıda. |
| `UpdateLeadContact` | mevcut | — | Telefon değişince `PROVENANCE_KEYS.phone` silinir, `WARNINGS_CLEARED_BY.phone` kontrol listesinden düşer. |
| `CreateLead` | `createLead.ts` | yeni girdiler (S5, S6) | Aşağıda. |
| `DeleteActivity` | `activities.ts` | — | Açık aktivite: bugünkü gibi. Tamamlanmış: `requireAdmin` (`admin_only`). |
| `SetActivityDone` | `activities.ts` | — | `done=false` yalnız admin ve yalnız `log_id` boş satırda; `log_id` doluysa `contact.reopen_logged` (geri al ya da sil) [M-M5]. Açarken outcome, customer_replied, result_note, done_by, date_estimated temizlenir. `done=true` sonuçsuz kalır (API uyumu; UI kullanmaz). |
| `UndoStageChange` | mevcut | `+ changeId?` | `changeId` verilmiş ve son değişiklik o değilse `undo.stale` [M-I1]. `removeAutoCreatedByChange` yalnız `done_at IS NULL` satırları siler. |

`LogContactInput`:
```ts
{ leadId; actor; activityId?: string; type; outcome; customerReplied?: boolean; occurredAt?: Date; note?: string;
  next?: { type; dueAt; subject?; notes? } | null;
  quick?: boolean;                                     // çubuktaki "Evet, kaydet" / "Açmadı, kaydet"
  customerStatus?: CustomerStatus | null;              // undefined = dokunma
  stage?: { target: StageCode; value?: { amount: number; currency: string } | null; lostReasonCode?: string } }
```

`LogContact` adımları:
1. `loadActionableLead(actor, leadId)`; açık aktiviteleri yükle.
2. `quick` ise: `activityId = pickCompletable(...)?.id`, `next = suggestNext(...)`, `customerStatus` ve `stage` yok sayılır.
3. Doğrulama (hiçbir şey yazılmadan): `validateContact` (`completingType` = tamamlanan aktivitenin türü); `next` varsa `validateActivity` + `dueAt ≥ şimdi − 5 dk` (`contact.next_past`); `activityId` bu lead'in açık aktivitesi değilse `contact.activity_not_open`; durum kodu ve izni (`SetCustomerStatus` ile aynı kural); aşama:
   - İzinli hedef = `stageLine(outcome, current).target`, ayrıca durum `not_interested` ise LOST. Başka hedef → `contact.stage_not_allowed`.
   - `stageLine` modu `fixed` iken `stage` yoksa → `contact.proposal_stage_required` [U-I3].
   - Hedef PROPOSAL/WON/LOST iken `next` verilmişse → `contact.next_with_stage`.
4. `stage` varsa önce `ChangeLeadStage.execute({leadId, target, value, lostReasonCode, actor})` (kendi işlemi, mevcut bütün kurallar ve platform olayları). Hata → olduğu gibi döner, hiçbir şey yazılmamıştır.
5. Tek `uow.run`: `contact_logs` satırı (`prev_type`, `prev_subject`, `status_before/after`, `stage_change_id`); `activityId` varsa `complete(id, {doneAt, type, outcome, customerReplied, resultNote, doneBy, logId})`, yoksa tamamlanmış satır (`subject = DEFAULT_SUBJECTS[type]`, `dueAt = doneAt = occurredAt`, `createdBy = doneBy = actor`, `logId`); `next` açık satır (`nextOfLogId`); durum; havuz lead'i hâlâ atanmamışsa ve actor admin değilse `updateAssignee` + `LeadAssigned` (`assigned_on_log = true`).
6. 5. adım hata verirse ve 4. adımda aşama değiştiyse `UndoStageChange({leadId, changeId})` ile telafi edilir; hata döner. Tek istekte ya ikisi birden kalır ya hiçbiri.

`UndoLogContact` adımları:
- İzin: admin her zaman. Satışçı yalnız `actor_user_id` kendisiyse ve `created_at + undoWindowMs ≥ şimdi` ise; aksi halde `contact.undo_expired` (422) ya da `admin_only`.
- `stage_change_id` doluysa önce `UndoStageChange({leadId, changeId})`. `undo.stale` ya da `undo.expired` dönerse temas yine geri alınır, `stageUndone: false`.
- Tek işlemde: `log_id = X` olup tamamlanan plan olmayan satırlar silinir; `next_of_log_id = X AND done_at IS NULL` satırlar silinir; tamamlanan plan yeniden açılır (done_at, outcome, customer_replied, result_note '', done_by, date_estimated false, log_id null; `type = prev_type`, `subject = prev_subject`); durum hâlâ `status_after` ise `status_before` geri yazılır; `contact_logs` satırı silinir.
- Atama geri alınmaz (satışçı "Havuza bırak" ile bırakır).

`UpdateLeadFields` (S5):
- Yeni anahtarlar: country, products, installSite, installTimeline, customerProfile, courtCountBand, adSurface.
- Ürün adedi varken `courtCount` → `court_count.derived`.
- `country` değişirse `PROVENANCE_KEYS.country` silinir, `WARNINGS_CLEARED_BY.country` kodları `checked_warnings`'ten düşer.
- Satışçı için `requireFieldAccess(actor, fields, policy)` (`repEditableLeadFields(policy)`).

`CreateLead` (S5):
- Yeni girdiler: `customerStatus`, products, profil alanları, `adSurface`, `parseMode: "strict"|"lenient"`, `invalidPhone: "reject"|"drop"`, provenance anahtarlı `extraAnswers`, `adoptImportLead: boolean` (yalnız intake).
- `drop` ve geçerli e-posta: telefon null, ham değer `extraAnswers.phone_raw`.
- Satışçı oluştururken yalnız `REP_CREATABLE_LEAD_FIELDS = ["notes","company","city","customerStatus"]` + ad/e-posta/telefon/ülke verir; diğerleri `admin_only`. 7e ile tutarlıdır ve oluşturmadaki eski açığı kapatır.
- `adoptImportLead` [M-I12][K-M15]: eşleşen kişinin `extra_answers ? 'excel_no'` olan açık lead'i varsa ve kampanya aynı ya da boşsa yeni lead açılmaz: boş alanlar doldurulur (esnek), `extra_answers.platform_lead_id` yazılır, inbox satırı o lead'e bağlanır. Kaynak `import` kalır.
- (S6) `unavailable` = kural kullanıcılarından `inactiveUserIds()` içinde olanlar; dizin bilinmiyorsa (null) süzme yapılmaz [M-I3].

Yetki anahtarı (D4) [M-I9]:
```ts
// permissions.ts
export const REP_EDITABLE_LEAD_FIELDS: readonly (keyof LeadFields)[] = ["notes"];
/** Açık soru 1: satışçı ürün tercihlerini düzenleyebilsin mi? Tek anahtar: config `repsEditProducts`
 *  (env REPS_EDIT_PRODUCTS=1), varsayılan false. */
export const repEditableLeadFields = (p: { repsEditProducts: boolean }) =>
  p.repsEditProducts ? [...REP_EDITABLE_LEAD_FIELDS, "products" as const] : REP_EDITABLE_LEAD_FIELDS;
```
`UseCaseDeps.policy?: { repsEditProducts: boolean }` (varsayılan false). Router aynı değeri `/reference.permissions`'a yazar. Testler iki değeri de bağımlılıkla dener.

### 4.2 Sorgular

- **Ortak lead filtresi** (`LeadFilterInput`, `/leads` ve `/board`): `owner[]` (kullanıcı id, `me`, `pool`), `country[]`, `source[]`, `stage[]` (yalnız liste), `rotting`, `contact?: "never"|"legacy"|"contacted"|"no_reply"|"replied"` (no_reply = contacted ∧ ¬replied), `hot`, `warning` (kontrol edilmemiş "warn" uyarısı; yalnız admin), `scope?: "excel"` (`extra_answers ? 'excel_no'`), `campaign` (tam eşleşme), `q`, `includeTest`. Tek ayrıştırıcı `parseLeadFilter(req.query)` [U-I14].
- `LeadQueries.list/board/get`: `withSummaries` üçüncü sorgu olarak `activities.contactAggregatesByLeads(ids)` alır, her öğeye `leadTracking(...)` ekler; DTO'da uyarılar `visibleWarnings(all, actor.isAdmin)`. `get` yüklü aktivitelerden `aggregateContacts` ile hesaplar ve `contactLogs` (pencere içindeki kayıtlar: `{id, activityId, createdAt, undoUntil, canUndo}`) ile `lastChange.contactLogId` döner [U-I7]. Bellek içi süzme `rotting`'in yanında; kolon istatistikleri süzülmüş kümeden.
- `ActivityQueries.today`: `hotUncontacted` = görünür, açık aşamalı, `install_timeline = 'm0_3'` lead'ler (SQL ön süzgeci) üzerinde `isHotUncontacted` sayımı. Ayrı SQL tanımı yok [M-I6][K-I8]. Öğelere `lead.lastOutcome`, `lead.lastType` eklenir [M-M9].
- `ContactQueries.history` (`contactQueries.ts`, yeni): `{actor, from?, to?, type?, outcome?, owner? (lead sahibi), doneBy?, q? (lead adı), note? (not metni), before?: "<iso>|<id>", limit ≤ 1000 (vars. 200)}`. Görünür lead'lerin tamamlanmış aktiviteleri `(done_at DESC, id DESC)` anahtar kümesiyle [M-I7]; her öğeye aynı kaydın açık `next`'i eklenir; `{items, nextBefore}`.
- `ReportQueries.tracking`: `{actor, from?, to?, source?, campaign?, owner?, scope?}`. Aynı `visibleTo`; test lead'leri hariç; tarih süzgeci `created_at` İstanbul günüyle. Tek `uow.run`: leads, events, aggregates; `teamIds = await deps.users?.activeSalesUserIds() ?? null`; sonra `buildTrackingReport`. `campaigns` = görünür lead'lerdeki farklı `campaign_name`. `scopeCounts = {all, excel}`.

### 4.3 Port ve depo değişiklikleri

- `ActivityRepository`:
  - `contactAggregatesByLeads(ids)`: `SELECT lead_id, type, outcome, customer_replied, date_estimated, count(*)::int n, min(done_at), max(done_at) FROM activities WHERE done_at IS NOT NULL AND lead_id = ANY($1::uuid[]) GROUP BY 1,2,3,4,5`. Dönüş kuralı SQL'de tekrar yazılmaz.
  - `complete(id, patch)`, `reopen(id, {type, subject})`, `removeCreatedByLog(logId, exceptId)`, `removeOpenNextOfLog(logId)`, `listDone(filter)` (anahtar kümesi).
  - `setDone(false)` alanları temizler; `removeAutoCreatedByChange` + `AND done_at IS NULL`.
  - Sahte depo `aggregateContacts`'ı çağırır; altyapı testi SQL ile domain toplamını karşılaştırır.
- `ContactLogRepository` (yeni): `insert`, `findById`, `remove`.
- `LeadRepository`: `FIELD_COLUMN` yeni eşlemeler; `products` 6 sütuna açılır; `rows.ts` numeric'i `Number()` ile okur (iki sürücü de metin döndürür); `setCustomerStatus`, `setCheckedWarnings`, `removeExtraAnswerKeys(leadId, keys)`; `list` çoklu değerli filtreler ve `visibleTo.ruled`.
- `TerritoryRuleRepository.upsert(cc, userId, fallback?)` (S6). "Kurallı ülkeler" ayrı metot değil, `territories.all()`'dan çıkar.
- `UserDirectory` (application `notifications.ts`; `UseCaseDeps.users?` olarak `types.ts`'e) [M-I3]: `activeSalesUserIds(): Promise<string[] | null>` (S4), `inactiveUserIds(): Promise<ReadonlySet<string> | null>` (S6). null = bilinmiyor → süzme yok, rapor yalnız lead'i olan sahipleri gösterir. 5 dk önbellek. İsteğe bağlı kalır; `importMysql.ts` ve `migrateLegacy.ts` değişmeden derlenir.

### 4.4 Uç noktalar (`/api/pipeline`)

Hata kodları: bilinmeyen RuleError 422; `admin_only`, `lead.forbidden` 403; `not_found` 404 (mevcut `STATUS`) [M-M1].

| Yöntem ve yol | Gövde / sorgu | Yanıt | Hatalar |
|---|---|---|---|
| GET `/leads/:id/contact-form` | — | `ContactFormDto` | 403 `lead.forbidden`, 404 |
| POST `/leads/:id/contacts` | `LogContactBody` | 201 `LogContactResultDto` | 422 `contact.*`, `stage.*`; 403 `read_only`, `lead.forbidden`; 404 |
| POST `/contact-logs/:logId/undo` | — | 200 `{undone, stageUndone}` | 422 `contact.undo_expired`; 403 `admin_only`; 404 |
| POST `/leads/:id/undo` | mevcut + `{changeId?}` | mevcut | 422 `undo.stale` (yeni) |
| PUT `/leads/:id/customer-status` | `{status: code\|null}` | 200 `LeadDto` | 422 `lead.customer_status`; 403 |
| POST / DELETE `/leads/:id/warnings/:code/check` | — | 200 `LeadDto` | 403 `admin_only`; 422 `warning.code` |
| GET `/activities/history` | `from, to (YYYY-MM-DD), type, outcome, owner, doneBy, q, note, before, limit` | `ContactHistoryDto` | 422 `history.range` |
| GET `/activities/today` | — | `TodayDto` + `hotUncontacted` | — |
| GET `/board` | ortak filtre (stage hariç) | `BoardDto` (zengin `LeadListDto`) | — |
| GET `/leads` | ortak filtre; `limit` üst sınırı 2000 kalır [M-M11] | `LeadListDto[]` | — |
| GET `/reports/tracking` | `from, to, source, campaign, owner, scope` | `TrackingReportDto` | 422 `report.range` |
| PATCH `/leads/:id` | yeni anahtarlar | `LeadDto` | 403 `admin_only`; 422 `product.*`, `court_count.derived`, `lead.*` |
| POST `/leads` | yeni anahtarlar | 201 | 403 `admin_only` (satışçı fırsat alanı) |
| GET `/reference` | — | yeni listeler (§4.5) | — |
| DELETE `/activities/:id`, POST `/activities/:id/done` | mevcut | — | §4.1 kuralları |

Yeni rotalar `api/contactRoutes.ts` (S3) ve `api/trackingRoutes.ts` (S4) dosyalarındadır; `router.ts` yalnız bağlar.

Sunucu: `GET /api/users?all=1` (yalnız admin ve görüntüleyici): KullaniciBilgileri'nin bütün satırları `{id, name, email, role, active}`; parola ve telefon yok (`authDb.listDirectory()`). Varsayılan çağrı (aktif satış) değişmez.

### 4.5 DTO'lar (`api/dto.ts`; yeni tipler `api/dto.contact.ts` ve `api/dto.tracking.ts`, `dto.ts`'ten yeniden dışa açılır)

```ts
export type ActivityTypeDto = "call"|"email"|"whatsapp"|"meeting"|"proposal_sent"|"site_visit"|"other";
export type ActivityOutcomeDto = "reply_received"|"awaiting_reply"|"proposal_sent"|"follow_up"|"negative"|"agreed";
// ActivityDto += outcome: ActivityOutcomeDto|null; customerReplied: boolean; resultNote: string; doneByUserId: string|null;
//               dateEstimated: boolean; logId: string|null; nextOfLogId: string|null
export interface LogContactBody { activityId?: string; type: ActivityTypeDto; outcome: ActivityOutcomeDto; customerReplied?: boolean;
  occurredAt?: string; note?: string; next?: { type: ActivityTypeDto; dueAt: string; subject?: string; notes?: string } | null;
  quick?: boolean; customerStatus?: string | null;
  stage?: { target: StageCodeDto; value?: { amount: number; currency: string } | null; lostReasonCode?: string } }
export interface LogContactResultDto { logId: string; activity: ActivityDto; next: ActivityDto|null;
  stage: { changeId: string } | null; assignedTo: string|null; undoUntil: string }
export type StageLineModeDto = "fixed"|"checked"|"unchecked"|"checked_if_replied";
export interface ContactFormDto {
  lead: { id: string; fullName: string; currentStage: StageCodeDto; assignedUserId: string|null; customerStatus: string|null; createdAt: string };
  openActivities: { id: string; type: ActivityTypeDto; subject: string; dueAt: string }[];   // vadeye göre
  completableId: string | null;
  channels: ActivityTypeDto[];          // 5 kanal + tamamlanacak planın türü (proposal_sent/site_visit ise)
  defaultType: ActivityTypeDto;         // tamamlanacak planın türü, yoksa son temas kanalı, yoksa call
  defaults: Record<string, Record<ActivityOutcomeDto, {
    next: { type: ActivityTypeDto; dueAt: string; subject: string } | null;
    stage: { target: StageCodeDto; mode: StageLineModeDto } | null }>>;
  canSetStatus: boolean; assignsOnSave: boolean; now: string; timeZone: string }
export interface ChannelFactsDto { count: number; firstAt: string; lastAt: string; firstReplyAt: string|null; firstReplyEstimated: boolean }
export interface ContactSummaryDto { state: "contacted"|"legacy"|"never"; count: number; firstAt: string|null; firstAtEstimated: boolean;
  lastAt: string|null; lastAtEstimated: boolean; lastOutcome: ActivityOutcomeDto|null; lastType: ActivityTypeDto|null;
  replied: boolean; firstReplyAt: string|null; channels: Partial<Record<ActivityTypeDto, ChannelFactsDto>> }
export interface ProductPrefsDto { standard: number|null; panoramic: number|null; fullPanoramic: number|null;
  roof: { wanted: boolean; widthM: number|null; lengthM: number|null } }
export interface DataWarningDto { code: string; severity: "warn"|"info"; checked: boolean; params?: Record<string,string> }
// LeadDto += customerStatus, products: ProductPrefsDto, installSite, installTimeline, customerProfile, courtCountBand, adSurface,
//            checkedWarnings: string[], contactHistoryUnknown: boolean
// LeadListDto += contact: ContactSummaryDto; proposal: { given: boolean; at: string|null; via: "stage"|"contact"|null };
//                warnings: DataWarningDto[] (izleyene göre süzülmüş); hot: boolean; courtTotal: number|null; roofAreaM2: number|null
// LeadDetailDto += contactLogs: { id: string; activityId: string|null; createdAt: string; undoUntil: string; canUndo: boolean }[];
//                  lastChange.contactLogId: string|null
// UpdateLeadBody += country?, products?: ProductPrefsDto, installSite?, installTimeline?, customerProfile?, courtCountBand?, adSurface?
// CreateLeadBody += customerStatus?, products?, installSite?, installTimeline?, customerProfile?, courtCountBand?
export interface ContactHistoryItemDto { activity: ActivityDto; lead: { id: string; fullName: string; company: string;
  currentStage: StageCodeDto; assignedUserId: string|null }; next: { id: string; type: ActivityTypeDto; dueAt: string } | null }
export interface ContactHistoryDto { items: ContactHistoryItemDto[]; nextBefore: string|null }
// TodayDto += hotUncontacted: number;  TodayItemDto.lead += lastOutcome, lastType
export interface OwnerRowDto { ownerId: string|null; lead: number; mailSent: number; whatsappSent: number; neverReached: number;
  legacyNoContact: number; contacted: number; replied: number; proposalGiven: number; buyers: number;
  reachRate: number|null; replyRate: number|null; proposalRate: number|null }
export interface TrackingReportDto {
  scope: { from: string|null; to: string|null; source: string|null; campaign: string|null; owner: string|null;
    scope: "excel"|null; repScoped: boolean; counts: { all: number; excel: number } };
  header: { firstLeadAt: string|null; lastLeadAt: string|null; reportDate: string };
  basics: { total: number; mailSent: number; whatsappSent: number; neverReached: number; legacyNoContact: number; replied: number;
    proposalGiven: number; buyers: number;
    share: Record<"mailSent"|"whatsappSent"|"neverReached"|"replied"|"proposalGiven"|"buyers", number> };
  byOwner: OwnerRowDto[]; byOwnerTotal: Omit<OwnerRowDto,"ownerId">;
  poolBreakdown: (Omit<OwnerRowDto,"ownerId"> & { excelOwner: string|null })[];
  statusByOwner: { ownerId: string|null; counts: Record<string, number>; total: number }[];
  statusTotal: { counts: Record<string, number>; total: number };
  products: { code: "standard"|"panoramic"|"full_panoramic"|"roof"; preferred: number; amongProposals: number;
    shareOfProposals: number|null; amongBuyers: number; totalQty: number|null; totalAreaM2: number|null }[];
  closingPotential: number;
  byInstallTimeline: { timeline: string|null; lead: number; neverReached: number; legacyNoContact: number; replied: number;
    proposalGiven: number; neverRate: number|null }[];
  campaigns: string[] }
// ReferenceDto += activityTypes, contactChannels, activityOutcomes, outcomeDisplayOrder, replyOutcomes,
//   contactRules: { repliedFlagOutcomes, repliedDefaultTypes, statusOutcomes, statusSuggestsLost, noteMax, minContactDate,
//                   futureToleranceMinutes }, timeZone,
//   customerStatuses: {code, tone, icon}[], installSites, installTimelines: {code, heat}[], customerProfiles, courtCountBands,
//   products: {code, kind: "court"|"roof"}[], productQtyMax: 29, warningCodes: {code, severity, repVisible}[],
//   importIssueCodes, permissions: { repsEditProducts: boolean }
```
Kayma önlemi [M-I10]: `tests/types/dto-parity.test.ts` tip testleri: `ActivityTypeDto` = domain `ActivityType`; `Jsonify<LeadListItem>` → `LeadListDto`'ya atanabilir (Date → string); `Jsonify<TrackingReport>` → `TrackingReportDto`. Alan adları domain ile aynıdır (`firstReplyAt`).

### 4.6 Yetki matrisi

"Havuz" = atanmamış ve satışçının görebildiği lead (§4.8). Görüntüleyici API'de 403 `read_only` alır.

| Eylem / alan | Yönetici | Sahip satışçı | Diğer satışçı | Görüntüleyici |
|---|---|---|---|---|
| Lead görme (temas özeti, teklif, ürün, form cevapları) | ✔ hepsi | ✔ kendi | Yalnız havuz lead'i | ✔ hepsi |
| Veri uyarıları | ✔ hepsi (panel, ⚠, Uyarılı, Kontrol sütunu) | Yalnız telefon ve çatı ölçüsü uyarısı, bilginin yanında | Havuzda aynı | ✔ hepsi, salt okunur |
| Temas kaydet / planı temasla tamamla | ✔ | ✔ | Havuzda ✔ (lead ona atanır) | ✘ |
| Temas kaydını geri al | ✔ süresiz (aşama yalnız 10 dk içinde ve son değişiklikse) | Kendi kaydı, 10 dk | ✘ | ✘ |
| Tamamlanmış teması silme | ✔ | ✘ | ✘ | ✘ |
| Tamamlanmış aktiviteyi yeniden açma | ✔ yalnız temas kaydı olmayan satır | ✘ | ✘ | ✘ |
| Açık aktivite planlama / silme | ✔ | ✔ | Havuzda ✔ | ✘ |
| Müşteri durumu (D1) | ✔ | ✔ | Havuzda ✔ (lead ona atanır) | ✘ |
| Ürün tercihleri ve çatı ölçüsü (D4) | ✔ | `repsEditProducts` açıksa ✔ | Anahtar açıksa havuzda ✔ | ✘ |
| Kort sayısı (`court_count`) | Formdan gelir; ekranda girilmez; ürün adedi varken API'de de değişmez | — | — | — |
| Form cevapları: kurulum yeri/zamanı, profil, kort bandı, platform (D5) | ✔ düzeltir | Salt okunur | Salt okunur | Salt okunur |
| Kampanya | Salt okunur (intake ve içe aktarma yazar) | Salt okunur | Salt okunur | Salt okunur |
| Lead ülkesi | ✔ | ✘ | ✘ | ✘ |
| Not (`notes`) | ✔ | ✔ | Havuzda ✔ | ✘ |
| Uyarıyı "Kontrol edildi" yapma | ✔ | ✘ | ✘ | ✘ |
| Üstlen (havuzdan al) | ✔ | — | Havuzda ✔ | ✘ |
| Özet rapor | Bütün ekip | Kendi + görebildiği havuz (kapsam satırıyla) | — | Bütün ekip |
| Lead listesi | Pano görünürlüğü | Pano görünürlüğü | Pano görünürlüğü | Pano görünürlüğü |
| Excel'e aktar (CSV, kişisel veri) | ✔ | ✘ (düğme yok) | ✘ | ✘ (düğme yok) |
| Lead oluştururken ad, e-posta, telefon, ülke, firma, şehir, not, müşteri durumu | ✔ | ✔ | ✔ | ✘ |
| Lead oluştururken ürün, form cevapları, kort, kapanış, kuruluş, sorumlu | ✔ | ✘ | ✘ | ✘ |
| Bölge kuralları | ✔ (betik; 7b ekranı) | ✘ | ✘ | ✘ |

Not: görüntüleyici oturumu bugün `isAdmin: true` aktörüyle aynı veriyi alır (`actorFromSession`); CSV düğmesinin gizlenmesi bir güvenlik denetimi değildir, arayüz kararıdır [M-M12].

### 4.7 Intake (D5)

- `integration-settings/domain/mapping.ts`: `MAPPING_TARGETS` += `install_site`, `install_timeline`, `customer_profile`, `court_count` (DB kısıtı 0012'de). `MappedFields` += `answers: Partial<Record<…, string>>` (ilk boş olmayan ham değer).
- `lead-intake/application/formAnswers.ts` (yeni, saf): `normalizeFormAnswers(answers, extra)` → `{installSite, installTimeline, customerProfile, courtCountBand, courtCount, unmatched: {target, raw}[]}`.
  - `fold`: tr-TR küçük harf; ç ğ ı ö ş ü → c g i o s u; harf ve rakam dışı karakterler tek boşluk; trim. Müşteri durumu eşlemesi (içe aktarma) de aynı `fold`'u kullanır [K-M8].
  - Soru tespiti: açık eşleme her zaman önceliklidir. Yoksa `extra` anahtarları katlanmış eşanlamlılarla eşleşir: kurulum yeri ("kurulum yeri", "where do you plan to install the court s"), kurulum zamanı ("kurulum zamani", "what is your estimated project timeline"), profil ("musteri profili"), kort ("kort sayisi", "kac kort", "how many courts do you need").
  - Değer eşanlamlıları: §3.2'deki Excel TR etiketleri (katlanmış) ve bilinen API anahtarları: `full_cover_padel_court_` → covered_court, `existing_asphalt_or_concrete` → existing_ground, `beach_/_sand` → beach_windy, `other` → other, `asap` ve `within_1-3_months` → m0_3, `within_3-6_months` → m3_6, `within_6-12_months` → m6_12, "just researching" → researching.
  - Kort: kesin sayı n (1–999) → `courtCount = n`, bant `bandForCount(n)`; aralık ("2-3", "2or 3", "3 or 4") → en büyük sayının bandı; sayı kelimeleri (EN one…ten, TR bir…on); bant etiketi ("2-3 kort", "7+ kort") → bant; diğerleri unmatched.
  - Eşleşmeyenler: alan null, `extraAnswers.unmatched_answers`'a yazılır (7a/7b listeler); ham cevap `extraAnswers`'ta kalır.
- `buildLead.ts`: normalizer'ı çağırır; ülke telefondan geldiyse `extraAnswers.country_source = "phone"`; ülke kodsuz ham telefon varsayılan bölgeyle ayrıştırıldıysa `extraAnswers.dial_code_assumed = "+NN"`.
- `InboundLeadDto` += `profile`, `courtCount`, `adSurface`. `createLeadFromAd.ts` bunları iletir; `parseMode: "lenient"`, e-posta geçerliyse `invalidPhone: "drop"`, `adoptImportLead: true`. Bozuk telefon ya da geçersiz kod inbox satırını `failed` yapmaz.
- Meta adaptörü: `extra.platform` yerine `dto.adSurface = lead.platform` (opak kod). Web formu: `adSurface = "web"`. Google adaptörü: özel soru politikası `ignore` → `extra` (cevaplar eşlemeye ulaşır; test beklentisi güncellenir).
- Kod listeleri `sales-pipeline/application/index.ts` üzerinden dışa açılır; lead-intake yalnız application'dan içe aktarır (dependency-cruiser).

### 4.8 Bölge, ekip ve bildirim (D7)

- **Görünürlük değişmez (orkestratör kararı, 2026-11-10):** satışçı bugünkü gibi kendi lead'lerini ve bütün ortak havuzu görür. Bölge kuralları yalnız yeni lead'in otomatik atanmasında kullanılır. Havuzu bölgeye göre daraltmak kullanıcının istemediği bir davranış değişikliğidir; §8 soru 3'te öneri olarak durur. Bu yüzden on çağrı yerini taşıyan `loadVisibility` yeniden düzenlemesi de yapılmaz; yeni sorgular mevcut `visibility.ts` yardımcılarını kullanır.
- `CreateLead.resolveAssignment`: pasif kural kullanıcısı yedeğe ya da havuza gider; dizin bilinmiyorsa süzme yok (fail-open).
- **Bildirim:** mevcut davranış korunur (yeni lead sahibine `LeadCreated` bildirimi). Tek ek: `install_timeline = m0_3` ise metin "Sıcak lead:" ile başlar. Atamada yeni bildirim türü ve içe aktarmada özet bildirim yoktur (istenmedi).
- **Ad gösterimi:** `useTeamNames` `?all=1` dizinini kullanır; pasif kullanıcı "Sena (pasif)". `assignable` aktif satış kullanıcılarıyla sınırlı kalır.
- **Eşleştirici** `src/bootstrap/teamMatch.ts` (saf), `matchTeamLabel(label, directory, overrides)`. Sıra:
  1. overrides; 2. "ATANMADI" → havuz; 3. e-posta (büyük-küçük harf duyarsız, yalnız `Durum=Aktif` ve `YetkiTuru ∈ {Yonetici, Temsilci}`, **tam bir** eşleşme); 4. katlanmış Ad ya da "Ad Soyad", aynı küme, tam bir eşleşme; 5. yoksa `unresolved` + neden: `ambiguous` (aday id'leriyle), `inactive_only`, `not_in_directory`.
  - Beklenen: Yusa Bedir → 32, Simon Sharpe → 28, Ahlem → 47 (export2@ pasif 22'de de var; filtre ayıklar), Salah → 46.
  - Çözülmeyenler: Enes (satis@ iki aktif kullanıcıda, 26 ve 51), Beyza (sales@ yok; ad yalnız pasif 45'te), Mehmet ve Faruk (tabloda yok), Almanya Distribütörü (dış ortak).

---

## 5. Arayüz

### 5.0 Navigasyon (Hick, Jakob) [U-I15][U-I16]

- Üst menü 5 öğe: **Lead listesi** (Gelen kutusunun yerinde, açılış sayfası; `#/list`, eski `#/inbox` buraya yönlenir), Pano, Bugün, Kişiler, Raporlar. 7a gelince admin için Yönetim eklenir. Logo bağlantısı `#/list`.
- Pano yalnız kanbandır; görünüm anahtarı yok.
- Raporlar: "Aşama raporu | Özet rapor" sekmeleri, `#/reports?tab=summary`, `unixcrm.v2.reportTab`. Kapsam seçimi `unixcrm.v2.reportScope`.
- Bugün: "Yapılacaklar | Temas geçmişi" sekmeleri, `#/today?tab=history`.
- `App.tsx` bütün sayfalara sorgu parametrelerini geçirir. `setFilter` hash'i baştan kurmaz, parametreleri **birleştirir** (bugünkü hata).
- **Filtre hatırlama** [U-B1a]: `hasFilterParams` = `view`, `sort`, `page`, `size`, `tab` dışında herhangi bir anahtar (owner, country, source, stage, rotting, contact, hot, warning, scope, campaign, q, `f_*`, `from`). URL'de filtre varsa ya da `from` doluysa hatırlanan filtre uygulanmaz. Tarayıcı depolaması try/catch içinde, yalnız kolaylık içindir.

### 5.1 Pano (`KanbanPage.tsx`, `boardFilter.ts`)

- **Araç çubuğu:** Sorumlu ▾, Ülke ▾, Kaynak ▾ (Lead listesiyle aynı çoklu seçim menüsü; satışçıya sorumlu seçenekleri Tümü / Ben / Ortak havuz) [U-I14]. Hızlı filtre çipleri (`aria-pressed`, ikon + metin, en az 44 px): "Takipsiz" (saat ikonu), "Hiç ulaşılmamış", "Sıcak" (alev), "Uyarılı" (yalnız yönetici) [U-I18]. URL: `rotting=1`, `contact=never`, `hot=1`, `warning=1`. Etkin filtre sayısı görünür: "3 filtre · Filtreleri temizle" [U-M13].
- **Kart, 4 satır** [U-I10]:
  1. Ad (bağlantı).
  2. Alt başlık: ürün özeti ("2 Panoramic · Kapatma 200 m²"); yoksa kort bilgisi (§3.4) + ürün ilgisi; yoksa eski model. Boşsa satır yok.
  3. Tek durum çipi, öncelik sırasıyla: "Hiç ulaşılmadı" > "Takipsiz" > "Takip: yarın 09:00"; ayrıca uygunsa "Sıcak · 3 ay". Tutar çipi yalnız Teklif ve Kazanıldı sütunlarında.
  4. Alt satır: sorumlu adı ya da "Ortak havuz" (satışçıda 44 px "Üstlen" düğmesiyle) · "Son temas 2 g önce" / "Kayıt yok (eski)" · yöneticide "⚠ 2" (`aria-label="2 veri uyarısı"`).
  - Kaynak, ülke, beklenen kapanış ve aşamadaki gün lead sayfasına taşınır. Alev yalnız "Sıcak" demektir.
- `ageTone` (hooks.ts) `LeadListDto` alır, `contact.state === "never"` kullanır [M-M9].
- **Sürükleme:** temas kaydı olmayan lead NEW → CONTACTED bırakılınca "Temas kaydet" diyaloğu aşama satırı sabit "İletişim kuruldu" ile açılır; "Yalnız aşamayı taşı" ikincil bağlantısı mevcut akıştır (§2.6).
- **Durumlar:** iskelet kartlar sabit yükseklikte (CLS yok). Boş kolon: "Bu aşamada lead yok." Filtreyle boş: "Bu filtrelerle lead yok. [Filtreleri temizle]". Hata: "Pano yüklenemedi. [Tekrar dene]".

### 5.2 Lead sayfası (`LeadPage.tsx`)

- **Başlık bandı** [U-B2]:
  - Ad; etiket satırı: [Sıcak · 3 ay] [Müşteri: İlgili] (yalnız durum girilmişse, salt okunur) [Ortak havuz · Excel'deki sorumlu: Enes].
  - Tek birincil düğme **"Temas kaydet"** (44 px). İkincil menü düğmesi **"Aşama: İletişim kuruldu ▾"**: önce sonraki aşama, sonra diğerleri, en sonda tehlike stilinde "Kaybedildi"; `useStageMove` ile çalışır. Başlıktaki "Aktivite planla" kalkar ("+ Planla" Planlı aktiviteler panelindedir).
  - Havuz lead'inde satışçıya "Üstlen".
  - Son aşama değişikliği bir temas kaydından geldiyse başlıktaki geri al düğmesi "Temas kaydını geri al" olur ve birleşik geri almayı çalıştırır [U-I7].
  - Mobilde "Temas kaydet" alt yapışkan çubukta; bildirimler çubuğun üstünde [U-M14].
- **Veri uyarıları:** yöneticide başlığın altında sarı ortak bölge "⚠ 2 veri uyarısı" (açılır liste). Her satırda metin, "Düzelt" (ilgili formu açar; telefon/ülke uyumsuzluğunda Ülke ve Sorumlu seçenekleri [K-M11]) ve "Kontrol edildi". "Kontrol edilenler (n)" katlı. Bilgi uyarıları gri ikonla. Satışçıda panel yok; üç uyarı ilgili bilginin yanında satır içi metindir [U-I18].
- **Sol sütun:**
  1. *İletişim:* telefon (WhatsApp bağlantısı + ayrı "Ara" tel: bağlantısı), e-posta (mailto). Bağlantıya tıklanınca satırın altında kalıcı, modal olmayan çubuk (bildirim değil, kaybolmaz) [U-I6]:
     - WhatsApp / e-posta: "WhatsApp'ta mesaj gönderdiniz mi? [Evet, kaydet] [Ayrıntı ekle] [Göndermedim]". "Evet, kaydet" = `quick` kayıt; "Ayrıntı ekle" diyaloğu bu kanal ve "Dönüş bekleniyor" ile açar; "Göndermedim" çubuğu kapatır.
     - Ara: "Aramayı kaydedin: [Açmadı, kaydet] [Görüştük…]". "Açmadı" = Telefon + "Dönüş bekleniyor" hızlı kayıt; "Görüştük…" diyaloğu Telefon + "Dönüş alındı" ile açar.
  2. *Temas özeti* (`<dl>`, 2 sütun): İlk temas · Son temas (tarih + göreli; tahmini ise "≈ 22.10.2026 (tahmini)") · Temas sayısı; E-posta: "3 kez · son 05.11 · Dönüş: 06.11" ya da "Gönderilmedi"; WhatsApp aynı biçim; Diğer kanallar: "Telefon 2 · Toplantı 1"; Teklif: "Verildi · 28.10" (kaynak yalnız yönetici ipucunda) [U-M5]; temas yoksa "Hiç ulaşılmadı", eski kayıtta "Temas kaydı yok (eski kayıt)".
  3. *Müşteri* (Excel'deki MÜŞTERİ grubu) [U-B2]: "Müşteri durumu" seçimi, etiket üstte, yardım metni "Müşterinin kendi süreci; satış aşamasını değiştirmez." Düzenleyemeyene metin + "Durumu lead'in sorumlusu değiştirir." Havuz lead'inde satışçıya "Değiştirince lead size atanır." [U-I8][M-M13]. "İlgisiz" seçilince altında: "Lead'i kaybedildi olarak işaretlemek için Aşama menüsünü kullanın."
  4. *Proje — Ürün tercihleri:* Excel sırasıyla 4 satır: [☐ Standard] [− adet +], …, [☐ Kapatma] [Genişlik __ m] [Uzunluk __ m] → "Çatı alanı: 200,00 m²". Adet `inputmode="numeric"`, 1–29, −/+ düğmeleri 44 px, `aria-label="Panoramic adedi"`; ölçü `type="text" inputmode="decimal"` ("10,5" kabul), "m" dış ek [U-M3]. Okuma modunda "2 Panoramic · Kapatma 20 × 10 m (200 m²)", yoksa "Ürün tercihi girilmedi". Yöneticiye "Düzenle"; satışçıya "Ürün bilgilerini yönetici günceller; müşterinin söylediğini temas notuna yazın." Kort satırı §3.4; eski model bilgisi varsa ayrı satırda.
  5. *Form cevapları* (görünür blok): Kurulum yeri · Kurulum zamanı · Müşteri profili · Kort ihtiyacı (form) · Platform · Kampanya. Boş alan "—". Yöneticiye "Düzenle" (seçim kutuları).
  6. *Kaynak detayı* (katlı): nesneler bir düzey anahtar/değer olarak işlenir ("[object Object]" hatası giderilir). Etiketler: `mysql` → "Eski sistem kaydı", `excel_no` → "Excel satır no", `excel_owner` → "Excel'deki sorumlu", `excel_warning` → "Excel veri uyarısı" [K-I9]. Provenance anahtarları (`country_source`, `country_raw`, `dial_code_assumed`, `phone_raw`, `unmatched_answers`, `import_issues`) burada gizlenir, uyarı panelinde görünür. Kaynak etiketi Excel lead'inde "Excel · Instagram" [U-M8].
- **Sağ sütun:**
  - *Planlı aktiviteler:* "+ Planla" (mevcut satır içi form). Satırda ikon, konu, vade ve 44 px "Tamamla…" düğmesi (`aria-label="Tamamla: WhatsApp takibi — {lead}"`); diyaloğu tamamlama modunda açar [U-I4].
  - *Zaman çizelgesi:* aşama olayları + tamamlanmış temaslar, zamana göre azalan. Temas satırı: kanal ikonu, "WhatsApp · Dönüş bekleniyor", not (2 satır, tıklayınca açılır), "Kaydeden: Salah". Pencere içindeyse "Geri al (9:58)": geri sayım `aria-hidden`, düğme etiketi "Temas kaydını geri al, 9 dakika kaldı" [U-I7]. Yöneticide "Sil" (onay: "İlk/son temas tarihi ve temas sayısı değişir. Silinsin mi?") [U-M8].

### 5.3 "Temas kaydet" diyaloğu (`src/pipeline/contact/LogContactDialog.tsx`)

Yerel `<dialog>`, `showModal()`, odak tuzağı; açılınca odak ilk etkileşimli alanda (Sonuç). Açılırken `GET /leads/:id/contact-form` yüklenir (sabit yükseklikte iskelet). Başlık "Temas kaydet", alt satır "{lead adı} · {aşama}". Tek sütun, etiketler üstte. Varsayılan görünüm 4 blok: Sonuç, Not, özet satırı, düğmeler (+ varsa aşama satırı) [U-I1].

1. **Tamamlanacak iş** (yalnız `completableId` ya da açık iş varsa): bilgi satırı "Bu kayıt 'WhatsApp takibi · Per 13 Kas' işini tamamlar · [Değiştir]". Değiştir: diğer açık işler + "Yeni temas olarak kaydet". Vadesi gelecekte olan işler listede seçilebilir ama varsayılan değildir.
2. **Kanal:** bağlantıdan ya da tamamlanan plandan geliyorsa özet satırı "Kanal: WhatsApp · [Değiştir]". Değilse `radiogroup` (yerel radio, ok tuşları): Telefon "GSM araması" · WhatsApp "Mesaj ya da WhatsApp araması" · E-posta · Toplantı · Diğer [K-I6]. Tamamlanan plan Teklif hazırlama ya da Saha ziyaretiyse o tür 6. seçenektir. Önseçim `defaultType`.
3. **Sonuç** (`radiogroup`, 6 çip, sıklık sırası): kanalın varsayılanı seçili. Altında seçime göre değişen yardım satırı (§3.2), `aria-describedby` ile bağlı [U-B3].
   - Takip edilecek / Teklif gönderildi seçilince onay kutusu **"Müşteri cevap verdi"** (Telefon, Toplantı, Saha'da işaretli gelir).
4. **Görüşme notu** (textarea, 3 satır, isteğe bağlı). Yer tutucu: "Ör. Fiyat listesi istedi; ölçüleri hafta içinde gönderecek." Sayaç 3500 karakterden sonra.
5. **Zaman ve takip özeti** (tek satır): "Şimdi · Sonraki takip: WhatsApp takibi, Per 13 Kas 09:00 · [Değiştir]". Değiştir açar:
   - "Ne zaman": `datetime-local` (üst sınır şimdi, alt sınır 01.01.2024). Odaktan çıkınca: ileri saat → "İleri bir saat seçilemez." (hata, ikonlu); lead tarihinden önce → "Bu tarih lead'in oluşturulmasından önce. Doğruysa kaydedebilirsiniz." (bilgi).
   - "Sonraki takip planla" onay kutusu + tür + tarih-saat; varsayılan `defaults[type][outcome].next`. Olumsuz/Anlaşma ya da terminal aşamada kapalı gelir.
   - Kapalıyken açık aşamada: "⚠ Sonraki adım yok — lead 'Takipsiz' görünecek."
   - Aşama satırı Teklif (sabit) ya da Kazanıldı/Kaybedildi işaretliyse bölüm bilgi metnine döner: Teklifte "Teklif takibi otomatik planlanır: 3 gün sonra 09:00 arama."
6. **Müşteri durumu** (select): yalnız `canSetStatus` ve sonuç `statusOutcomes` içinde ya da "Müşteri cevap verdi" işaretliyken görünür; mevcut değerle gelir [U-B2]. "İlgisiz" seçilince (başka aşama satırı yoksa) işaretsiz "Aşamayı 'Kaybedildi' yap (neden sorulur)" satırı belirir.
7. **Aşama satırı** (`defaults[type][outcome].stage` moduna göre) [U-I2][U-I3]:
   - `fixed` (Teklif gönderildi, aşama Teklif'ten önce): onay kutusu yok, sabit metin "Kaydedince aşama 'Teklif gönderildi' olur." + satır içi "Teklif tutarı (isteğe bağlı)" ve para birimi (mevcut `ProposalDialog` kuralı).
   - `checked` / `unchecked` / `checked_if_replied`: onay kutusu "Aşamayı 'İletişim kuruldu' yap". `checked_if_replied` "Müşteri cevap verdi" ile birlikte işaretlenir.
   - Kazanıldı: "Aşamayı 'Kazanıldı' yap"; işaretlenince Tutar + para birimi zorunlu alanları aynı diyalogda açılır. Kaybedildi: işaretlenince "Kayıp nedeni" seçimi açılır. Doğrulama odaktan çıkınca, alanın altında.
   - Nitelikli hiç önerilmez.
8. **Havuz bilgisi** (yalnız `assignsOnSave`): düğmelerin üstünde "Kaydedince bu lead size atanır." [U-I8]
9. Düğmeler: [Vazgeç] [Kaydet]; Kaydet 44 px, sağda.

**Gönderim:** tek istek `POST /leads/:id/contacts` (temas, takip, durum, aşama birlikte). Sunucu önce aşamayı `ChangeLeadStage` ile değiştirir, sonra teması yazar, hata olursa aşamayı geri alır (§4.1). İstemcide sıra ya da ikinci diyalog yok.

**Bildirim** (`aria-live="polite"`, geri sayım yok; eylemli bildirimler en az 20 sn ya da kapatılana kadar durur, WCAG 2.2.1) [U-I7]: "Temas kaydedildi · Aşama: İletişim kuruldu · Takip: Per 13 Kas 09:00 · Lead size atandı [Geri al]". Geri al `POST /contact-logs/:id/undo` çağırır. Sonuç: "Temas kaydı geri alındı." ya da "Temas kaydı geri alındı. Aşama sonradan değiştiği için aşama geri alınmadı."

**Durumlar:**
- Yükleniyor: iskelet satırlar (son boyutta). Kaydediliyor: döner ikon + "Kaydediliyor…", düğme kilitli.
- Kaydet pasifken gerekçe altında yazılır: "Sonucu seçin", "Kazanıldı için tutar girin", "Kayıp nedenini seçin".
- Ağ hatası diyalog içinde `role="alert"`: "Kaydedilemedi. Bağlantınızı kontrol edip tekrar deneyin." Alanlar korunur.
- Sunucu kodları i18n'den: `err.contact.future`, `err.contact.too_old`, `err.contact.next_past`, `err.contact.activity_not_open` ("Bu aktivite zaten tamamlanmış; sayfayı yenileyin."), `err.contact.undo_expired` ("Geri alma süresi doldu (10 dk). Silmek için yöneticiye yazın."), `err.contact.proposal_stage_required`, `err.contact.stage_not_allowed`, `err.stage.*` (mevcut).
- Esc: değişiklik yoksa kapatır. Not yazılmışsa diyalog içinde `role="alertdialog"`: "Not kaydedilmedi. Kapatılsın mı? [Devam et] [Kapat]", odak "Devam et"te [U-M2].
- Hover yalnız `@media (hover:hover)`; `:focus-visible` halkası 3:1.
- 768 px altında tam yükseklikte sayfa; yapışkan alt düğme şeridi, `padding-block-end: env(safe-area-inset-bottom)`.

Saat dilimi: bütün varsayılanlar sunucuda `timeZone` (Europe/Istanbul) ile hesaplanır; UI kural tekrar yazmaz [M-B1].

### 5.4 Lead listesi (`src/pipeline/list/LeadListPage.tsx`, `listColumns.ts`, `listFilter.ts`, `ColumnFilterPopover.tsx`, `csv.ts`)

- **Veri:** `GET /leads` (ortak filtre, pano görünürlüğü, üst sınır 2000; sınıra ulaşılırsa "İlk 2000 lead gösteriliyor" satırı). Başlık filtreleri, sıralama ve sayım istemcide.
- **Araç çubuğu** (yalnız bunlar) [U-I14]: başlık "Lead listesi · {n} lead"; arama kutusu (ad, telefon, e-posta, Excel No); hızlı çipler (Hiç ulaşılmamış, Sıcak, Takipsiz, yöneticide Uyarılı); "Sütunlar"; yöneticide "Excel'e aktar (CSV)" ve "Test lead'lerini göster"; "{n} filtre etkin · Filtreleri temizle". Sorumlu, ülke, kaynak, aşama filtreleri başlık menülerindedir.
- **Dönüş çubuğu** (`from=report` ya da `from=today`): "Rapordan açıldı: Mail atılan · 91 lead [Rapora dön]" [U-B1a].
- **Tablo:** `<table>` + `<caption>` "Lead listesi · {n} lead"; `<colgroup>` grupları; iki başlık satırı yapışkan; Lead tarihi + Ad soyad yapışkan (`inset-inline-start`); `.tbl-sheet` stilinde `overflow:hidden` yok; satır 44 px; sayılarda `tabular-nums`. Bütün satırlar 1000'e kadar tek sayfada (Ctrl+F çalışır), üstünde sayfalama (100/200/500) [U-I13]; gerekirse satırlarda `content-visibility: auto`.
- **Satır içi eylemler** (işlem yapabildiği satırlarda) [U-I12]: Ad'ın yanında 44 px "Temas kaydet" ikon düğmesi (`aria-label="Temas kaydet: {ad}"`); Müşteri durumu sütununda satır içi seçim (D1 izni; değişince kaydeder, bildirim + geri al); havuz satırında "Üstlen". Başka satır içi düzenleme yok.
- **Gruplar ve sütunlar** (▸ ile katlanır; katlıyken özet sütun):

| Grup | Sütun | Hücre | Başlık filtresi (URL anahtarı) |
|---|---|---|---|
| Lead & iletişim | Lead tarihi | "22.10.2026"; NEW lead'de yaş metni ("2 sa önce", 1 sa / 24 sa tonuyla) | Ay gruplu liste + özel aralık (`f_created`) |
| | Ad soyad | Lead sayfası bağlantısı | Metin içerir; Excel No da eşleşir (`f_name`) |
| | Excel No (gizli) | No | Metin (`f_excelNo`) |
| | Ülke | "Türkiye (TR)" | Çoklu (`country`, sunucu) |
| | Sorumlu | Ad / "Ortak havuz" (+ "Excel: Enes") | Çoklu: kişiler, Ben, Ortak havuz (`owner`, sunucu); Excel etiketi (`f_excelOwner`) |
| | Kaynak (gizli) | "Excel · Instagram" | Çoklu (`source`, sunucu) |
| | Telefon | Bağlantı → WhatsApp + kayıt çubuğu | Var / Yok (`f_phone`) |
| | E-posta | Bağlantı → mailto + kayıt çubuğu | Var / Yok (`f_email`) |
| Ulaşıldı mı? (özet: "Ulaşıldı / Hiç ulaşılmadı / Kayıt yok (eski)") | Mail | ✔ Evet / ✘ Hayır / "Kayıt yok (eski)" | Evet / Hayır / Eski kayıt (`f_mail`) |
| | WhatsApp | Aynı | `f_wa` |
| | Diğer kanal | "✔ Telefon 2 · Toplantı 1" / ✘ | Evet / Hayır (`f_other`) [K-I5][U-B1c] |
| Dönüş + tarih | Mail dönüşü | "✔ 24.10" (≈ tahmini) / — | Evet / Hayır (`f_mailReply`) |
| | WhatsApp dönüşü | Aynı | `f_waReply` |
| | Diğer dönüş | Aynı | `f_otherReply` |
| Müşteri | Müşteri durumu | Etiket (ikon + metin) / "Durum girilmedi"; yetkiliye satır içi seçim | Çoklu, `none` dahil (`f_status`) |
| | Aşama | StageTag | Çoklu (`stage`, sunucu) |
| Teklif | Teklif verildi | "✔ 28.10" / ✘ | Evet / Hayır (`f_proposal`) |
| Ürünler (özet: "2 Panoramic · Kapatma 200 m²") | Standard / Panoramic / Full Panoramic | Adet / — | Evet / Hayır (`f_standard`, `f_panoramic`, `f_fullPanoramic`) |
| | Kapatma | "20 × 10 m · 200 m²" / "✔ ölçü yok" / — [K-M9] | `f_roof` |
| Takip | Son temas | "05.11 · 3 g önce" / "Hiç" / "Kayıt yok (eski)" [U-M6] | Ay gruplu liste + "Hiç ulaşılmadı" + "Eski kayıt" (`f_last`) |
| | İlk temas | Tarih | Aralık (`f_first`) |
| | Temas sayısı | n | 0 / 1+ / 3+ (`f_count`) |
| | Sonraki adım | "Telefon · yarın 09:00" / "Takipsiz"; terminal aşamada "—" [U-M7] | Var / Yok (`f_next`) |
| | Not | İlk 40 karakter; odak ya da tıklamayla açılır | Metin içerir (`f_note`) |
| Form cevapları (özet: "3 ay içinde · Tam kapalı") | Kurulum yeri / Kurulum zamanı / Müşteri profili / Kort sayısı / Platform / Kampanya | Etiket | Çoklu (`f_site`, `f_timeline`, `f_profile`, `f_band`, `f_surface`); Kampanya değer listesi, tam eşleşme (`campaign`, sunucu) |
| Kontrol (yalnız yönetici) | Uyarılar | "⚠ 2" (liste odakta açılır) / — | Var / Yok / kod (`f_warn`) |

- ✘ soluk gösterilir, ✔ öne çıkar (Excel'deki gibi) [U-M7]. Her ✔/✘ ikonun yanında gizli metin vardır.
- **Başlık menüsü** (Excel otomatik filtresi) [U-I11]: her `<th>` içinde tek ▾ düğmesi (44×44 vuruş alanı, `aria-haspopup="dialog"`, `aria-expanded`; filtreliyse nokta + "(filtreli)" metni). Menü: "A→Z sırala / Z→A sırala"; sayılı değer listesi ("✔ Evet (91)", "✘ Hayır (69)", "Tümünü seç"; 8'den çok değerde arama kutusu); tarihlerde ay gruplu liste + "Özel aralık"; "Uygula / Temizle". Odaklı başlıkta Alt+↓ açar. `popover` özelliği ya da `dialog.show()` + kendi Esc işleyicisi (modal olmayan dialog Esc'le kendiliğinden kapanmaz); dış tıklama kapatır, odak düğmeye döner. `aria-sort` başlıkta.
- Sıralama varsayılan `-createdAt`; ikincil sıra her zaman createdAt azalan (kararlı).
- Durum URL'de: `#/list?…&sort=-lastAt&size=200`. Grup aç/kapa `unixcrm.v2.listColumns`'ta hatırlanır.
- Bütün tarih filtreleri `/reference.timeZone` takvim günüyle çalışır (`Intl.DateTimeFormat('en-CA', {timeZone})`) [U-M9][M-M8].
- **Excel'e aktar (CSV)** (yalnız yönetici; diğerlerinde düğme yok): görünen satırlar, açık grupların bütün sütunları; UTF-8 BOM, `;` ayraç, CRLF, çift tırnak kaçışı; `= + - @`, sekme ya da CR ile başlayan hücreye `'` öneki; tarih dd.mm.yyyy (İstanbul); ulaşım ve ürün sütunlarında ✔/✘, dönüş ve teklifte Evet/Hayır (Excel'in sembolleri) [K-M9]; dosya adı `satis-takip-2026-11-10.csv`.
- **Mobil (< 768 px):** varsayılan gruplar Lead (yalnız ad), Ulaşıldı, Takip (son temas, sonraki adım). Yatay kaydırma tablo kabında, sayfada değil.
- **Durumlar:** 8 iskelet satır. Boş: "Bu filtrelerle eşleşen lead yok. [Filtreleri temizle]". Hata: "Lead listesi yüklenemedi. [Tekrar dene]".

### 5.5 Özet rapor (`src/pipeline/report/SummaryReport.tsx`, `drillDown.ts`, `ReportsPage.tsx` sekmeleri)

- **Kapsam çipleri** [U-I16]: "Tüm lead'ler ({all}) · Excel listesi ({excel})" (`scope=excel`); son seçim hatırlanır. Excel listesi seçiliyken kapsam satırında "Excel ÖZET RAPOR ile aynı kapsam".
- **Filtre satırı** (etiketler üstte): Lead tarihi (Tümü · Bu ay · Son 30 gün · Özel aralık), Kaynak, Kampanya (`campaigns`, tam eşleşme), yöneticide Sorumlu.
- **Kapsam satırı:** "Kapsam: 160 lead · İlk lead 22.10.2026 · Son lead 09.11.2026 · Rapor tarihi 10.11.2026". Satışçıda ayrıca "Sizin lead'leriniz ve ortak havuz."
- **İpucu satırı:** "Bir sayıya tıklayın: o lead'ler listede açılır." [U-I17]
- **§1 Temel göstergeler:** 7 kutucuk (auto-fit, en az 144 px, sabit yükseklik). Değer + "%56,9 · toplamın". Etiketler: Toplam lead, Mail atılan, WhatsApp'tan aranan, Hiç ulaşılmamış, Dönüş alınan (tüm kanallar), Teklif verilen, Alıcı müşteri. `legacyNoContact` > 0 ise not: "{n} lead'in temas geçmişi bilinmiyor (eski kayıt); 'Hiç ulaşılmamış'a sayılmadı. [Listeyi aç]".
- **§2 Satış temsilcisi performansı:** satırlar §3.3.7 (ada göre sıralı, havuz en sonda; havuz satırı ▸ ile "Excel'deki sorumlu" alt satırlarına açılır). Sütunlar: Lead (satır içi orantılı çubuk, `aria-hidden`) · Mail · WhatsApp · Hiç (> 0 ise ⚠ + sayı) · Kayıt yok (eski) (yalnız > 0 ise) · Dönüş · Teklif · Alıcı · Ulaşma · Dönüş oranı · Teklif oranı · TOPLAM satırı · tanım notu (§1.3). Havuz satırının dipnotu: "Excel'deki ATANMADI ve eşlenemeyen sorumlular" [U-I9].
- **§3 Müşteri durumu — sorumlu bazında:** aynı satırlar; 5 durum + Durum girilmedi + Toplam; sıfır olmayan hücre kalın.
- **§4 Ürün tercihleri:** 4 satır × 5 sütun; "Tercih eden"de orantılı çubuk. Altında: "Kapatma potansiyeli: formda 'Tam kapalı / çatılı kort' seçen 52 lead".
- **§5 Kurulum zamanına göre takip (sıcak lead'ler bekletiliyor mu?):** 4 satır (+ Belirtilmemiş > 0 ise). Yalnız "3 ay içinde" satır başlığında alev ikonu + "Sıcak". Hiç > 0 ise satırda uyarı etiketi: "3 ay içinde kurulum planlayan 21 lead'e hiç ulaşılmadı".
- **Sayılar:** sağa yaslı; `Intl.NumberFormat('tr-TR', {style:'percent', maximumFractionDigits:1})` → "%56,9"; null → "–" (`aria-label="hesaplanamaz"`).
- **Detaya iniş** [U-B1a][U-I17]: yalnız sıfır olmayan sayılar bağlantıdır; noktalı alt çizgi, hover/odakta düz (renk tek başına değil). `drillDownHref(bölüm, satır, sütun, raporFiltresi)` saf fonksiyondur ve **tam, açık durum** yazar: `#/list?from=report&…`.
  - Rapor filtreleri: `scope=excel`, `source=`, `campaign=` (tam), `f_created=from..to`, `owner=`.
  - Mail → `f_mail=yes`; WhatsApp → `f_wa=yes`; Hiç → `contact=never`; Eski kayıt → `contact=legacy`; Dönüş → `contact=replied`; Teklif → `f_proposal=yes`; Alıcı → `f_status=buyer_ready`.
  - Sahip satırı → `owner=<id>` ya da `owner=pool` (+ alt satırda `f_excelOwner=<etiket>`). Durum hücresi → `f_status=<kod>` ya da `none`. Zaman satırı → `f_timeline=<kod>` ya da `none`. Ürün → `f_<ürün>=yes` (+ `f_proposal=yes` / `f_status=buyer_ready`). Kapatma potansiyeli → `f_site=covered_court`.
  - Test: her rapor hücresi için `listFilter(fixture, parse(href)).length === hücre`.
- §2 (12 sütun) ve §3 tabloları taşma kabında, mobilde yapışkan ilk sütunla.
- "Excel'e aktar (CSV)": bütün bölümler, yalnız sayılar; raporu gören herkes indirebilir. Aşama raporundaki düğme de aynı adı alır.
- **Durumlar:** iskelet kutucuk ve tablolar (son boyutta). Boş: "Seçilen aralıkta lead yok." Hata: "Rapor yüklenemedi. [Tekrar dene]".

### 5.6 Bugün (`ActivitiesPage.tsx`, `src/pipeline/contact/ContactHistory.tsx`)

- **Yapılacaklar:**
  - Gecikmiş / Bugün / Yaklaşan (mevcut). Tür çipleri sıklık sırasıyla; Teklif hazırlama ve Saha ziyareti çipleri sayıları 0 iken gizli [U-M10].
  - Şerit yalnız `hotUncontacted` > 0 iken (ikon + metin): "3 ay içinde kurulum planlayan {n} açık lead'e hiç ulaşılmadı. [Listeyi aç]" → `#/list?from=today&hot=1&contact=never` [K-I8][U-B1b].
  - Satırda son temas sonucu etiketi ve 44 px "Tamamla…" düğmesi (diyaloğu tamamlama modunda açar).
- **Temas geçmişi** (TEMAS GEÇMİŞİ karşılığı) [K-M10]:
  - Filtreler: Aralık (Bugün · Bu hafta · Son 30 gün · Tümü · Özel aralık), Kanal, Sonuç, Sorumlu (lead sahibi; yöneticide), Kaydeden, lead adı araması, not araması.
  - Satır: tarih-saat (≈ tahmini) · lead bağlantısı · kanal ikonu + adı · sonuç etiketi · not (2 satır) · Kaydeden · Sonraki takip.
  - 200 satırdan sonra "Daha eski temaslar" (anahtar kümesi). Boş: "Bu aralıkta kayıtlı temas yok. Bir lead'de 'Temas kaydet' ile ilk teması ekleyin."

### 5.7 Yeni lead (`NewLeadDialog.tsx`)

- **Herkes için, tek sütun:** Ad soyad*, E-posta, Telefon ("En az biri gerekli" satır içinde, odaktan çıkınca), Ülke, Firma, Kaynak (Manuel), Not, Müşteri durumu (isteğe bağlı).
- **Yöneticide ek:** Sorumlu (varsayılan "Otomatik (ülke kuralına göre)" → `assignedUserId` gönderilmez; "Ortak havuz" → null; kullanıcılar). Katlı "Ek bilgiler (isteğe bağlı)": Ürün tercihleri düzenleyicisi, Form cevapları seçimleri, Beklenen kapanış.
- Satışçıda kort sayısı, model ve kapanış alanları **kalkar**; sunucu kuralıyla aynı.

### 5.8 Bölge eşleşmesi (admin) — 7b "Bölgeler" sekmesi

7g'de ekran yok; kurallar içe aktarma betiğiyle tohumlanır. 7b AdminPage'e eklenecek sekmenin tasarımı (`docs/faz7-is-emri.md` 7b'ye S1'de not düşülür):
- Tablo: Ülke ("Fransa (FR)") · Sorumlu (aktif satış seçimi) · Yedek · Lead (toplam / havuz) · [Kaldır].
- Pasif kullanıcıya bağlı kural ikon + "Pasif kullanıcı" etiketiyle.
- İkinci liste "Lead'i olup kuralı olmayan ülkeler", satırda "Kural ekle".
- "Havuza uygula" önce kuru çalıştırma sonucunu diyalogda gösterir ("Ahlem: 12, Yusa Bedir: 6, …"), onaydan sonra uygular.
- API (sales-pipeline): `GET/PUT/DELETE /territories[/:cc]`, `POST /territories/apply-to-pool {dryRun}`.

### 5.9 Ortak kurallar ve erişilebilirlik

- 8 pt ızgara (8/16/24/32); mantıksal CSS özellikleri; mevcut tema belirteçleri; metin 4.5:1, UI 3:1.
- Yeni belirteç `--hit: 44px`; bir araç çubuğundaki bütün çipler (mevcut 32 px "Takipsiz" çipi dahil), listedeki ▾ düğmeleri ve lead sayfasındaki küçük "Düzenle" düğmeleri bu yüksekliği kullanır [U-M1].
- Hiçbir anlam yalnız renkle verilmez: ✔/✘ ikon + gizli metin, sıcaklık ikon + etiket, uyarı ikon + metin, bağlantılı sayı alt çizgiyle.
- Her etkileşimli bileşende varsayılan, hover (`@media (hover:hover)`), focus-visible, active, disabled (gerekçe metniyle), loading (iskelet), empty ve error durumları.
- İskeletler son boyuttadır (CLS yok). `prefers-reduced-motion` uyulur; geçişler 150–300 ms.
- Diyalog ve menüler yerel `<dialog>` / `popover`; Esc kapatır, odak geri döner.
- Klavyeyle uçtan uca senaryo: Lead listesi → başlık filtresi (Alt+↓) → lead → Temas kaydet → Kaydet → Geri al.

### 5.10 i18n (`src/i18n/`, TR/EN)

Yeni metinler özellik dosyalarındadır ve sözlüğe yayılır (paralel adımlar çakışmasın) [M-adımlar]: `src/i18n/contact.ts` (S8: `activity.outcome.*`, `contact.*`, `err.contact.*`, `customerStatus.*`, `product.*`, `err.product.*`, `answer.*`, `surface.*`, `warning.*`, `importIssue.*`, `today.tab.*`, `today.hot*`), `src/i18n/list.ts` ve `src/i18n/report.ts` (S9: `nav.list`, `list.*`, `board.quick.*`, `reports.tab.*`, `reports.summary.*`, `common.pool`). `index.tsx` yalnız yayma satırı alır. S1'de: `activity.type.whatsapp/other`, `activity.type.call` TR "Telefon", `activity.type.proposal_sent` TR "Teklif hazırlama". Platform etiketleri yalnız burada durur. `tests/i18n-errors.test.ts`: `src/modules` içindeki her `new RuleError("…")` kodu için `err.<kod>` anahtarı var mı [M-M16].

---

## 6. İçe aktarma: `npm run db:import-excel -- <dosya.xlsx> [--dry-run] [--owners owners.json] [--apply-to-pool] [--no-seed-follow-ups] [--verify]`

### 6.1 Yapı

- `scripts/import-excel.ts`: CLI. `exceljs@4.4.0` sabit sürüm, devDependency, yalnız bu betikte import edilir. Hücrelerden düz bir `ExcelSnapshot` üretir: sütunları 2. satırdaki **başlık metniyle** bulur, 36 başlıktan biri eksikse durur. B/K/M ve TEMAS tarihleri Date, F/G `cell.text`, formüllerin önbellek değeri alınır.
- `src/bootstrap/importExcel.ts` (saf plan + uygulayıcı): `planExcelImport(snapshot, lookups) → ImportPlan`; `applyExcelImport(db, plan)` gerçek komutları kullanır (CreateLead, ChangeLeadStage, AssignLead, aktivite deposu). FixedClock satır tarihinde, `enabledProviders: () => []`, `undoWindowMs: 0`, aktör `{userId: "import", isAdmin: true}`. `importMysql.ts` deseni izlenir.
- **Kuru çalıştırma ve doğrulama yazmaz** [M-I11]: `openDatabase(config, {migrate: false})` eklenir; şema sürümü 12'den küçükse betik durur ("Önce sunucuyu başlatıp migration'ları uygulayın."). PGlite'ta `--dry-run`, `pgliteDir`'in geçici bir kopyası üzerinde gerçek `applyExcelImport`'u çalıştırır, raporu basar ve kopyayı siler (rapor gerçek koşuyla birebir). Postgres'te `--dry-run` yalnız planı ve raporu üretir. `--verify` salt okur.
- PGlite kullanılırken (`DATABASE_URL` yok) sunucu portu dinleniyorsa betik durur: "Sunucu çalışıyor; içe aktarmadan önce durdurun (PGlite tek süreç)."
- Kişisel veri yazdırılmaz: çıktıda yalnız sayılar, lead id'leri, Excel No, ekip adları, KullaniciID'ler ve kod adları. Python ön dönüştürme ya da JSON ara dosyası yok. `.xlsx` depoya girmez (`.gitignore` kontrol edilir).
- **Sıra (runbook)** [K-M15]: Meta intake canlıya alınmadan önce ya da sonra çalıştırılabilir; intake `adoptImportLead` ile aynı kişinin Excel lead'ini benimser, ikinci lead açmaz (§4.1). Yine de geriye dönük doldurma (backfill) içe aktarmadan sonra çalıştırılır.

### 6.2 Sorumlu ve bölge (D7)

- Ekip dizini KullaniciBilgileri'nden okunur (`authDb.listDirectory()`; id, ad, soyad, e-posta, yetki, durum).
- `--owners` dosyası etiket → KullaniciID ya da null: `{"Enes": "26", "Almanya Distribütörü": null}`. Verilen id aktif bir satış kullanıcısı değilse betik durur.
- E sütunu ve LİSTELER H/I aynı `matchTeamLabel` ile çözülür. Çözülmeyen etiket havuza düşer ve raporlanır. **Etiketin ad kısmı** (e-posta kısmı atılarak) her lead'de `extra_answers.excel_owner`'a yazılır; ATANMADI için yazılmaz [K-I4]. `--owners` ile yeniden çalıştırma bu etiketi kullanır.
- Bölge: 37 satırdan çözülenler `territory_rules`'a upsert edilir. Mevcut farklı kural değiştirilmez, "çakışma" olarak raporlanır. ATANMADI ve çözülmeyenler için satır yazılmaz.
- `--apply-to-pool`: kurallı ülkelerdeki açık havuz lead'leri `AssignLead` ile atanır; `excel_owner` etiketi ATANMADI dışında bir değer olan lead'ler atlanır (Excel onu başka birine vermiş) [K-M13]. Kuru çalıştırmada temsilci başına sayı. Ek bildirim gönderilmez.
- Bu adım S6'nın görünürlük kuralı yayındayken çalıştırılır.

### 6.3 Sütun eşleme

| Excel | CRM | Kural |
|---|---|---|
| A No | `extra_answers.excel_no` (metin); yeni lead'de `platformLeadId = excel:satis:<No>` | Yeniden çalıştırma anahtarı |
| B Lead Tarihi | `created_at` = B 09:00 İstanbul | Zenginleştirmede mevcut tarih korunur |
| C Ad Soyad | Yeni kişide `full_name` | Mevcut kişide değişmez |
| D Ülke | `parseExcelCountry("Türkiye (TR)") → "TR"` | Çözülmezse null |
| E Sorumlu | `assignedUserId` + `excel_owner` | §6.2. ATANMADI → null |
| F Telefon | E.164 | Okunamazsa (ör. "######") `invalidPhone: "drop"`, `phone_raw` saklanır. Telefon okunamıyor ve e-posta da geçersizse satır atlanır ve raporlanır (A6) [K-M14]. |
| G E-posta | email | — |
| H ✔ | Tamamlanmış `email` teması, `awaiting_reply`, B 09:00, `date_estimated` | legacy `excel:<No>:mail_sent`. TEMAS'ta aynı lead için e-posta satırı varsa oluşturulmaz. |
| I ✔ | Aynısı, `whatsapp` | legacy `excel:<No>:wa_sent`. TEMAS'ta WhatsApp satırı varsa oluşturulmaz. |
| J Evet (+K) | `email` teması, `reply_received`. Zaman: K geçerli (≥ 2024-01-01 ve ≥ B) ise K 09:00; değilse B **09:01** + `date_estimated` [K-I7] | legacy `excel:<No>:mail_reply`. TEMAS'ta aynı kanalda dönüş sonuçlu satır varsa oluşturulmaz [K-I10d]. K < B → `reply_before_lead`. |
| K dolu, J ≠ Evet | — | Yok sayılır, `k_without_j` yazılır. Gün/ay ters okunuşu B ile bugün arasındaysa kuru çalıştırma ipucu basar: "No n: K gün/ay ters girilmiş olabilir (11.09 → 09.11)". |
| L Evet (+M) / M dolu, L ≠ Evet | J/K ile aynı, `whatsapp` | legacy `excel:<No>:wa_reply`; `m_without_l` |
| N | `customer_status`; `fold` ile eşleme (Excel'de baş harfler büyük) [K-M8] | Bilinmeyen değer null + `status_unknown`, betik durmaz |
| O Evet | PROPOSAL aşaması (tutar null) | §6.5 |
| P/Q, R/S, T/U | `qty_*` | ✔ + adet → adet. ✔ adetsiz → 1 + `tick_without_qty`. Adet ✔'siz → adet (tercih sayılır) + `qty_without_tick`. |
| V, W, X | `roof_wanted`, ölçüler (> 0 ise) | W ya da X > 0 ise `roof_wanted = true`; V ✔ değilse `roof_dims_without_tick` [K-I3]. Y yok sayılır (türetilir). |
| Z, AA, AB | — | Türetilir, yok sayılır |
| AC | `notes` | Yalnız CRM notu boşsa |
| AD–AG | `install_site`, `install_timeline`, `customer_profile`, `court_count_band` | lead-intake `normalizeFormAnswers` ile. AG yalnız bant; `court_count` değişmez. |
| AH | `ad_surface`: Instagram → `ig`, Facebook → `fb` | Eşleme yalnız `src/bootstrap`'ta (kelime testi) |
| AI | `campaign_name` | Yalnız boşsa |
| AJ | `extra_answers.excel_warning` (ham metin) + `import_issues += excel_warning` + provenance | "… ülke telefon kodundan atandı" bütün biçimleri (boş, '90', 'Male', '98' öncesi; 13 + 4 = 17) → `country_source = "phone"`. `/Telefonda ülke kodu yoktu, \+(\d{1,4}) eklendi/` → `dial_code_assumed = "+<kod>"` (+90 ×4, +1 ×2) [K-M7]. Uyumsuzluk zaten hesaplanır. |
| TEMAS GEÇMİŞİ satırı | Tamamlanmış temas: kanal, sonuç, `result_note`, `done_by` = lead sorumlusu | legacy `excel:temas:<No>:<yyyymmdd>:<kanal>:<sonuç>:<sıra>`. Saat 12:00 İstanbul [K-I10c]. C boşsa B 12:00 + `date_estimated` (AB ile aynı sayım) [K-I10b]. |
| TEMAS "Sonraki Takip Tarihi" | Açık aktivite (aynı kanal, 09:00, legacy `…:next`) | Yalnız lead'in **en son** TEMAS satırından (C, sonra satır sırası); tarih geçmişse de oluşturulur ve "Gecikmiş" görünür [K-I10a]. |
| (Takip tohumu) | `--seed-follow-ups` (varsayılan açık; soru 6) [U-I20] | Atanmış, açık ve açık aktivitesi olmayan her lead'e 1 takip: tür son temas kanalı (e-posta/WhatsApp) yoksa Telefon; konu `FOLLOW_UP_SUBJECTS`; sıra: sıcak ∧ hiç, hiç, sıcak, diğer; içinde eski lead tarihi önce; ertesi iş gününden başlayarak hafta içi 09:00, temsilci başına günde en çok 10. Havuz lead'ine yok. `auto_created = true`, legacy `excel:seed:<No>`. |

### 6.4 Eşleştirme ve zenginleştirme

1. `extra_answers->>'excel_no'` ya da `platform_lead_id` ile lead aranır. Bulunur ve kişinin e-postası ya da telefonu satırla aynıysa yeniden çalıştırmadır. Farklıysa "satır yeniden numaralanmış" olarak atlanır ve raporlanır.
2. Yoksa e-posta ve telefon **ayrı ayrı** aranır (normalize). İkisi farklı kişiye çıkarsa satır çakışmadır, atlanır (7d birleştirmeye kadar).
3. Tek kişi P bulunursa: P'nin açık lead'i varsa (en yeni) **zenginleştirilir**; yalnız kapalı lead'leri varsa P için yeni lead (`source: import`).
4. Hiçbiri yoksa yeni kişi + yeni lead (`source: import`).
5. Zenginleştirme: alanlar yalnız boşsa yazılır; dolu ve farklı değer değişmez, "çakışma" olarak listelenir; temaslar legacy id ile eklenir; aşama yalnız ileri gider; sahip aktif bir satış kullanıcısıysa korunur, boş ya da pasifse Excel sorumlusu atanır; `contact_history_unknown` olduğu gibi kalır (temas eklenince durum zaten "ulaşıldı" olur).

### 6.5 Aşama türetme (D10; otomatik LOST/WON yok)

- Teklif olgusu (O = Evet ya da TEMAS "Teklif Gönderildi") → **PROPOSAL** (tutar null). Olay zamanı teklif teması ya da B 09:00. `skipFollowUp` = olay + 3 gün < şimdi.
- Değilse dönüş olgusu (J/L = Evet ya da dönüş sonuçlu TEMAS satırı) → **CONTACTED**; zaman ilk dönüş. Soru 5'e "evet" denirse herhangi bir temas (H/I ✔ dahil) yeterlidir (`CONTACT_RULES.contactedOnOutbound` ile aynı karar).
- Değilse **NEW**. N tek başına aşama üretmez [K-I1 A8].
- QUALIFIED otomatik olmaz (3 cevap gerekir).
- "Anlaşma Sağlandı" ya da "Alıcı - Proje Hazır" → WON yok (tutar gerekir); raporda "Kazanıldı adayı". "İlgisiz" ya da "Olumsuz" → LOST yok (neden bilinmiyor); "Kaybedildi adayı", `status_stage_conflict` bilgisi görünür.
- `source: import` lead'leri reklam platformuna dönüşüm göndermez (dağıtıcı `manual_source`). Zenginleştirilen başka kaynaklı lead de platform kapalı aktörle taşınır.

### 6.6 Yeniden çalıştırma

İdempotenttir. Lead `excel_no` ile, temaslar ve takip tohumları legacy id ile bulunur. Alanlar yalnız boşsa yazılır, aşama yalnız ileri gider, takip tohumu yalnız açık aktivitesi olmayan lead'e eklenir. İkinci çalıştırma "değişiklik yok" der. Excel'de sonradan ✔ olan satır yeni temas ekler; aynı teması ekip CRM'de de kaydettiyse iki kayıt olur (raporda not). Excel'de aşama gerilemesi yok sayılır ve raporlanır.

### 6.7 Kuru çalıştırma raporu (örnek; sayılar çalıştırma anındaki veriye göre değişir)

```
Excel: SATIŞ TAKİP 160 satır · TEMAS GEÇMİŞİ 0 satır · LİSTELER bölge 37 satır
Sorumlu: Yusa Bedir → 32 (44) · Simon Sharpe → 28 (31) · Ahlem → 47 (22) · Salah → 46 (11)
  Çözülemedi → ortak havuz, etiket saklanır: Enes 24 (satis@ 2 aktif kullanıcıda: 26, 51) · Faruk 8 (tabloda yok)
  · ATANMADI 7 · Mehmet 6 (tabloda yok) · Beyza 4 (yalnız pasif kullanıcı 45) · Almanya Distribütörü 3 (dış ortak)
Bölge kuralı: 15 yazılacak (PL TR GB IE BE DZ FR PT GR ES IN MK SK SI TZ) · 22 yazılmayacak · 0 çakışma
Lead: 159 yeni · 1 zenginleştirilecek (lead <id>, Excel No <n>) · 0 kişi çakışması · 0 yeniden numaralanmış · 0 kimliksiz
Aşama (yeni lead'ler): PROPOSAL 0 · CONTACTED = dönüşlü satırlar (dosyada 2; zenginleştirilen satır bunlardansa 1) · NEW kalanlar
Temas: e-posta gönderimi 91 (tahmini) · WhatsApp gönderimi 0 · e-posta dönüşü 1 (tahmini) · WhatsApp dönüşü 1 (tahmini)
Alan: müşteri durumu 1 · ürün 1 (Standard 2; ✔ yok → tercih sayıldı) · form cevabı 160×4 · platform 160 · kampanya 160
İçe aktarma sorunu: excel_warning 37 · k_without_j 1 (No <n>; gün/ay ters olabilir) · qty_without_tick 1
  → import_review uyarısı alacak lead: <n> (bir lead birden çok sorunla bir kez sayılır)
Telefon: 1 okunamadı (kaydedilmedi; e-posta geçerli)
Hesaplanacak uyarı: phone_country_mismatch 12 · phone_unreadable 1 · country_from_phone 17 (bilgi) · dial_code_assumed 6 (bilgi)
Takip tohumu: Yusa Bedir 44 (5 iş günü) · Simon Sharpe 31 · Ahlem 22 · Salah 11 · havuz 52 (takip yok)
Takipsiz kalacak açık lead: 52 (havuz) [--no-seed-follow-ups ile 160]
```

### 6.8 Kabul: CRM Özet rapor = Excel ÖZET RAPOR (D8)

**`--verify` (salt okunur; kurala dayalı)** [K-I1]:
1. **Formül sağlaması:** ÖZET sayıları SATIŞ TAKİP hücrelerinden Excel formülleriyle yeniden hesaplanır (`excelSummary(snapshot)`, saf) ve dosyadaki önbellek değerleriyle karşılaştırılır. Rapor tarihi (G3 = TODAY) karşılaştırılmaz [K-M12]. Fark → çıkış 2 (formül çevirisi hatası).
2. **Satır olguları:** her satır için `excelFacts(row)` (Excel tanımı: mail = H ✔, wa = I ✔, hiç = H ≠ ✔ ∧ I ≠ ✔, dönüş = J ∨ L Evet, teklif = O Evet, alıcı = N, ürünler, zaman, sorumlu etiketi) ve `expectedCrmFacts(row, plan)` (içe aktarma kurallarının saf sonucu; zenginleştirilen lead'de CRM'deki olgular) hesaplanır. Her olgu farkı bir gerekçe koduna (A1–A9) bağlanmalıdır; gerekçesiz fark → ✘.
3. **CRM sağlaması:** gerçek DB'de `excel_no` kümesi üzerinde `buildTrackingReport` ile, beklenen olgulardan hesaplanan rapor hücre hücre eşit olmalıdır.
4. Çıktı: her hücre için Excel | CRM | fark | gerekçe kodları (adet). Tek ✘ → çıkış 1.
5. Ekranda: yönetici → Raporlar → Özet rapor → kapsam "Excel listesi". Sayılar `--verify` çıktısının CRM sütunuyla aynı olmalı. Kampanya = "MDM - Potansiyel Müşteriler Kampanyası" süzgeci de aynı sayıları verir (bugün başka meta_form lead'i yok; canlıdan sonra aynı kampanyanın yeni lead'leri bu süzgece eklenir, Excel listesi kapsamına eklenmez).

**İzinli farklar (başka fark kabul edilmez):**
- **A1 — gönderim işaretsiz dönüş:** J/L = Evet ∧ aynı kanalın H/I ≠ ✔ → CRM'de o kanalın teması vardır: gönderim sayımı +1; iki işaret de yoksa Hiç −1. Excel'in Dönüş oranı payı "Hiç" satırlarını içerebilir, CRM'inki içeremez. Dosyada 1 satır: L = Evet, I = ✘, H ✔ → WhatsApp'tan aranan +1, havuz satırında +1; Hiç değişmez.
- **A2 — adet/tik:** adet var ✔ yok → Tercih eden +1 (dosyada Standard 0 → 1). ✔ var adet yok → adet 1 → Toplam adet +1 (dosyada yok).
- **A3 — havuz:** çözülmeyen etiketler + ATANMADI CRM'de "Ortak havuz" satırında toplanır; alt satırlar (`excel_owner`) Excel'in satırlarıyla birebir aynıdır. Zenginleştirilen lead CRM sahibinin satırında sayılır.
- **A4 — zenginleştirilen lead:** CRM'de var olan her olgu (temaslar, aşama, teklif, durum, ürünler, kampanya, lead tarihi, sahip, eski kayıt işareti) Excel'den farklı olabilir; CRM değeri esastır. Örnek: CRM'de eski kayıt ve Excel satırında temas yoksa Hiç −1, Kayıt yok (eski) +1; İlk/Son lead tarihi kayabilir.
- **A5 — satır kümesi:** CRM aktif satış kullanıcılarını lead'i olmasa da gösterir, Excel LİSTELER'in sabit 10 satırını; eşleşen sahiplerde sayılar aynıdır. "Belirtilmemiş" zaman satırı yalnız > 0 ise çıkar (dosyada 0).
- **A6 — atlanan satırlar** (kişi çakışması, yeniden numaralanmış, kimliksiz) iki tarafta da dışarıda tutulur ve listelenir.
- **A7 — TEMAS GEÇMİŞİ satırları** (bugün boş): Telefon/Toplantı/Diğer satırı H/I ✘ lead'de → Hiç −1; E-posta/WhatsApp satırı H/I ✘ → Mail/WA +1; dönüş sonuçlu satır J/L ≠ Evet → Dönüş +1; "Teklif Gönderildi" O ≠ Evet → Teklif +1 (aşama da PROPOSAL).
- **A8 — gerekmez:** N tek başına aşama üretmez ve "Hiç" aşamaya bakmaz; fark oluşmaz.
- **A9 — ölçü var Kapatma ✔ yok:** Kapatma "Tercih eden" +1 (Toplam m² değişmez; Excel Y'yi zaten toplar).
- **Gösterim:** oranlar tek ondalık; "-" yerine "–".

**Beklenen sayılar** (varsayılan sorumlu eşlemesiyle; Enes, Beyza, Mehmet, Faruk, Almanya Distribütörü, ATANMADI → havuz; A4 `--verify` tarafından ayrıca uygulanır):

| §1 Gösterge | Excel | CRM |
|---|---|---|
| Toplam lead | 160 | 160 |
| Mail atılan | 91 (%56,9) | 91 (%56,9) |
| WhatsApp'tan aranan | 0 (%0) | **1 (%0,6) A1** |
| Hiç ulaşılmamış | 69 (%43,1) | 69 (%43,1) |
| Dönüş alınan | 2 (%1,3) | 2 (%1,3) |
| Teklif verilen | 0 | 0 |
| Alıcı müşteri | 0 | 0 |
| İlk / son lead tarihi | 22.10.2026 / 09.11.2026 | Aynı (A4 hariç) |

| §2 Sorumlu | Lead | Mail | WA | Hiç | Eski | Dönüş | Teklif | Alıcı | Ulaşma | Dönüş oranı | Teklif oranı |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Yusa Bedir | 44 | 23 | 0 | 21 | 0 | 0 | 0 | 0 | %52,3 | %0,0 | %0,0 |
| Simon Sharpe | 31 | 17 | 0 | 14 | 0 | 0 | 0 | 0 | %54,8 | %0,0 | %0,0 |
| Ahlem | 22 | 11 | 0 | 11 | 0 | 1 | 0 | 0 | %50,0 | %9,1 | %0,0 |
| Salah | 11 | 6 | 0 | 5 | 0 | 0 | 0 | 0 | %54,5 | %0,0 | %0,0 |
| Diğer aktif satış kullanıcıları (her biri; A5) | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | – | – | – |
| Ortak havuz (A3; alt satırlar Enes 24 · Faruk 8 · ATANMADI 7 · Mehmet 6 · Beyza 4 · Almanya Distribütörü 3, Excel satırlarıyla aynı; A1 Enes satırında) | 52 | 34 | 1 (A1) | 18 | 0 | 1 | 0 | 0 | %65,4 | %2,9 | %0,0 |
| TOPLAM | 160 | 91 | 1 (Excel 0) | 69 | 0 | 2 | 0 | 0 | %56,9 | %2,2 | %0,0 |

Enes bir kullanıcıya eşlenirse (soru 2): Enes 24/16/1/8/1, havuz 28/18/0/10/0.

- **§3:** İlgili 1 (Enes'in satırı; varsayılanla havuzun Enes alt satırında), Durum girilmedi 159, Toplam 160; diğer sütunlar 0.
- **§4:** Standard tercih eden 0 → **1 (A2)**, teklif içinde 0, % "–", alıcı içinde 0, toplam adet 2. Panoramic, Full Panoramic, Kapatma hepsi 0 / 0 / – / 0 / 0. Kapatma m² 0. Kapatma potansiyeli 52.
- **§5:**

| Zaman | Lead | Hiç | Eski | Dönüş | Teklif | Ulaşılmama |
|---|---|---|---|---|---|---|
| 3 ay içinde | 47 | 21 | 0 | 1 | 0 | %44,7 |
| 3-6 ay | 58 | 29 | 0 | 1 | 0 | %50,0 |
| 6-12 ay | 21 | 4 | 0 | 0 | 0 | %19,0 |
| Şimdilik araştırıyor | 34 | 15 | 0 | 0 | 0 | %44,1 |

Excel'in önbellek değerleri: §1 B7..H7 = 160/91/0/69/2/0/0. §2 TOPLAM oranları J22 = 0,56875, K22 = 0,02198. §5 G51..G54 = 0,4468 / 0,5 / 0,1905 / 0,4412. Kapatma potansiyeli C46 = 52. Standard toplam adet G42 = 2.

---

## 7. Uygulama adımları

Genel kurallar:
- Her adım `npm run verify` yeşil bırakır ve kendi testlerini **yeni dosyalara** yazar (mevcut test dosyalarında yalnız kurucu güncellemesi).
- Adımlar sıra numarasıyla birleştirilir. Paralel çalışabilecekler "Paralel" satırında yazılıdır; paralel adımların dosyaları ayrıktır. Ortak dosyalara (`ports.ts`, `fakes.ts`, `dto.ts`, `router.ts`, `i18n/index.tsx`) yalnız **ekleme** yapılır.
- Kişisel veri log'a ve çıktıya yazılmaz. Platform adı yasaklı modüllere girmez.

**S1 — Veri modeli, kalıcılık, görünürlük yardımcısı, test altyapısı**
- *Amaç:* migration 0012; yeni alanların tipleri ve kalıcılığı; davranışı değiştirmeyen görünürlük yardımcısı; UI testlerinin çalışması.
- *Dosyalar:*
  - `db/migrations/0012_faz7g_satis_takip.sql` (§3.1).
  - domain (yalnız tipler, sabitler ve küçük saf yardımcılar): `activity.ts` (§3.3.1), `lead.ts` (§3.3.6 alanları), `products.ts` (tipler, `EMPTY_PRODUCTS`, `courtTotal`, `roofAreaM2`, `hasAnyProduct`, `productSummary`), `leadProfile.ts` (§3.3.4), `reports.ts` (`reachedStage` dışa açılır), `ports.ts` (yeni metot imzaları + `ContactLogRepository`), `index.ts`.
  - infrastructure: `rows.ts` (numeric → `Number()`), `repositories.ts` (yeni kolonlar, products açılımı, `list` çoklu değerli filtreler; `visibleTo` SQL'i değişmez), `activityRepository.ts` (yeni kolonların okunması/yazılması), `contactLogRepository.ts` (yeni).
  - application: `fakes.ts` (alanlar + sahte `ContactLogRepository`). Görünürlük yeniden düzenlenmez (§4.8).
  - Tür listesi kopyaları: `api/dto.ts` (`ActivityTypeDto`, `ActivityOutcomeDto`, ActivityDto/LeadDto yeni alanları), `src/pipeline/activityBits.tsx` (tür + ikon), `src/components/ui.tsx` (sohbet ikonu), i18n `activity.type.*` (§5.10).
  - `vitest.config.ts`: `include` += `"src/pipeline/**/*.test.ts"` [M-B1]. Bu yoldaki test edilen modüller React ve DOM içe aktarmaz.
  - `tests/types/dto-parity.test.ts` (§4.5) ve `tests/i18n-errors.test.ts` (§5.10).
  - Mevcut test kurucuları (`reports.test.ts lead()` vb.) varsayılan değerlerle güncellenir.
  - Belgeler: `docs/adr/0014-satis-takip-excel-uyumu.md` (D1–D11, §3.4, `contact_logs`, 0012 veri düzeltmelerinin geri alınamaz olduğu); ADR-0013 eki; `docs/faz7-is-emri.md` (Bitti tanımındaki "Migration `0012`" → "`0013`" ve "geri alınabilir" ifadesi 0013 için kalır; 7b'ye "Bölgeler" sekmesi notu §5.8; Faz 7 parça tablosuna 7g satırı ve bu belgeye bağlantı) [M-M7].
- *Testler:*
  - `migrate.test.ts`: aşamalı koşu (1–11, örnek satırlar, sonra 12) [M-M6]; sürüm listesi [1..12]; whatsapp kabul, 'sms' red; outcome `done_at` ister; `customer_replied` yalnız follow_up/proposal_sent; adet 1–29; ölçü roof ister; kod CHECK'leri; ad_surface deseni ve doldurma; FX → FR; `contact_history_unknown` doldurma (NEW olmayan ve MySQL kaynaklı lead'ler işaretlenir, tamamlanmış aktivitesi olan işaretlenmez); `contact_logs` silinince `activities.log_id` null olur.
  - `infrastructure` gidiş-dönüş (yeni dosya `infrastructure.7g.test.ts`): products numeric, aktivite kolonları, `contact_logs`, çoklu değerli `list` filtresi.
  - Mevcut görünürlük testleri değişmeden yeşil.
- *Kabul:* yerel PGlite kopyasında migration hatasız; lead ve aktivite sayısı değişmez; işaretlenen eski kayıt sayısı yazılır (beklenen ≈ 509). Mevcut ekranlar değişmeden çalışır.
- *Bağımlılık:* yok.

**S2 — Saf kurallar (domain)**
- *Amaç:* temas özeti, temas kuralları, ürün ayrıştırma, veri uyarıları, Özet rapor hesabı.
- *Dosyalar:* domain `contact.ts` (yeni, §3.3.2), `products.ts` (`parseProductPrefs`), `dataQuality.ts` (yeni, §3.3.5), `trackingReport.ts` (yeni, §3.3.7), `index.ts`; `src/modules/shared/normalization/phone.ts` (`valid`, `callingCode`).
- *Testler (yeni dosyalar):*
  - `contact.test.ts`: never/legacy/contacted; aşama never'ı etkilemez; yapışkan dönüş; `customer_replied`; kanal bazında ilk dönüş; tahmini işaretler; eşit zaman sıralaması (dönüş > teklif > diğer > tahmini olmayan > tür); `stageLine` bütün sonuç × aşama birleşimleri (`contactedOnOutbound` iki değeriyle); `suggestNext` (PROPOSAL hedefinde null, terminalde null, saat dilimi); `pickCompletable` (bugün sonu sınırı, aynı tür önceliği); `validateContact` sınırları.
  - `products.test.ts`, `leadProfile.test.ts`, `dataQuality.test.ts` (her kod; arama kodu karşılaştırması; `import_review`; import kaynaklı `country_missing` bilgi; `checked`; `visibleWarnings`).
  - `trackingReport.test.ts`: boş girdi (pay 0, oran null); §6.8 profilinde 160 sentetik lead → §1–§5 birebir; eski kayıt sütunu ve oranlar; havuz alt kırılımı; `teamIds` ile sabit satırlar; `isHotUncontacted`.
  - normalization testi (`valid`, `callingCode`).
- *Kabul:* domain kapsamı ≥ %90 (mevcut eşik).
- *Bağımlılık:* S1.

**S3 — Temas kaydı komutları ve API**
- *Amaç:* LogContact (aşama ve durum dahil tek istek), UndoLogContact, diyalog verisi, silme/yeniden açma kuralları, durum ve uyarı kontrol komutları.
- *Dosyalar:* application `contacts.ts` (yeni: LogContact, UndoLogContact, ContactForm), `leadStatus.ts` (yeni: SetCustomerStatus, CheckWarning, UncheckWarning), `activities.ts` (DeleteActivity, SetActivityDone kuralları), `undoStageChange.ts` + domain `undo.ts` (`changeId` → `undo.stale`), `permissions.ts` (`canUndoContact`, `canSetCustomerStatus`), `index.ts`; infrastructure `activityRepository.ts` (complete, reopen, removeCreatedByLog, removeOpenNextOfLog, `removeAutoCreatedByChange` + `done_at IS NULL`), `contactLogRepository.ts`, `repositories.ts` (setCustomerStatus, setCheckedWarnings); `fakes.ts`; api `contactRoutes.ts` (yeni: contact-form, contacts, contact-logs undo, customer-status, warnings check), `dto.contact.ts` (yeni), `router.ts` (bağlama + `/leads/:id/undo` gövdesinde `changeId`).
- *Testler:*
  - `application/contacts.test.ts`: yeni kayıt; plan tamamlama (tür değişimi ve geri almada geri yazılması); sonraki takip; `quick` varsayılanları (bugün vadeli aynı kanal planı tamamlanır, gelecek planı tamamlanmaz); havuzda otomatik atama + LeadAssigned; ileri tarih ve 2024 öncesi red; başkasının lead'i 403 `lead.forbidden` [M-M1]; `proposal_sent` sonucunda aşama zorunlu ve tek takip ("Teklif takibi"); izinsiz hedef red; aşama hatası → hiçbir şey yazılmaz; temas yazımı hata verirse aşama telafi edilir; durum aynı işlemde yazılır ve geri almada döner; 10 dk içinde geri al; süre sonrası satışçıya `contact.undo_expired`, admin'e serbest (aşama penceresi dışında `stageUndone: false`); aşama sonradan değiştiyse `undo.stale` → temas yine geri alınır; geri al tamamlananı açar, `next`'i siler; önceki kaydın sonraki takibi sonra başka kayıtla tamamlandıysa ilk kaydı geri almak onu silmez [M-B2a,b]; aşama geri alma tamamlanmış takibi korur; log'lu satırı yeniden açma `contact.reopen_logged`; tamamlanmış silme yalnız admin; durum izinleri (sahip, havuz + atama, diğer, admin); CheckWarning yalnız admin, idempotent.
  - `api/contacts.api.test.ts`: 201 şekli, görüntüleyici 403 `read_only`, 404, 422 kodları, contact-form şekli.
- *Kabul:* uçtan uca API: kaydet → geri al → başlangıç durumu (aktivite, durum, aşama). Mevcut aktivite ve aşama testleri yeşil.
- *Bağımlılık:* S2.

**S4 — Okuma modeli, Bugün, Temas geçmişi, Özet rapor sorgusu**
- *Amaç:* liste/pano izleme bilgileri ve ortak filtre; Bugün sıcak sayısı; Temas geçmişi sorgusu; Özet rapor; referans listeleri; ekip dizini portu (bağlantısı S6'da).
- *Dosyalar:* application `queries.ts` (tracking alanları, ortak filtre, lead detayında `contactLogs` ve `lastChange.contactLogId`), `contactQueries.ts` (yeni), `activities.ts` (`today` + `hotUncontacted`, `lastOutcome/lastType`), `reports.ts` (`tracking`), `types.ts` (`users?: UserDirectory`), `notifications.ts` (`UserDirectory` += `activeSalesUserIds(): Promise<string[] | null>`; yalnız arayüz), `index.ts`, `ports.ts`; infrastructure `activityRepository.ts` (`contactAggregatesByLeads`, `listDone`); `fakes.ts`; api `trackingRoutes.ts` (yeni: `/activities/history`, `/reports/tracking`), `router.ts` (`parseLeadFilter` ile `/board` ve `/leads`; `/reference` yeni listeleri), `dto.tracking.ts` (yeni).
- *Testler:*
  - `application/tracking.test.ts`: ortak filtre (`contact`, `hot`, `warning`, `scope`, `campaign`, çoklu owner/country/source) ve süzülmüş kümeden kolon istatistiği; uyarıların izleyene göre süzülmesi; kontrol edilmiş uyarının `warning=1`'den düşmesi; `hotUncontacted` = aynı aktör için `/leads?hot=1&contact=never` uzunluğu; geçmiş görünürlüğü (satışçı kendi + havuz); geçmiş anahtar kümesi aynı `done_at`'lı 30 satırda kayıpsız ve tekrarsız [M-I7]; rapor kapsamı (satışçı, admin, `scope=excel`, tarih İstanbul günü); `users` yokken rapor çalışır.
  - `infrastructure.tracking.test.ts`: SQL toplamı = `aggregateContacts`; ~600 lead ve 2000 aktivitede pano isteği başına sorgu sayısı 4.
  - `api/tracking.api.test.ts`: DTO şekli; geçersiz tarih aralığı 422.
- *Kabul:* yerelde `GET /board` (yaklaşık 511 lead) ölçüm betiğiyle 300 ms altında (birim testi eşiği değil) [M-adımlar]; `/reports/tracking` §4.5 şeklinde döner.
- *Bağımlılık:* S3 (`activities.ts`, `router.ts` sırası).

**S5 — Lead alanları, oluşturma kuralları, intake normalizasyonu**
- *Amaç:* ürün, form cevabı ve ülke düzenleme; yetki anahtarı; oluşturma kuralları; form cevaplarının otomatik dolması; Excel lead'inin benimsenmesi.
- *Dosyalar:* sales-pipeline domain `opportunity.ts` (§3.3.6), application `updateLeadFields.ts`, `createLead.ts` (yeni girdiler, `REP_CREATABLE_LEAD_FIELDS`, esnek mod, `invalidPhone`, `adoptImportLead`), `permissions.ts` (`repEditableLeadFields(policy)`), `types.ts` (`policy?`), `index.ts`; `src/modules/shared/kernel/config.ts` (`repsEditProducts` ← `REPS_EDIT_PRODUCTS`, varsayılan false; `.env.example`); infrastructure `repositories.ts` (`removeExtraAnswerKeys`, `FIELD_COLUMN`); `fakes.ts`; api `router.ts` (PATCH/POST yeni anahtarlar, `/reference.permissions`), `dto.ts`; `bootstrap/salesPipeline.ts` (policy bağlantısı); integration-settings `domain/mapping.ts`, `infrastructure/index.ts`; lead-intake `application/formAnswers.ts` (yeni), `buildLead.ts`, `dto.ts`, `createLeadFromAd.ts`, `adapters/meta/adapter.ts`, `adapters/web-form/adapter.ts`, `adapters/google/adapter.ts`.
- *Testler:*
  - `application/leadFields7g.test.ts`: ürün varken `courtCount` reddi; ürün temizlenince `court_count` korunur; satışçıya ürün/form alanı `admin_only` (policy kapalı) ve izin (policy açık; kendi ve havuz lead'i); ülke ve telefon değişince provenance ve kontrol temizliği (`country_raw` dahil); satışçı oluştururken fırsat alanı reddi; `adoptImportLead` (açık Excel lead'i benimsenir; kampanya farklıysa yeni lead; kapalı lead'de yeni lead).
  - `lead-intake/application/formAnswers.test.ts`: Excel etiketleri, API anahtarları, kort ayrıştırma tablosu, eşleşmeyenler.
  - `mapping.test.ts` (yeni hedefler), `meta.test.ts` (`adSurface`), `google.test.ts` (özel cevap `extra`'da), `intake.7g.test.ts` (bozuk telefon + geçerli e-posta → lead oluşur ve `phone_unreadable`; geçersiz kod → `failed` olmaz; Excel lead'i benimsenir).
- *Kabul:* örnek bir Meta webhook'u install_site, install_timeline ve bandı doldurur; bilinmeyen değer `unmatched_answers`'a yazılır.
- *Bağımlılık:* S4.

**S6 — Bölge, ekip dizini, bildirim**
- *Amaç:* D7 önkoşulları; ekip dizini bağlantısı (fail-open).
- *Dosyalar:* `createLead.ts` (`unavailable` ← `inactiveUserIds`, fail-open), `notifications.ts` (`UserDirectory` += `inactiveUserIds`; yalnız "Sıcak lead:" metni), `ports.ts` + `repositories.ts` + `fakes.ts` (`TerritoryRuleRepository.upsert`), `bootstrap/salesPipeline.ts` (`users` bağlantısı), `server/authDb.mjs` (`listDirectory`), `server/authDb.d.mts` (yeni), `server/index.mjs` (`/api/users?all=1`; `userDirectory.activeSalesUserIds/inactiveUserIds`, 5 dk önbellek, hata/kapalı DB → null), `src/bootstrap/teamMatch.ts` (yeni). Görünürlük (`visibility.ts`) ve atama bildirimi değişmez (§4.8).
- *Testler:*
  - `application/territory.test.ts`: kurallı ülkenin yeni lead'i kural sahibine atanır; pasif kural kullanıcısı → yedek/havuz; dizin null iken süzme yok; görünürlük bugünkü gibi (satışçı bütün havuzu görür).
  - `notifications.7g.test.ts`: "Sıcak lead:" metni; mevcut bildirim sayısı değişmez.
  - `src/bootstrap/teamMatch.test.ts`: tam e-posta; ortak posta kutusu (iki aktif) → ambiguous; yalnız pasif → inactive_only; Yusa/Yuşa katlama; ATANMADI; dış ortak.
- *Kabul:* 15 kural varken yeni TR form lead'i kural sahibine atanır; auth DB kapalıyken de atanır; satışçının gördüğü havuz değişmez.
- *Bağımlılık:* S5 (`createLead.ts` sırası).

**S7 — Excel içe aktarma ve `--verify`**
- *Amaç:* D10 ve D7 tohumlaması, takip tohumu, kabul aracı.
- *Dosyalar:* `package.json` (`exceljs@4.4.0` devDependency, `db:import-excel`), `scripts/import-excel.ts`, `src/bootstrap/excelSnapshot.ts` (yeni, tipler + başlık eşleme), `src/bootstrap/importExcel.ts` (yeni), `src/bootstrap/excelVerify.ts` (yeni), `src/bootstrap/importMysql.ts` (FX → FR, `contactHistoryUnknown = true`), `src/modules/shared/db/open.ts` (`{migrate: false}` seçeneği), `.gitignore` (`*.xlsx` yoksa eklenir), `docs/runbooks/excel-aktarimi.md` (sıra, yedek, kuru çalıştırma, doğrulama).
- *Testler:* `src/bootstrap/importExcel.test.ts` (PGlite + sentetik snapshot, kişisel veri yok):
  - yeni / zenginleştir / kişi çakışması / yeniden numaralanmış / kimliksiz satır;
  - aşama türetme (dönüş → CONTACTED, yalnız gönderim → NEW, `contactedOnOutbound` açıkken CONTACTED, teklif → PROPOSAL; otomatik LOST/WON yok; N tek başına aşama üretmez);
  - legacy id'ler, tahmini tarihler, gönderim 09:00 / dönüş 09:01 ve son temas sonucu "Dönüş alındı";
  - TEMAS satırı ile H/I ve J/L çakışmasının önlenmesi; yalnız son TEMAS satırından takip; tarihsiz TEMAS satırı;
  - ölçü var V yok → `roof_wanted` + sorun; AJ → provenance ve `import_issues`; N katlama ve bilinmeyen değer;
  - takip tohumu (sıra, günlük 10 sınırı, havuza yok, ikinci koşuda tekrar yok);
  - ikinci çalıştırmada 0 değişiklik; `--dry-run` sonrası gerçek DB satır sayıları değişmez; sürüm < 12 iken durur;
  - bölge upsert ve çakışma; `--apply-to-pool` (excel_owner etiketli lead atlanır; bildirim yok);
  - `parseExcelCountry`; `excelVerify`: sentetik sayfada izinli farklarla eşitlik ve bilinçli bozulmada çıkış 1; formül sağlamasında bozulma → çıkış 2.
- *Kabul:* gerçek dosyada `--dry-run` §6.7 biçiminde rapor basar (159 yeni, 1 zenginleştirme); çıktıda müşteri adı, telefon ya da e-posta yoktur.
- *Bağımlılık:* S6. *Paralel:* S8 ve S9 ile.

**S8 — Arayüz 1: Temas kaydet, lead sayfası, Bugün**
- *Dosyalar:* `src/pipeline/contact/LogContactDialog.tsx`, `ContactQuickBar.tsx`, `ContactHistory.tsx`, `useLogContact.ts`, `contactApi.ts`, `dialogState.ts` (saf), `contact.css` (hepsi yeni); `src/pipeline/ProductPrefsForm.tsx` (yeni); `src/pipeline/extraAnswersView.ts` (yeni, saf); `LeadPage.tsx`, `LeadFieldsForm.tsx` (ülke, form cevapları; kort/model girişleri kalkar), `ActivitiesPage.tsx`, `activityBits.tsx`, `StageDialogs.tsx` (`MoneyFields` ve kayıp nedeni alanları satır içi kullanım için dışa açılır; diyaloglar değişmez); `src/state/CrmContext.tsx` (eylemli bildirim ≥ 20 sn); `src/styles.css` (`--hit`, çip yüksekliği); `src/i18n/contact.ts` (yeni) + `index.tsx` yayma satırı.
- *Testler:* `src/pipeline/contact/dialogState.test.ts` (sonuç → görünen bloklar, aşama satırı modları, satır içi zorunlu alanlar, durum alanı görünürlüğü, Kaydet pasif gerekçeleri); `src/pipeline/extraAnswersView.test.ts` (nesne ve gizli anahtar işleme, etiketler).
- *Kabul (tarayıcıda, yerel PGlite):*
  - WhatsApp bağlantısı → çubuk → "Evet, kaydet" → bildirim → zaman çizelgesinde "Geri al" → geri alınır.
  - "Dönüş alındı" + İlgili + İletişim kuruldu tek Kaydet'le; Teklif gönderildi → aşama Teklif, tek takip araması; Kazanıldı tutarı satır içinde.
  - Yapılacaklar'da "Tamamla…" tamamlama modunu açar; Temas geçmişi sekmesi filtreleriyle listeler; şerit sayısı listeyle aynı.
  - Satışçıda ürün ve form alanları salt okunur, uyarı paneli yok, telefon uyarısı satır içinde. "[object Object]" görünmez.
  - Yalnız klavyeyle tam akış; not yazılıyken Esc onayı; 375 px'te yatay sayfa kaydırması yok; bildirim yapışkan çubuğun üstünde.
- *Bağımlılık:* S5 (S3 ve S4 API'leri). *Paralel:* S7, S9.

**S9 — Arayüz 2: Lead listesi, Pano, Özet rapor, Yeni lead**
- *Dosyalar:* `src/pipeline/list/LeadListPage.tsx`, `listColumns.ts`, `listFilter.ts`, `ColumnFilterPopover.tsx`, `csv.ts`, `listApi.ts`, `list.css` (hepsi yeni; `var(--hit, 44px)` kullanır); `src/pipeline/report/SummaryReport.tsx`, `drillDown.ts` (yeni); `ReportsPage.tsx` (sekmeler), `KanbanPage.tsx`, `boardFilter.ts`, `NewLeadDialog.tsx`, `InboxPage.tsx` (kaldırılır), `src/router.ts` (`list` rotası, `#/inbox` yönlendirmesi), `App.tsx`, `src/components/Header.tsx` (menü "Lead listesi", logo bağlantısı), `hooks.ts` (`useTeamNames` `?all=1` + pasif adlar, `ageTone(LeadListDto)`, `useLeadList`); `src/i18n/list.ts`, `src/i18n/report.ts` (yeni) + `index.tsx` yayma satırları.
- *Testler:* `src/pipeline/list/listFilter.test.ts` (her filtre türü, sayılı değer listesi, eski kayıt değeri, sıralama kararlılığı, URL gidiş-dönüş, İstanbul günü sınırı); `src/pipeline/boardFilter.test.ts` (birleştirme hatası düzeltmesi; `view`/`sort`/`size` filtre sayılmaz; `from` varken hatırlama yok); `src/pipeline/list/csv.test.ts` (BOM, `;`, kaçış, formül enjeksiyonu, ✔/✘ ve Evet/Hayır); `src/pipeline/report/drillDown.test.ts` (her rapor hücresi → liste satır sayısı eşitliği).
- *Kabul (tarayıcıda):* Lead listesi açılış sayfasıdır, Gelen kutusunun arama ve yaş bilgisini taşır; başlık menüleri Excel gibi çalışır (Alt+↓); panoda 4 satırlık kart, NEW → CONTACTED sürüklemede diyalog (S8'in diyaloğu birleştikten sonra bağlanır); satışçıda dışa aktarma ve Uyarılı yok; CSV Türkçe Excel'de doğru sütunlarla açılır.
- *Bağımlılık:* S5 (S4 API). *Paralel:* S7, S8 (pano sürükleme ve liste satırı "Temas kaydet" entegrasyonu S8 birleştikten sonra).

**S10 — Gerçek dosyayla kabul ve kapanış belgeleri**
- *Yapılacaklar:*
  - Yedek al; gerçek dosyada `--dry-run`, sonra gerçek koşu, sonra `--verify` (çıkış 0), sonra ikinci koşu ("değişiklik yok").
  - Ekranda (kapsam "Excel listesi"): Özet rapor §6.8 tablolarını gösterir ve `--verify` CRM sütunuyla aynıdır; "3 ay içinde · Hiç 21" hücresi 21 satır açar; Lead listesinde Mail = Hayır 69 satır verir (`scope=excel`) [K-M12]; Bugün şeridi sayısı açılan listeyle aynıdır.
  - Satışçı oturumunda: kendi lead'leri + görebildiği havuz; dışa aktarma yok; ürün alanları salt okunur (policy kapalı).
  - Belgeler: `docs/satis-takip-kabul-raporu.md`; README (Lead listesi, Temas kaydet, Özet rapor, `db:import-excel`); `docs/yol-haritasi.md` durumu; bu belgenin §8 cevapları işlenir.
- *Bağımlılık:* S7, S8, S9.

---

## 8. Açık sorular (kullanıcıya; varsayılan uygulanır)

1. **Ürün tercihlerini (kort adetleri, çatı ölçüsü) satışçı da girebilsin mi?** — **Cevap (2026-11-10): "Evet, sahibi girsin."** Uygulandı: `repsEditProducts` varsayılan açık; satışçı yalnız kendi lead'inde (havuzda önce üstlenir, `lead.products_owner_only`); oluştururken ürün yine yönetici. Excel'de satışçılar giriyordu; 7e kararıyla bunlar "fırsat alanı" ve yalnız yöneticinin.
   *Varsayılan:* yalnız yönetici (`REPS_EDIT_PRODUCTS` kapalı); satışçı müşterinin söylediğini temas notuna yazar. *Önerimiz:* evet, yalnız lead'in sahibi satışçı (çağrıda duyduğunu yöneticinin yeniden yazmasına gerek kalmaz); tutar, kapanış ve atama yönetici de kalır. "Evet" denirse tek ayar değişir.
2. **Kullanıcı tablosunda karşılığı olmayan sorumlular kim?** — **Kısmi cevap (2026-11-10): Enes → Amro Abdulvahit (51)**; `--owners` ile uygulandı, Enes'in 7 ülkesi 51'e kural olarak yazıldı. Beyza, Mehmet, Faruk ve Almanya Distribütörü: **havuzda kalır** (kullanıcı kararı, 2026-11-10); "Excel'deki sorumlu" etiketi lead'de durur, ileride `--owners` ile atanabilir. Enes: satis@ iki aktif kullanıcıda, Mohamed Anas (26) ve Amro Abdulvahit (51). Beyza: sales@ tabloda yok, tek Beyza pasif (45). Mehmet ve Faruk tabloda yok. Almanya Distribütörü dış ortak (3 DE lead'i).
   *Varsayılan:* bu ülkeler için kural yazılmaz; Excel'deki 52 lead ortak havuza düşer, "Excel'deki sorumlu" etiketi kalır, rapor havuz satırını etiketlere göre açar. Kullanıcılar açılınca `--owners` ile yeniden çalıştırılır. Distribütörün DE lead'leri de havuzda kalır; isterseniz `--owners` ile size (yönetici) atanır ki satışçılar üstlenmesin.
3. **Bölge kuralları yazılınca ortak havuzu kim görsün?**
   *Varsayılan:* bugünkü gibi bütün satışçılar bütün havuzu görür; bölge kuralı yalnız yeni lead'i otomatik atar. *Öneri:* kurallı ülkenin havuz lead'ini yalnız o ülkenin sorumlusu ve yedeği (ve yönetici) görsün; kuralı olmayan ülkelerin ve ülkesiz lead'lerin havuzu herkese açık kalsın. "Evet" denirse ayrı bir adımda uygulanır.
4. **Hangi temas "dönüş alındı" sayılsın?**
   *Varsayılan:* Dönüş alındı, Olumsuz, Anlaşma sağlandı; ayrıca Takip edilecek ve Teklif gönderildi kayıtlarında "Müşteri cevap verdi" işaretliyse (Telefon, Toplantı ve Saha ziyaretinde işaretli gelir). Böylece "müşteriyle konuştuk, teklif gönderdik" iki kez kaydedilmez. Değişiklik tek domain sabitidir; Ulaşma ve Dönüş oranlarını etkiler.
5. **Mesaj attık ama cevap yok: lead "İletişim kuruldu"ya geçsin mi?**
   *Varsayılan:* hayır; cevap gelince (ya da telefonda/toplantıda görüşülünce) önerilir. "İletişim kuruldu" reklam platformuna da sinyal olarak gider; cevapsız mesajda bu sinyal optimizasyonu bozar. Excel aktarımında da yalnız dönüşü olan 2 satır "İletişim kuruldu" olur, mail atılmış diğerleri "Yeni"de kalır. "Evet" denirse (Pipedrive'daki "ulaştık" anlamı) tek sabit değişir ve aktarımda mail atılmış 91 satır "İletişim kuruldu" olur.
6. **Excel aktarımı satışçılara takip görevi üretsin mi?**
   *Varsayılan:* evet. Atanmış her açık lead'e bir takip, beş iş gününe dağıtılmış, temsilci başına günde en çok 10; önce "3 ay içinde" ve hiç ulaşılmamış olanlar. Havuz lead'lerine görev açılmaz. "Hayır" denirse lead'ler "Takipsiz" görünür.
7. **"Gelen kutusu" yerini "Lead listesi"ne bıraksın mı?**
   *Varsayılan:* evet. İki ayrı lead listesi yerine tek liste: Excel gibi sütunlar ve filtreler, en yeni lead en üstte, yaş bilgisi ve arama korunur; menü yine 5 öğe. "Hayır" denirse Gelen kutusu kalır ve "Lead listesi" altıncı menü öğesi olur.

---

## Ek A — Reddedilen eleştiriler

- [M-M14] PROPOSAL'ı yalnız Nitelikli'den önseçmek: reddedildi; atlanan aşamanın `auto_fill` ile yazılması mevcut `ChangeLeadStage` kuralıdır (D1 değişmez), teklif sonucu aşamayı taşımazsa pano ile rapor yine ayrışır [U-I3].
- [M-I5] Durumu `stage_only` diye adlandırıp aşamaya bağlı tutmak: reddedildi; Excel'de "Hiç" yalnız temasa bağlıdır, eski kayıt ayrımı aşamadan değil `contact_history_unknown` köken işaretinden gelir [K-B1].
- [M-I1] İstemcide `useStageMove.collect/submitQuiet` sırası: reddedildi; aşama girdileri artık diyalogda satır içi [U-I2], sıra ve telafi sunucuda tek istekte yapılır (test edilebilir, istemcide yarım kalamaz).
- [M-B1] UI kural yorumlayıcısı + `tests/` eşlik testi: gerek kalmadı; eleştirinin önerdiği daha iyi yol seçildi, sunucu varsayılanları `contact-form` ile hazır gönderir (vitest `include` düzeltmesi yine yapılır).
- [K-M1] Oran sütunlarında renk skalası (J12:L21, G51:G54): reddedildi; oranlar sayı olarak okunur, üçüncü görsel kodlama gürültü ekler; çubuklar Lead ve Tercih sütunlarında kalır.
- [K-M1] §5'in bütün satırlarında ısı ikonu: reddedildi; yalnız "3 ay içinde" eyleme çağırır [U-M12].
- [K-M9] Excel düzeninde (A..AJ) dışa aktarma ve geri içe aktarma: reddedildi; aktarımdan sonra kaynak CRM'dir, gidiş-dönüş Excel'i ikinci doğruluk kaynağı yapar ve türetilen temasları çoğaltır.
- [U-I19] Varsayılanı `REPS_EDIT_PRODUCTS = true` yapmak: reddedildi; D4 ve kullanıcının 7e kararı bağlayıcıdır, öneri §8 soru 1'de.
- [U-I19] Diyalogda "Ürün bilgisi verdi (yönetici girsin)" onay kutusu: reddedildi; geçici bir yetki kararı için kalıcı alan ve diyaloğa bir seçim daha ekler, yönetici notları Temas geçmişinde not aramasıyla bulur.
- [U-B3] Alternatif "tür Telefon/Toplantı ise Takip edilecek ve Teklif'i dönüş say": reddedildi; açılmayan bir arama sonrası "Takip edilecek" de dönüş sayılırdı, açık işaret doğru ve tek tıktır.
- [U-I5] Herhangi bir açık iş varsa varsayılan olarak onu tamamlamak: kısmen reddedildi; yalnız vadesi bugüne kadar gelmiş iş varsayılan olur, iki hafta sonraki bir toplantıyı bir WhatsApp mesajıyla kapatmak yanlış olur [M-I8].
- [U-I16] "Reklam formu lead'leri (160)" kapsam çipi: kısmen; çip "Excel listesi (160)" oldu, çünkü Excel satırları `import` kaynağıyla gelir ve kaynak süzgeci 0 verir.
- [K-I9] `country_from_phone`'u kontrol edilene dek "warn" tutmak: yerine `import_review` seçildi; aynı Excel satırlarını tek uyarıyla işaretler, yeni form lead'lerinde bilgi düzeyinde kalır.
- [M-M1] `contact.undo_expired`'ı 403 yapmak: reddedildi; mevcut `undo.expired` gibi 422 kalır (yetki değil süre hatası).
- [K-I1] A8 (N tek başına → CONTACTED kaynaklı fark): kural gereksiz kaldı; N tek başına aşama üretmez ve "Hiç" aşamaya bakmaz.

## Ek B — Eleştirilerin uygulandığı yer

- **Kapsam:** K-B1 → §3.1 (`contact_history_unknown`), §3.3.2, §1.4, §2.6 · K-I1 → §6.8 · K-I2 → §3.3.7, §5.5 · K-I3 → §1.3, §3.3.3, §6.3 · K-I4 → §1.3, §3.3.7, §6.2, §8 soru 2 · K-I5 → §5.4 · K-I6 → §1.4, §3.2, §5.3 · K-I7 → §3.3.2, §6.3 · K-I8 → §3.3.7, §4.2, §5.6 · K-I9 → §3.2, §3.3.5, §6.3 · K-I10 → §6.3 · K-M1 → §5.5 · K-M2 → §3.2 · K-M3 → §3.3.7, §5.5 · K-M4 → §1.4, §5.5 · K-M5 → §3.3.2 · K-M6 → §1.3 · K-M7 → §6.3 · K-M8 → §4.7, §6.3 · K-M9 → §1.3, §5.4 · K-M10 → §4.2, §5.6 · K-M11 → §3.2, §5.2 · K-M12 → §6.8, S10 · K-M13 → §6.2 · K-M14 → §6.3 · K-M15 → §4.1, §6.1.
- **Kullanıcı deneyimi:** U-B1 → §5.0, §5.4, §5.5, §5.6, §1.3 · U-B2 → §5.2, §5.3 · U-B3 → §3.1, §3.2, §8 soru 4 · U-I1 → §5.3 · U-I2 → §4.1, §5.3 · U-I3 → §3.2, §3.3.2, §5.3 · U-I4 → §5.2, §5.6 · U-I5 → §3.3.2, §5.3 · U-I6 → §5.2 · U-I7 → §4.2, §5.2, §5.3 · U-I8 → §5.2, §5.3 · U-I9 → §1.3, §5.5 · U-I10 → §5.1 · U-I11 → §5.4 · U-I12 → §5.4 · U-I13 → §5.4 · U-I14 → §4.2, §5.1, §5.4 · U-I15 → §5.0, §8 soru 7 · U-I16 → §5.0, §5.5 · U-I17 → §5.5 · U-I18 → §3.3.5, §5.2 · U-I19 → §8 soru 1 · U-I20 → §6.3, §8 soru 6 · U-I21 → §3.3.2, §6.5, §8 soru 5 · U-M1 → §5.9 · U-M2 → §5.3 · U-M3 → §5.2 · U-M4 → §3.4 · U-M5 → §5.2 · U-M6, U-M7 → §5.4 · U-M8 → §5.2 · U-M9 → §5.4 · U-M10 → §5.6 · U-M11 → §5.4 · U-M12 → §3.2, §5.5 · U-M13 → §5.1, §5.4 · U-M14 → §5.2.
- **Mimari:** M-B1 → §4.4 (`contact-form`), S1 · M-B2 → §3.1, §4.1 · M-I1 → §4.1 · M-I2 → §4.8 · M-I3 → §4.3, §4.8 · M-I4 → §4.8, S1 · M-I5 → Ek A · M-I6 → §4.2 · M-I7 → §3.1, §4.2 · M-I8 → §3.3.2 · M-I9 → §4.1 · M-I10 → §4.5 · M-I11 → §6.1 · M-I12 → §4.1, §4.7 · M-M1 → §4.4 · M-M2 → §3.3.5 · M-M3 → §3.4 · M-M4 → S2/S5 ayrımı · M-M5 → §3.3.2, §4.1 · M-M6 → S1 · M-M7 → S1 · M-M8 → §5.4, §5.5 · M-M9 → §4.2, §4.5, §5.1 · M-M10 → S4–S6 dosya listeleri · M-M11 → §4.4 · M-M12 → §4.6 · M-M13 → §5.2 · M-M15 → §3.2 · M-M16 → §5.10 · adım sahipliği → §7 (özellik dosyaları, paralellik satırları, ölçüm betiği).

## Uygulama notları

- S1 · `activities_replied_check` `NOT customer_replied OR (outcome IS NOT NULL AND outcome IN ('follow_up','proposal_sent'))` yazıldı · §3.1'deki yalın `outcome IN (…)` sonuç NULL iken bilinmeyen döner ve CHECK'i geçirirdi (sonuçsuz satırda işaret kalırdı).
- S1 · ADR-0014 D1–D11'i belgedeki atıflardan kurdu; D11 = içe aktarma aracı kararı (§6.1) · iş emri D numaralarını adıyla tanımlamıyor, D11'e hiç atıf yok.
- S1 · `ports.ts`'e yalnız `ContactLogRepository`, `Repositories.contactLogs` ve çoklu değerli `LeadListFilter` eklendi (değer yardımcısı `filterValues` ayrı `domain/filter.ts`'te; ports.ts yalnız arayüz kalır); §4.3'teki diğer depo metotları uygulamalarıyla S3/S4/S5'te gelir, `visibleTo.ruled` eklenmedi · uygulamasız imza derlenmez; §4.8 görünürlüğü değiştirmiyor.
- S1 · `tests/types/dto-parity.test.ts`'te `Jsonify<TrackingReport>` denetimi yok · tip S2/S4'te doğar; denetim `dto.tracking.ts` ile S4'te eklenir.
- S1 · Aşamalı migration testi yeni dosyada (`src/modules/shared/db/migrate.7g.test.ts`); `migrate.test.ts`'te yalnız sürüm/tablo listesi, iki eski testin `TRUNCATE` listesine `contact_logs` eklendi · §7 genel kuralı (testler yeni dosyada) ve yeni yabancı anahtar.
- S1 · `tests/i18n-errors.test.ts` için mevcut 14 kodun `err.*` TR/EN anahtarı `src/i18n/index.tsx`'e eklendi (consent, eur_rates, organization, platform_lead_id, money.amount_invalid, stage.unknown, lead.name_too_long, lead.organization_invalid, lead.platform_id_required) · test bunlar olmadan kırmızıydı.
- S1 · `LeadDto` kod alanları `string` yerine kod birlikleri (`CustomerStatusDto`, `InstallSiteDto`, `InstallTimelineDto`, `CustomerProfileDto`, `CourtCountBandDto`) · arayüz için tip güvenliği; eşlik testi domain'le aynı olduklarını denetler.
- S1 · Kurucu yardımcıları eklendi: `NO_CONTACT_FIELDS`, `emptyTrackingFields()`, `PRODUCT_CODES`, `productQty`, `CUSTOMER_STATUS_STYLE`, `is*` kod denetçileri · mevcut kurucuların ve sonraki adımların tekrarını önler; davranış yok.
- S1 · 0012'ye `contact_logs_completed_idx` (`completed_activity_id`, kısmi) eklendi · aktivite silinirken `ON DELETE SET NULL` bağlı temas kaydını sıralı taramasız bulsun; karşı yöndeki `log_id`/`next_of_log_id` zaten indeksli.
- S1 · `tests/i18n-errors.test.ts` şablonla kurulan kodları da açar (`LEAD_TEXT_FIELDS`, `ORGANIZATION_TEXT_FIELDS` dışa açıldı; listede olmayan yeni şablon testi kırar) ve eksik 12 `err.lead.*`/`err.organization.*` TR/EN anahtarı eklendi · §5.10 denetimi yalnız sabit kodları görüyordu, S5'in alan kodları da kapsansın.
- S1 · `ui.tsx`'e `checkCircle`, `ruler`, `star` ikonları ve `tests/icons.test.ts` (müşteri durumu ve aktivite türü ikon anahtarları tanımlı mı) eklendi · §3.2 ton/ikon anahtarları tanımsız olunca belge ikonuna düşüyordu [K-M2].
- S2 · İki yeni hata kodu: `contact.occurred_invalid` (`validateContact`'a geçersiz `Date`) ve `product.invalid` (`parseProductPrefs`'e nesne olmayan girdi ya da boolean olmayan `roof.wanted`) · §3.3.2/§3.3.3 listeleri biçimsiz girdiyi kapsamıyordu; NaN tarih her iki sınır denetimini de geçerdi.
- S2 · `err.contact.*` ve `err.product.*` TR/EN anahtarları yeni `src/i18n/contact.ts`'te (`CONTACT_DICT`, `index.tsx`'e yayma satırı) · `tests/i18n-errors.test.ts` kodlar doğduğu adımda anahtar ister; dosya §5.10'daki yerinde, S8 arayüz metinlerini aynı dosyaya ekler.
- S2 · `stageLine`'a isteğe bağlı ikinci parametre `rules: { contactedOnOutbound }` (varsayılan `CONTACT_RULES`) · §7 S2 testi anahtarın iki değerini ister; sabit `as const` olduğundan başka yolla denenemez (S7 aktarımı da aynı parametreyi kullanabilir).
- S2 · `PhoneNumber.callingCodeFor(cc)` eklendi (`valid`, `callingCode` yanında) · domain npm paketi (`getCountryCallingCode`) içe aktaramaz; `phone_country_mismatch` ülkenin arama kodunu shared/normalization'dan alır.
- S2 · Domain `TrackingReport` yalnız hesaplanan bölümleri taşır (`header`, `basics`, `byOwner`, `byOwnerTotal`, `poolBreakdown`, `statusByOwner`, `statusTotal`, `products`, `closingPotential`, `byInstallTimeline`); `scope` ve `campaigns` sorgu bilgisidir, S4 ekler · `Jsonify<TrackingReport>` denetimi S4'te `Omit<TrackingReportDto, "scope" | "campaigns">`'a karşı yapılır.
- S2 · Havuz satırı `teamIds` verilmişse her zaman, `teamIds` null ise yalnız havuzda lead varsa çıkar; oranlar ham orandır (yuvarlanmaz) · §3.3.7 havuz satırının sıfır lead'de görünüp görünmediğini söylemiyordu; Excel önbellek değerleri (J22 = 0,56875) yuvarlamasız karşılaştırılır.
- S3 · Temas kaydı yazımı (`LogContact` 5. adım) bir `uow.run`'dadır; aşama önce kendi işlemiyle değişir, yazım patlarsa ya da `contact.activity_not_open` dönerse `UndoStageChange({changeId})` ile telafi edilir · §4.1 ile aynı; `ContactForm` sorgusu `ContactFormQuery` sınıfıdır.
- S3 · Tamamlanmış aktiviteyi yeniden açma (`SetActivityDone done=false`) artık yalnız yönetici; mevcut iki test bu kurala göre güncellendi · §4.1 kararı; satışçı yanlış kaydı 10 dk içinde "Geri al" ile döndürür.
- S4 · Ekip dizini portu `UseCaseDeps.team: TeamDirectory` (`activeSalesUserIds`, `inactiveUserIds`) adıyla; bildirim `UserDirectory`'si değişmedi · iki ayrı sorumluluk; `importMysql.ts` ve `migrateLegacy.ts` değişmeden derlenir.
- S4 · Lead detayı `undo.contactLogId` yalnız son aşama değişikliği bir temas kaydından geldiyse yazılır (yoksa alan yok) · mevcut detay testi değişmeden kaldı.
- S5 · Satışçı lead açarken `productInterest` (serbest metin "ürün ilgisi") verebilir; kort, model, kapanış, kuruluş, ürünler ve form cevapları `admin_only` · mevcut API sözleşmesi ve testleri bunu kullanıyordu; metin alanı bir fırsat alanı değildir. Sorumlu (`assignedUserId`) yetkisi api katmanında kalır.
- S5 · Intake'te açık eşleme hedefleri (`MAPPING_TARGETS` += install_site …) eklenmedi; soru tespiti `extra` anahtarlarının eşanlamlılarıyla yapılır · bugünkü Meta formu soruları eşanlamlılarla yakalanıyor; ekran (7a) gelince hedefler eklenir.
- S6 · `TerritoryRuleRepository.upsert` yerine aktarım betiği `territory_rules`'a doğrudan "yalnız eksik ülke" yazar · kural ekranı (7b) gelene kadar tek yazan aktarım; çakışma raporlanır.
- S7 · Postgres'te `--dry-run` yok (betik durur ve kopya veritabanını önerir); PGlite'ta geçici kopyada gerçek aktarım · hosting kararı bekliyor.
- S7 · `exceljs` önbellek değeri 0 olan formülde `result` yazmıyor; ÖZET RAPOR okunurken sonuçsuz formül 0 sayılır · formül sağlaması bu olmadan 60 sahte fark veriyordu.
- S9 · Lead listesinde sorumlu, ülke, kaynak ve aşama süzgeçleri yüklenen kümede uygulanır (sunucuya `contact`, `hot`, `warning`, `rotting`, `scope`, `campaign` gider) · Excel'deki gibi başlık menüsü bütün değerleri sayabilsin; üst sınır 2000.
- S9 · Arama kutusu (`q`) yüklenen kümede ad, telefon, e-posta, firma ve Excel No'da arar · sunucu araması Excel No'yu bilmez.
