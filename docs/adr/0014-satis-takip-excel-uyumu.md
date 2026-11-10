# ADR-0014: Satış takip (Excel) uyumu — temas kaydı, müşteri durumu, ürün tercihleri, türetilen rapor

- Durum: Kabul edildi
- Tarih: 2026-11-10
- Karar verenler: Yazılım (Elshan); orkestratör kararları D1–D11 ve 2026-11-10 görünürlük kararı
- İş emri: `docs/satis-takip-is-emri.md` (Faz 7g, adımlar S1–S10)

## Bağlam

Satış ekibi lead'leri `UNIXPADEL_Satis_Takip_Duzeltilmis.xlsx` çalışma kitabında izliyor: SATIŞ TAKİP (lead başına
tek satır: ulaşım, dönüş, müşteri durumu, teklif, ürün, form cevapları), TEMAS GEÇMİŞİ (her temas bir satır), ÖZET RAPOR
(formüllü ekip performansı) ve LİSTELER (seçenekler, ülke → sorumlu). Bir temas üç-dört yerde elle girildiği için veri
tutarsız; ✔/Evet işaretleriyle tarihler çelişebiliyor. CRM'de (ADR-0013) aktivite var ama temasın sonucu, kanalı
(WhatsApp yok), müşterinin kendi süreci, ürün adetleri ve form cevapları yapılandırılmış değil. Amaç: Excel'deki her
öğeyi CRM'de karşılamak, elle girilen işaretleri **türetmek**, Excel içe aktarıldığında ÖZET RAPOR sayılarını aynen
vermek. Altı aşama ve "aşama yalnız `ChangeLeadStage` ile değişir" kuralı değişmez (ADR-0006, ADR-0013).

## Karar

Kararlar iş emrindeki D numaralarıyla:

1. **D1 — Müşteri durumu ayrı alandır.** `leads.customer_status` (5 kod; NULL = "Durum girilmedi") müşterinin kendi
   sürecidir, aşamayı değiştirmez. Ayrı komutla yazılır (`SetCustomerStatus`; `LeadFields`'ta değildir): yönetici, lead'in
   sahibi satışçı ve havuz lead'inde satışçı (lead ona atanır). Çelişki (ör. "İlgisiz" ve açık aşama) bilgi uyarısıdır.
2. **D2 — Tek eylem "Temas kaydet"; temas = tamamlanmış aktivite, kanal = aktivite türü.** Tür listesine `whatsapp` ve
   `other` eklenir (`call` = GSM araması, ekranda "Telefon"). Tamamlanmış satır `outcome` (6 kod), `customer_replied`,
   `result_note`, `done_by_user_id` ve `date_estimated` taşır. Excel'in H–M (mail/WhatsApp atıldı, dönüş + tarih),
   Z/AA/AB (son/ilk temas, temas sayısı) sütunları ve TEMAS GEÇMİŞİ satırları bu kayıtlardan sorguda **türetilir**;
   sütun tutulmaz. Dönüş = Dönüş alındı / Olumsuz / Anlaşma sağlandı ya da "Müşteri cevap verdi" işaretli Takip
   edilecek / Teklif gönderildi (`isReply`). Dönüş yapışkandır.
3. **D3 — "Teklif verildi" türetilir.** Geri alınmamış `PROPOSAL` aşama olayı (`auto_fill` dahil, `reachedStage`) ya da
   "Teklif gönderildi" sonuçlu/türlü tamamlanmış temas. "Teklif gönderildi" sonucu kaydedilirken aşama da `ChangeLeadStage`
   ile `PROPOSAL`'a geçer; pano sütunu ile rapor aynı sayıyı verir. Elle bayrak yoktur.
4. **D4 — Ürün tercihleri sütunlardadır.** `qty_standard`, `qty_panoramic`, `qty_full_panoramic` (1–29, NULL = tercih
   yok), `roof_wanted`, `roof_width_m`, `roof_length_m` (`numeric(5,2)`, > 0; ölçü Kapatma ister). Adet = tercih, bu
   yüzden Excel'in "✔ var adet yok" sarı hücresi oluşamaz; çatı alanı türetilir. Yetki: yalnız yönetici (Faz 7e,
   `REP_EDITABLE_LEAD_FIELDS = ["notes"]`); tek anahtar `REPS_EDIT_PRODUCTS` (varsayılan kapalı) satışçıya açar.
5. **D5 — Form cevapları kodlu sütunlardır.** `install_site` (7), `install_timeline` (4), `customer_profile` (6),
   `court_count_band` (4), `ad_surface` (opak kod: `ig`, `fb`, `web`, `whatsapp`…; etiketi yalnız `src/i18n`'de).
   Intake doldurur (eşleme hedefleri 0012'de genişler), yönetici düzeltir, satışçıya salt okunurdur. Kampanya
   (`campaign_name`) kimse tarafından düzenlenmez. "3 ay içinde" + açık aşama = **sıcak lead** (`isHotLead`).
6. **D6 — Veri uyarıları hesaplanır, saklanmaz.** Saklanan tek şey yöneticinin "Kontrol edildi" dediği kodlardır
   (`leads.checked_warnings text[]`). Yönetici bütün uyarıları, satışçı yalnız işini etkileyen üçünü (telefon kodu
   uyumsuz, telefon geçersiz, çatı ölçüsü eksik) görür.
7. **D7 — Bölge, ekip ve bildirim.** **Görünürlük değişmez** (orkestratör kararı, 2026-11-10): satışçı kendi lead'lerini
   ve bütün ortak havuzu görür; `visibility.ts` yeniden düzenlenmez. Bölge kuralları (`territory_rules`, LİSTELER'den
   tohumlanır) yalnız yeni lead'in otomatik atanmasında kullanılır; pasif kural kullanıcısı yedeğe ya da havuza düşer,
   ekip dizini bilinmiyorsa süzme yapılmaz (fail-open). Kullanıcı olmayan Excel sorumlusu havuza düşer, etiketi
   `extra_answers.excel_owner`'da kalır. Yeni bildirim türü yoktur; yalnız `install_timeline = m0_3` ise mevcut lead
   bildiriminin metni "Sıcak lead:" ile başlar.
8. **D8 — "Özet rapor" ÖZET RAPOR'un formüllerini birebir uygular.** "Hiç ulaşılmadı" yalnız temas kayıtlarına bağlıdır,
   aşamaya bakmaz. Temas geçmişi bilinmeyen eski kayıtlar (`leads.contact_history_unknown`, köken olgusu) "Hiç"e değil
   "Kayıt yok (eski)" sütununa sayılır ve oranların paydasından çıkar. Excel kapsamında farklar yalnız A1–A9 gerekçe
   kodlarıyla izinlidir; `db:import-excel --verify` her farkı bir koda bağlar.
9. **D9 — "Lead listesi" Gelen kutusunun yerini alır.** Excel benzeri sütun grupları, başlık süzgeçleri, telefon →
   WhatsApp, e-posta → mail, CSV; üst menü yine 5 öğedir.
10. **D10 — İçe aktarmada aşama türetme.** Teklif olgusu → `PROPOSAL` (tutar null), değilse dönüş olgusu → `CONTACTED`,
    değilse `NEW`. Otomatik `WON`/`LOST` ve `QUALIFIED` yoktur; müşteri durumu tek başına aşama üretmez.
11. **D11 — İçe aktarma aracı.** `npm run db:import-excel` (`exceljs` sabit sürüm, yalnız betikte): yeniden çalıştırılabilir
    (`excel_no` ve legacy kimlikler), gerçek komutlarla yazar (`CreateLead`, `ChangeLeadStage`, `AssignLead`); kuru çalıştırma
    ve `--verify` gerçek veritabanına yazmaz; çıktıda kişisel veri yoktur. (İş emri D11'i adıyla tanımlamaz; numara §6.1
    araç kararına verildi, iş emri "Uygulama notları" S1.)

**Kort sayısı ve model (§3.4).** `court_count` ürün satırlarından **yazılmaz**; formdan gelen kesin sayıyı korur ve ürünler
temizlenince kaybolmaz. Ürün adedi varken gelen `courtCount` değişikliği reddedilir (`court_count.derived`). Ekranda doğrudan
kort sayısı girişi yoktur; gösterim sırası: ürün toplamı > `court_count` > bant ("2-3 kort (form)"). `court_model` eski
bilgidir, salt okunur; otomatik ürüne çevrilmez (Klasik = Standard varsayımı satış onayı ister). `product_interest` kalır.

**Temas kaydı (`contact_logs`).** Tek "Temas kaydet" işleminin geri alma bilgisi: kaydeden, zaman (10 dakikalık pencere
buradan sayılır), tamamlanan plan ve önceki tür/konu, müşteri durumu öncesi/sonrası, aynı işlemdeki aşama değişikliğinin
`change_id`'si, havuzdan atama yapıldı mı. Rol sütunu yoktur; rol bağlardan çıkar: `activities.log_id` = bu kaydın eklediği
ya da tamamladığı satır, `contact_logs.completed_activity_id` = tamamlanan plan, `activities.next_of_log_id` = bu kaydın
sonraki takibi. Kayıt silinince bağlar `ON DELETE SET NULL` ile düşer; lead silinince kayıt da gider.

**Migration `0012_faz7g_satis_takip.sql`.** Şema ekleri (tür listesi, `contact_logs`, aktivite ve lead sütunları, CHECK'ler,
eşleme hedefleri) ve **geri alınamaz** veri düzeltmeleri: eski `FX` ülke kodu → `FR` (lead ve kişi), `ad_surface`'in mevcut
`extra_answers` değerlerinden doldurulması, NEW olmayan ya da MySQL kaynaklı ve tamamlanmış aktivitesi olmayan lead'lere
`contact_history_unknown = true`. Eski değerler saklanmaz; geri dönüş yedekten yapılır. 0012'den sonra bu işareti yalnız
`db:import-mysql` yazar. Faz 7c'nin migration'ı `0013` olur.

## Seçenekler ve neden seçilmediği

| Seçenek | Neden seçilmedi |
|---|---|
| Türetilen değerler için VIEW ya da türetilmiş sütun | Kural SQL'e taşınırsa domain'le çift kopya olur, sahte depolar paylaşamaz, her kural değişikliği migration ister |
| Ürünleri `jsonb` dizisinde tutmak | Dört sabit ürün için CHECK karmaşıklaşır; genel `updateFields` jsonb dizisi sorununa girer |
| Müşteri durumunu aşamaya bağlamak (`stage_only`) | Excel'de "Hiç" yalnız temasa bağlıdır; eski kayıt ayrımı aşamadan değil köken işaretinden gelir |
| `contact_logs` yerine aktivitede rol sütunu | Bir plan sonradan başka kayıtla tamamlanabilir; bağlar rolü kayıpsız anlatır, geri alma ilk kaydı silmez |
| Havuzu bölge kuralına göre daraltmak | Kullanıcının istemediği davranış değişikliği; iş emri §8 soru 3'te öneri olarak durur |
| Excel düzeninde dışa aktarma + geri içe aktarma | Aktarımdan sonra kaynak CRM'dir; gidiş-dönüş ikinci doğruluk kaynağı yaratır ve türetilen temasları çoğaltır |
| Varsayılan `REPS_EDIT_PRODUCTS = true` | D4 ve Faz 7e kararı bağlayıcı; öneri §8 soru 1'de |

## Sonuçlar

- **S1 (veri modeli):** migration 0012; domain `activity.ts` (türler, `CONTACT_CHANNELS`, `ACTIVITY_OUTCOMES`, `isReply`,
  `FOLLOW_UP_SUBJECTS`, `ContactLog`), `lead.ts` (yeni alanlar), `products.ts`, `leadProfile.ts`, `reports.ts`
  (`reachedStage`), `ports.ts` (`ContactLogRepository`, çoklu değerli `LeadListFilter`); Postgres depoları ve bellek içi
  sahteler; DTO'lar; `tests/types/dto-parity.test.ts`, `tests/i18n-errors.test.ts`. Yerel PGlite kopyasında 513 lead'in
  509'u "Kayıt yok (eski)" olarak işaretlendi; lead, kişi ve aktivite sayısı değişmedi.
- S2–S10 (saf kurallar, komutlar, okuma modeli, intake, bölge, içe aktarma, arayüz, kabul) iş emrindeki sırayla.
- ADR-0013 madde 3'teki sabit tür listesi bu kararla genişler (ADR-0013 eki).
