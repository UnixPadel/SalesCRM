# Faz 6c — Satış panosu: raporlar yeni aşama olaylarından: kabul raporu

Tarih: 2026-11-02. Kapsam: `docs/yol-haritasi.md` bölüm 6, Faz 6c. Veri kaynağı `leads` + `lead_stage_events`
(ADR-0013 madde 1: aşama olayları fırsat geçmişidir); eski JSON raporları kaldırıldı.

## Görevler ve commit'ler

| Görev | Nerede | Commit |
|---|---|---|
| Saf rapor kuralları `buildReport` (aylık kazanılan, aşamaya göre dönüşüm, ülkeye göre açık hat, kayıp nedenleri, kaynağa göre lead, KPI'lar); `ReportQueries.summary`; `GET /reports?months=`; `ReportDto` | `sales-pipeline/domain/reports.ts`, `application/reports.ts`, `api/router.ts`, `api/dto.ts` | `00621b2` |
| Raporlar sayfası yeni veriyle; dönem 6 / 12 / 24 ay hatırlanır; eski `src/pages/ReportsPage.tsx` silindi; App rotası | `src/pipeline/ReportsPage.tsx`, `src/pipeline/api.ts`, `src/App.tsx`, `src/i18n`, `pipeline.css` | `b3a91fe` |
| Belgeler: bu rapor, README, yol haritası, ADR-0013 eki | `docs/`, `README.md` | (bu commit) |

## Rapor tanımları ve doğrulama

| Rapor | Tanım | Test |
|---|---|---|
| Aylık kazanılan | Geri alınmamış **WON** olayının ayı (Europe/Istanbul takvimi); tutar olaydaki, yoksa son geçerli teklif; EUR'a `EurRates` ile | `reports.test.ts`: Şubat 95.000 EUR, Mart 10.000 USD → 9.200; geri alınan WON sayılmaz; farklı kurla 10.000 |
| Aşamaya göre dönüşüm | Açık aşamalar için **ulaşan** (o aşamada olay var ya da şu an orada) / **kapanan** (WON + LOST) / **kazanan**; oran = kazanan / kapanan, kapanan yoksa `null` (açık lead'ler oranı sulandırmaz, eski tanımla aynı) | `reports.test.ts`: NEW 7/4/2 → 0,5; CONTACTED 6/3/2 → 0,67 … |
| Ülkeye göre açık hat | Terminal olmayan lead'ler, `stageSummary` son geçerli tutarıyla; ülke yoksa `""`; toplam EUR, sonra adet sırasıyla | `reports.test.ts`: TR 2 / 50.000 (teklif 20.000 + geri alınan kazanımın teklifi 30.000), bilinmeyen 1 / 0 |
| Kayıp nedenleri | Bugün **LOST**'ta olan lead'in son geri alınmamış LOST olayındaki kod; kod yoksa `unspecified` | `reports.test.ts`: competitor 1, unspecified 1 |
| Kaynağa göre lead | Dönemde oluşturulan lead sayısı ve kazanılanları, kaynağa göre | `reports.test.ts`: manual 2, meta 2 (1 kazanıldı), google 1, web 1 (1 kazanıldı); dönem dışı lead sayılmaz |
| KPI | açık lead sayısı ve toplamı, bu ay kazanılan, kapananlar içinde kazanma oranı | `reports.test.ts` boş veri (hepsi 0 / null) ve dolu senaryo |
| Görünürlük ve test lead'i | Satışçı kendi + havuz, admin hepsi; `is_test` lead'ler hiçbir rapora girmez; ay sayısı 1–36'ya sıkıştırılır | `application.test.ts` "Raporlar (Faz 6c)"; `api.test.ts` (`months=abc` → 12, görüntüleyici okur, oturumsuz 401) |

Ay sınırları ve "bu ay" `calendarDay` ile satış ekibinin saat diliminde (`UseCaseDeps.timeZone`); testte 31 Ocak 22:30
UTC'nin İstanbul'da Şubat sayıldığı gösterildi.

## Test planı ve çıktı

```
npm run verify (2026-11-02, Faz 6c sonrası)
  lint 0 hata · 11 önceden var olan uyarı · Prettier temiz · tsc (iki proje) temiz
  · depcruise 0 ihlal (1 bilgi: server/authDb.d.mts orphan) · secretlint temiz
  · 37 test dosyası / 376 test yeşil (6b sonu: 36 / 370)
```

## Tarayıcı doğrulaması (yerel PGlite, `crm-test-login`, satışçı hesabı)

| Adım | Görülen |
|---|---|
| `#/reports` (sunucu yeniden başlatıldıktan sonra) | KPI: Açık hat €95.000 / 6 açık lead; Bu ay kazanılan €0; Kazanma oranı "—" (0 kapanan); Gelen lead 6 |
| Aylık kazanılan | 12 ay etiketi (Ara 25 … Kas 26), sıfır çubuklar, "Bu dönemde kazanılan yok." |
| Aşamaya göre dönüşüm | 4 aşama, "—", "0/0 kapanan · 6 ulaşan" vb. |
| Ülkeye göre açık hat | Türkiye €95K · 6 lead |
| Kayıp nedenleri / Kaynağa göre | "Kaybedilen lead yok."; Manuel 3, Web 2, Google 1 |
| "Son 6 ay" | 6 çubuk, istek `?months=6`, seçim `localStorage`'da |

Not: API sunucusu (`tsx server/index.mjs`) dosya değişikliğini izlemiyor; yeni uç ilk denemede 404 verdi, sunucu
yeniden başlatılınca geldi. Canlıda dağıtım zaten yeniden başlatır.

## Kabul kriterleri (yol haritası, 6c)

| Kriter | Doğrulama |
|---|---|
| Sorgular testli | `domain/reports.test.ts` (4 test, dolu senaryo 8 lead), `application.test.ts`, `api.test.ts` |
| Sayfa boş veride de çalışır | `buildReport` boş girdi testi; tarayıcıda kazanılan/kaybedilen yokken sayfa düzgün (sıfır çubuklar, "—", boş durum metinleri) |

## Bitti tanımı (Genel plan) — bu faz

- [x] İş kuralı saf ve testli (`reports.ts`: I/O yok, tarih ve kur girdiyle)
- [x] Dış bağımlılık port arkasında (mevcut `leads.list`, `stageEvents.listByLeads`; yeni port yok)
- [x] Tek transaction: rapor tek `uow.run` içinde okunur
- [x] Logda kişisel veri yok (rapor loglamaz)
- [x] Config ve secret kodda değil (kurlar `EUR_RATES`, saat dilimi `timeZone`)
- [x] Arayüz metinleri TR ve EN (`reports.*`)
- [x] ADR güncellendi (ADR-0013 eki)
- [x] Sözlük testi geçti

## Bilinen eksikler ve sonraki adımlar

1. **Ağırlıklı tahmin** (tutar × kolon olasılığı) eski sayfadaki KPI'ydı; `stage_definitions`'ta olasılık yok, bilinçli
   olarak alınmadı. İstenirse ADR-0006 ile aşama olasılığı tanımlanır.
2. Raporlar tüm görünür lead'leri belleğe alıp hesaplar; bugünkü hacimde (≈1.000 lead) yeterli. 10.000+ lead'de
   SQL toplamlarına geçilir.
3. Dönem seçimi 6 / 12 / 24 ay; özel tarih aralığı ve CSV dışa aktarma yok.
4. **6d:** `organizations` + `organization_id`, Kişiler sayfası (`persons`), e-posta/telefon düzenleme, eski `src/pages/*`,
   `/api/db/*`, `crm.json` ve `src/domain/rules.ts` kaldırılır; `db:migrate-legacy` aktiviteler ve kuruluşlar.
