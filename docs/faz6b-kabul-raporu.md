# Faz 6b — Satış panosu: fırsat alanları, kolon istatistikleri, filtreler: kabul raporu

Tarih: 2026-11-02. Kapsam: `docs/yol-haritasi.md` bölüm 6, Faz 6b. Veri modeli ADR-0013 madde 5; bu fazda alınan iki
ek karar yol haritası bölüm 8'e (5–6) ve ADR-0013'e işlendi.

## Plandan sapmalar (onaylandı, 2026-11-02)

| # | Plan | Yapılan | Neden |
|---|---|---|---|
| 1 | `organization_id` sütunu 6b'de | **6d'ye ertelendi**; `organizations` tablosuyla birlikte, FK ile gelir | Tablo yokken FK'siz boş sütun açılmazdı |
| 2 | Kur tablosu: eski sabit `EUR_RATE` | **Uygulama ayarı:** `UseCaseDeps.eurRates`, varsayılan eski tablo (USD 0,92 · GBP 1,17 · TRY 0,027), `EUR_RATES` ortam değişkeniyle JSON olarak ezilir; `GET /reference` arayüze verir | Tutar aşama olayında kalır (ADR-0013); kur kodda sabit kalmasın, Faz 7'de ekrandan düzenlenir |

## Görevler ve commit'ler

| Görev | Nerede | Commit |
|---|---|---|
| Migration `0010_faz6b_lead_fields.sql` (`court_count` 0–999, `court_model`, `expected_close_date`; ülke ve kapanış indeksleri); saf kurallar `parseLeadFields`, `stageSummary`, `parseEurRates`/`toEur`, `columnStats`; portlar `leads.updateFields`, `stageEvents.listByLeads`, `LeadListFilter.owner/country`; Postgres ve bellek içi uygulamalar | `db/migrations`, `sales-pipeline/domain/opportunity.ts`, `ports.ts`, `infrastructure/*`, `application/fakes.ts` | `18e7b48` |
| `UpdateLeadFields` komutu; `LeadQueries.board` (filtreler + istatistikler aynı kümeden); liste/detay öğesinde `stageEnteredAt`, `value`; `CreateLead` fırsat alanları; `GET /board`, `PATCH /leads/:id`, `reference.eurRates`; `EUR_RATES` config; `migrate-legacy` alanları sütuna | `sales-pipeline/application/*`, `api/*`, `shared/kernel/config.ts`, `bootstrap/*` | `e112799` |
| Arayüz: pano filtre çubuğu (URL + hatırlama), kolon başlığında toplam EUR ve ort. gün, kart çipleri, lead detayında "Düzenle", yeni lead formunda üç alan; TR/EN | `src/pipeline/*`, `src/router.ts`, `src/i18n` | `31d3497` |
| Belgeler: bu rapor, README, yol haritası, ADR-0013 eki, `decisions.md`, `.env.example` | `docs/`, `README.md` | (bu commit) |

## Davranış kuralları ve doğrulama

| # | Kural / özellik | Nerede uygulanır | Test |
|---|---|---|---|
| 4 | Her kolonda **adet, toplam EUR, ortalama bekleme günü**; filtrelenmiş kümeden; kuru bilinmeyen tutar sayılır, toplanmaz | `columnStats` (saf), `LeadQueries.board`, Kanban `col-stats` | `opportunity.test.ts` "columnStats…"; `application.test.ts` "board: …" (NEW ort. 3 gün, PROPOSAL 9.200 EUR = 10.000 USD × 0,92; farklı kurla 10.000); `api.test.ts` `GET /board` |
| — | **Aşamaya giriş anı ve son tutar** geri alınmamış olaylardan; olay yoksa oluşturulma anı | `stageSummary` (saf) | `opportunity.test.ts` "stageSummary…" (geri alınan WON sayılmaz, ikinci teklif son tutarı verir) |
| — | **Filtreler** sorumlu (`me` / `pool` / kimlik) · ülke · takipsiz; satışçı yine yalnız görebildiklerini alır | `LeadListFilter`, `board`, router `GET /board` | `infrastructure.test.ts` (SQL filtreleri), `application.test.ts` (rep yalnız kendi + havuz), `api.test.ts` (`owner=pool`, `rotting=1`, geçersiz ülke yok sayılır, 401) |
| — | **Filtre URL'de ve hatırlanır:** `#/pipeline?owner=me&country=TR&rotting=1`; parametresiz girişte son filtre uygulanır; temizleyince unutulur | `src/router.ts` `setHashParams(replace)`, `boardFilter.ts` | Tarayıcı: chip → URL `?rotting=1`, `localStorage` dolu; `#/inbox` → `#/pipeline` → `?rotting=1` geri geldi; "Filtreleri temizle" → URL ve depo boş |
| — | **Fırsat alanları:** kort sayısı 0–999 tam sayı, model ≤ 64, beklenen kapanış gerçek takvim günü, metinler ≤ 200 / not ≤ 4000; boş değer temizler; yalnız verilen alan değişir | `parseLeadFields` (saf), `UpdateLeadFields`, `PATCH /leads/:id` | `opportunity.test.ts` "parseLeadFields…" (2026-02-30 reddedilir); `application.test.ts` (kısmi güncelleme, temizleme, boş gövde); `api.test.ts` (200/403/403/422/404) |
| — | **Yetki:** sahibi, havuzdan erişen satışçı, admin düzenler; görüntüleyici ve başka satışçı 403; aşama ve sorumlu bu komutla değişmez | `loadActionableLead` (aktivitelerle ortak) | `application.test.ts` `lead.forbidden`, `not_found`; `api.test.ts` viewer/rep2 403 |
| — | `expected_close_date` **gün kaymaz:** `date` sütunu `::text` okunur | `repositories.ts` `LEAD_SELECT` | `infrastructure.test.ts` "tarih günü kaymaz" (2026-12-31 aynen döner) |
| — | Eski veri: `db:migrate-legacy` fırsatların `court_count`/`court_model`'ini sütuna yazar, ürün ilgisi artık "· N kort" eki taşımaz | `bootstrap/migrateLegacy.ts` | `migrateLegacy.test.ts` (d1: 2 / Panoramik, l1: 2) |

## Test planı ve çıktı

```
npm run verify (2026-11-02, üç görev sonrası)
  lint 0 hata · 11 önceden var olan uyarı · Prettier temiz · tsc (iki proje) temiz
  · depcruise 0 ihlal (1 bilgi: server/authDb.d.mts orphan) · secretlint temiz
  · 36 test dosyası / 370 test yeşil (6a sonu: 35 / 353)
```

Yeni ve güncellenen testler: `domain/opportunity.test.ts` (10 test), `application.test.ts` "Fırsat alanları ve pano (Faz 6b)"
(4 test), `api.test.ts` "fırsat alanları ve pano (Faz 6b)" (2 test), `infrastructure.test.ts` (+1), `migrate.test.ts`
(10 migration, sütun kontrolü), `migrateLegacy.test.ts` sütun beklentileri.

## Tarayıcı doğrulaması (yerel PGlite, `crm-test-login`, satışçı hesabı)

| Adım | Görülen |
|---|---|
| `#/pipeline` | "Pano · 6 lead"; kolon başlıklarında "ort. 4 gün", Teklif gönderildi "€95K · ort. 6 gün" |
| Takipsiz chip | URL `#/pipeline?rotting=1`, "Pano · 5 lead", Teklif kolonu 0; sunucu yanıtı 5 lead (doğrudan istek) |
| `#/inbox` → `#/pipeline` | URL kendiliğinden `?rotting=1` oldu (hatırlama); "Filtreleri temizle" URL'yi ve depoyu boşalttı |
| Lead detayı → Düzenle | Kort 4, model Panoramik, kapanış 2026-10-15, ürün metni → Kaydet → `PATCH` 200; detayda "4 kort · Panoramik · 15 Eki 2026 · 18 gün önce · €95.000 · Bu aşamada 0 gündür" |
| Kart | "4 kort · €95K · 18 gün önce (turuncu, geçmiş kapanış)"; altta "yarın" (teklif takibi) |
| Yeni lead | Formda Kort sayısı · Kort modeli · Beklenen kapanış satırı |

Konsolda bu oturuma ait hata yok (görülen kayıtlar sunucu yeniden başlamadan önceki HMR artıkları).

## Kabul kriterleri (yol haritası, 6b)

| Kriter | Doğrulama |
|---|---|
| Kolon istatistikleri saf fonksiyon + test | `columnStats` / `stageSummary` / `toEur` `domain/opportunity.ts` içinde, I/O yok; `opportunity.test.ts` |
| Filtre URL'de | `#/pipeline?owner=…&country=…&rotting=1`; tarayıcı adımları yukarıda |
| Fırsat alanları lead formu ve detayda | NewLeadDialog üç alan; LeadPage "Düzenle" paneli; API testleri |
| Sorumlu · ülke · takipsiz filtreleri yerelde hatırlanır | `boardFilter.ts` `rememberFilter`/`recallFilter`; tarayıcı adımı |

## Bitti tanımı (Genel plan) — bu faz

- [x] İş kuralı saf ve testli (`opportunity.ts`)
- [x] Dış bağımlılık port arkasında (`updateFields`, `listByLeads`; bellek içi sahte + Postgres)
- [x] Tek transaction: alan güncellemesi tek `UPDATE`; pano sorgusu tek `uow.run`
- [x] Logda kişisel veri yok (alan güncelleme logu yalnız lead kimliği ve alan adları)
- [x] Config ve secret kodda değil (`EUR_RATES` ortamdan; varsayılan modülde)
- [x] Arayüz metinleri TR ve EN (`board.*`, `lead.*`, `err.lead.*`)
- [x] ADR güncellendi (ADR-0013 eki)
- [x] Sözlük testi geçti

## Bilinen eksikler ve sonraki adımlar

1. **Kurlar elle güncellenir** (`EUR_RATES`); Faz 7 yönetim panelinde ekrandan düzenlenecek (`decisions.md` 24).
2. **E-posta ve telefon** detayda düzenlenmez; kişi eşleştirme kuralına dokunduğu için 6d'de Kişiler sayfasıyla gelir.
3. Ülke filtresi tüm ülke listesini gösterir; verideki ülkelere daraltma 6c raporlarıyla birlikte değerlendirilir.
4. Kolon "ort. gün" sunucu saatine göre tam gün; karttaki "N gündür" tarayıcı saatine göre. Aynı anda farklı
   saat diliminde bakan kullanıcıda bir gün fark görülebilir (6a raporundaki saat dilimi notuyla aynı).
5. **6c:** raporlar yeni aşama olaylarından; **6d:** `organizations` + `organization_id`, Kişiler sayfası, eski sayfaların
   kaldırılması, `db:migrate-legacy` aktiviteler ve kuruluşlar.
