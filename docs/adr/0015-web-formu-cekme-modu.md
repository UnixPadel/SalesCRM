# ADR-0015: Web sitesi formu — çekme modu (site saklar, CRM worker'ı çeker)

- Durum: Kabul edildi
- Tarih: 2026-11-13
- Karar verenler: Yönetim (Elshan); site tarafı: web ekibi (sözleşme v1)
- İlgili: ADR-0010 (web formu kimliği ve aktarıcı), ADR-0005 (hosting), ADR-0016 (dağıtım ve gizli bilgiler, bekliyor)

## Bağlam

ADR-0010 site formunu push ile bağladı: site sunucusundaki aktarıcı her gönderimi CRM'in `POST /forms/web` ucuna iter.
Bu, CRM'in internete açık bir HTTPS adresi olmasını ister. 2026-11'de dağıtım değişti: CRM bilgisayarlara masaüstü
uygulaması (.exe) olarak dağıtılacak, internete açık CRM adresi yok; Clever Cloud'da arayüzsüz bir Node.js worker
zamanlanmış işleri çalıştıracak. Site (Astro, WordPress eklentisi olarak sunuluyor) talepleri zaten kendi tarafında
saklıyor. Yarım kalan bir `x-api-key` push ucu denemesi (`wip/teklif-formu-push` dalı) de internete açık adres
gerektirdiği için bırakıldı.

## Karar

1. **Çekme.** Site talepleri saklar ve imzalı bir API sunar (`<taban>/pending`, `<taban>/ack`; sözleşme v1,
   `docs/runbooks/web-form.md` bölüm 7). Worker `WEB_PULL_SECONDS` (120) aralıkla çeker. Site tarafını başka ekip yazar;
   sözleşme tek taraflı değiştirilmez.
2. **Aynı kimlik, aynı kapı.** İmza şeması ve anahtar push ile aynıdır (`WEB_FORM_HMAC_KEY`, HMAC-SHA256,
   `"<ts>." + gövde`, 300 sn). Her öğe push ucunun kullandığı `AcceptInboundEvent`'ten, sağlayıcı `web` ve mükerrer
   anahtarı `web:<submission_id>` ile gelen kutusuna yazılır; yeni adaptör yazılmaz, `webFormSourceAdapter` kullanılır.
3. **Önce yaz, sonra onayla.** Yalnız gelen kutusuna yazımı kesinleşen öğeler onaylanır (`inserted` / `duplicate`).
   Hata (ağ, 429, 5xx, 401, 400, 503) olursa o sayfa onaylanmaz; sonraki tur dener. Onay kaybolursa öğe yine gelir ve
   `duplicate` olarak onaylanır. İki süreç aynı anda çekse de UNIQUE mükerrer anahtarı ve SKIP LOCKED tek lead verir.
4. **Kuyruk tıkanmaz.** Sözleşmede imleç yok: onaylanmayan öğe hep başta döner. Bu yüzden `submission_id`'si olan her
   öğe (bot, bozuk gövde dahil) önce gelen kutusuna yazılır ve onaylanır; ayıklama gelen kutusu işleyicisinde yapılır.
   Honeypot dolu gönderim lead açılmadan kapanır (`IgnoredInboundEvent` → satır `done`, lead yok, kod `web.honeypot`);
   bozuk gövde `failed` olur ve Yönetim → Sağlık'ta görünür. Sözleşme değişmez.
5. **Durum veritabanında.** Son tur (zamanlar, hata kodu, sayılar) `integration_settings` (`web`, `pull_status`)
   satırına yazılır: masaüstü uygulamasındaki Sağlık sekmesi worker başka süreçte olsa da görür. Kişisel veri yazılmaz.
6. **Alanlar.** `project_type` → müşteri profili, `court_count` → kort sayısı (`normalizeFormAnswers`), `country` (ISO)
   çözülemezse `country_input` (en, tr, de, fr, ar, ru); seed 0014 yeni alanları açıkça ek yanıt olarak eşler.
7. **Eski kayıtlar** (`import_source: "wp-legacy"`) normal web lead'i gibi işlenir; satışçıya "yeni lead" bildirimi
   düşer (Yönetim kararı, 2026-11-13).

## Seçenekler ve neden seçilmediği

- **Push (`/forms/web`, ADR-0010):** internete açık CRM adresi ister; bugünkü dağıtımda yok. Kod kalır; merkezi sunucu
  seçilirse (ADR-0016) yeniden açılabilir.
- **`x-api-key` ile düz gövde push (`/api/webhooks/quote-request`):** yine açık adres ister, ayrıca ikinci bir kimlik
  şeması ve ikinci bir gövde biçimi getirir. Bırakıldı.
- **Worker'ın sitenin veritabanını okuması:** iki sistemi şemaya bağlar, sitenin ekibinin değişiklik özgürlüğünü alır.

## Sonuçlar

- Talep sitede beklediği için CRM ya da worker kapalıyken kayıp olmaz; gecikme en çok bir tur + kesinti süresidir.
- Lead'ler gerçek zamanlı değil, en geç `WEB_PULL_SECONDS` saniye gecikmeyle gelir.
- Site ekibinin `/pending`'e koyduğu her öğenin bir `submission_id`'si olmalıdır; yoksa onaylanamaz ve başta kalır
  (Sağlık panelinde sayılır).
- Anahtar değişimi iki yerde yapılır (site ve worker); arada talepler sitede bekler.
