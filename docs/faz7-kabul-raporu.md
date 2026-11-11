# Faz 7 — Yönetim paneli: kabul raporu

Tarih: 2026-11-11. Kapsam: `docs/faz7-is-emri.md` parça 7a–7d (7e, 7f ve 7g daha önce tamamlandı; 7g'nin raporu
`docs/satis-takip-kabul-raporu.md`). Bu fazla admin, bugüne kadar SQL ya da ortam değişkeniyle yapılan ayarları ekrandan
yapıyor; gelen ve giden akışın sağlığını görüyor; takılan kayıtları yeniden kuyruğa alıyor.

## Görevler ve commit'ler

| Görev | Nerede | Commit |
|---|---|---|
| Benimsenen Excel / form tablosu lead'leri platforma geri bildirim gönderir (`feedbackIdentity`, `reviveSkipped`); giriş logu veritabanı adresini yazmaz | `sales-pipeline/domain/lead.ts`, `application/createLead.ts`, `queries.ts`, `server/authDb.mjs` | `af75274` |
| 7a–7d sunucu tarafı: sağlık sorguları ve yeniden kuyruğa alma, `/api/admin`, eşleme ve ayar yazma, EUR kurları, bölge kuralları, Google istek akıbeti, kişi birleştirme, kuruluş arşivi; migration `0013` | `ad-feedback/application/health.ts`, `lead-intake/application/health.ts`, `integration-settings/{domain,application,api}`, `sales-pipeline/{domain/adminRules.ts, application/territories.ts, peopleAdmin.ts, api/adminRoutes.ts}`, `bootstrap/{admin.ts, eurRates.ts}` | `cede91f` |
| 7a–7d arayüz: Yönetim paneli (Sağlık · Eşlemeler · Ayarlar · Bölgeler), Kişiler sayfasında birleştir ve arşivle | `src/pipeline/admin/*`, `MergePersonDialog.tsx`, `PeoplePage.tsx`, `src/i18n/admin.ts` | `2b02ea2` |
| Canlıya alma hazırlığı: duman testi (`npm run db:smoke`), yerel Postgres 16 tanımı, runbook; belgeler | `scripts/smoke-db.ts`, `docker-compose.postgres.yml`, `docs/runbooks/canliya-alma.md`, bu rapor | (bu commit) |

## Kabul kriterleri

| Kriter (iş emri) | Sonuç | Nasıl doğrulandı |
|---|---|---|
| Admin SQL'siz ayar değiştirir | Geçti | `bootstrap/admin.test.ts`: Meta olay adı değişir → `platform_stage_mappings` güncel; EUR kuru değişir → pano toplamı 920 → 500. Tarayıcıda (veri kopyası): "Nitelikli" olay adı kaydedildi; USD 0,92 → 0,86 kaydedilince pano "Teklif" toplamı 14.015.820 € → 13.995.112 € |
| Dead satır yeniden kuyruğa alınır ve dağıtıcı onu tekrar dener | Geçti | `health.test.ts` (dead → requeue → dağıtıcı gönderir), `outbox.test.ts` (Postgres: `claimDue` satırı döner), `admin.test.ts` (API 200, ikinci turda `sent`). Tarayıcıda: "Yeniden dene" → kalıcı hata 1 → 0, bekleyen 1 → 2 |
| Acil durdurma ekrandan | Geçti | `admin.test.ts`: anahtar kapalıyken dağıtıcı `emergency_stop` ile atlar; ekran değeri veritabanıyla aynı |
| requestStatus sonucu görünür | Geçti | `google-data-manager.test.ts` (çeviri: PROCESSING / SUCCESS / PARTIAL_SUCCESS / FAILED), `admin.test.ts` (sahte Google ucu, satır detayı). Gerçek Google hesabıyla denenmedi (hesap yok) |
| Birleştirme ve arşiv kuralları | Geçti | `application/admin.test.ts` (lead taşındı, kaynak gizli, döngü reddi; arşivli kuruluş listede ve aramada yok), `infrastructure.test.ts` (Postgres). Tarayıcıda: arşivle / arşivden çıkar, birleştir (1 lead taşındı) |

Ek doğrulamalar: yalnız yönetici (oturumsuz 401; satışçı ve görüntüleyici 403; satışçıda "Yönetim" menüsü yok, adres
yazılınca "yalnız yöneticiye açık" sayfası). Gizli anahtar değerleri hiçbir yanıtta yok (`admin.test.ts` yanıt gövdesinde
token, webhook anahtarı ve özel anahtar arar). 375 px genişlikte dört sekmede sayfa yatay kaymıyor.

Kalite kapısı: `npm run verify` yeşil, 778 test; yeni lint uyarısı yok.

## İş emrinden sapmalar

| Konu | İş emri | Yapılan | Neden |
|---|---|---|---|
| Google durum sorgusu | `POST …/v1/requestStatus:retrieve` | `GET …/v1/requestStatus:retrieve?requestId=…` | Google başvuru sayfası (2026-11-11'de okundu): yöntem GET, istek gövdesi boş. İş emri alan adlarının kod yazılırken doğrulanmasını istiyordu |
| Kişi birleştirme yetkisi | Satışçı iki kaydı da görebiliyorsa birleştirir | Yalnız yönetici | Faz 7e kararı (2026-11-10): müşteri kaydını yalnız yönetici değiştirir; birleştirme o listede açıkça sayılı |
| Sağlayıcı ayar anahtarları | `form_ids` | `active_form_ids` | Kodun ve seed'in kullandığı anahtar bu; ekran mevcut anahtarı düzenler |
| "Havuza uygula" bildirimi | Belirtilmemiş | Lead başına bildirim gönderilmez | Toplu işlem; onlarca bildirim satışçıyı boğar. Sonuç ekranda ve logda kişi başına sayıyla görünür |
| Boş olay adı | Kaydedilemez | Yalnız **açık** satırda kaydedilemez | Google seed'i kapalı yer tutucu satırlarla gelir; kapalı satırın boş adı zararsızdır |

## Bu fazda bulunan ve düzeltilenler

- **Geri bildirim boşluğu:** Excel ve form tablosundan gelen lead'ler "içe aktarım" kaynağıyla kayıtlıydı; Meta ya da
  Google kaydı aynı kişiyi bulup benimsese bile dağıtıcı bu kaynağı atlıyordu. Artık benimseme kaynak ve kimliği lead'e
  yazıyor, dağıtıcı o kimlikle gönderiyor, önceden atlanmış aşama olayları yeniden sıraya giriyor. Lead'in kendi kaynağı
  `import` kalır (raporlar ve Excel doğrulaması değişmez).
- **Log:** sunucu açılışta kullanıcı tablosunun MySQL kullanıcı adını ve sunucu adresini yazıyordu; artık yalnız
  veritabanı türü. Giriş ekranına veritabanı hata ayrıntısı dönmüyor.

## Bilinen sınırlar

- Hiçbir platform gerçek hesapla denenmedi (token, veri seti, servis hesabı yok); doğrulama sahte uçlarla.
- Duman testi gerçek Postgres 16'ya karşı henüz çalıştırılmadı (Docker Desktop kapalıydı); bellek içi PGlite'ta geçti.
  Komutlar `docs/runbooks/canliya-alma.md` bölüm 2'de.
- Akıbet sorgusu satır başına tek istektir; toplu ya da zamanlanmış sorgu yok (kota; iş emri kararı 6).
- "Havuza uygula" geri alınamaz; yanlış atama lead'den tek tek düzeltilir. Ekran uygulamadan önce kişi başına sayıyı
  gösterir.
- Kişi birleştirme geri alınamaz (kaynak silinmez ama lead'leri hedefe geçer).
- Yönetim panelinde değişiklik geçmişi ekranı yok; kim neyi değiştirdi sunucu logunda (`module: "admin"`).
