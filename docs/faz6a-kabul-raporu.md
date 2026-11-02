# Faz 6a — Satış panosu: aktiviteler, otomatik takip, takipsiz, "Bugün": kabul raporu

Tarih: 2026-11-02. Kapsam: `docs/yol-haritasi.md` bölüm 6, Faz 6a. Kararlar bölüm 8 (Elshan, 2026-11-02): altı aşama
kalır, kuruluş ayrı kayıt (6d'de), hosting kararı bekliyor. Veri modeli kararı ADR-0013.

## Görevler ve commit'ler

| Görev | Nerede | Durum |
|---|---|---|
| `activities` tablosu, alan kuralları (takipsiz, 3 gün sonra 09:00 takip, kova hesabı, doğrulama), port ve depolar | `db/migrations/0009_faz6a_activities.sql`, `sales-pipeline/domain/activity.ts`, `ports.ts`, `infrastructure/activityRepository.ts`, `application/fakes.ts` | Tamam |
| Komutlar ve sorgular: `AddActivity`, `SetActivityDone`, `DeleteActivity`, `ActivityQueries.today`; `ChangeLeadStage` PROPOSAL'da takip açar, `UndoStageChange` siler; liste ve detayda aktivite özeti | `sales-pipeline/application/*`, `api/router.ts`, `api/dto.ts` | Tamam |
| Arayüz: "Bugün" sayfası, lead detayında aktivite paneli ve ekleme formu, Kanban kartında sonraki aktivite / "Takipsiz" rozeti, üst menü rozeti; eski JSON sayfası kaldırıldı | `src/pipeline/ActivitiesPage.tsx`, `activityBits.tsx`, `LeadPage.tsx`, `KanbanPage.tsx`, `Header.tsx`, `App.tsx`, `i18n` | Tamam |
| Belgeler: ADR-0013, README Faz 6a bölümü, yol haritası durumu, bu rapor | `docs/` | Tamam |

Commit kimlikleri: `git log --oneline 2606cbd..HEAD`.

## Davranış kuralları (yol haritası bölüm 4) ve doğrulama

| # | Kural | Nerede uygulanır | Test |
|---|---|---|---|
| 1 | Açık aşamadaki lead'in açık aktivitesi yoksa **takipsiz**; terminal aşama asla | `isRotting`, `summarizeActivities` (saf); `LeadQueries.list/get` özet ekler | `activity.test.ts` "kural 1"; `application.test.ts` "kural 1: …"; `api.test.ts` "yeni lead takipsiz…" (`rotting: true` → aktivite sonrası `false`) |
| 2 | **Teklif gönderildi**'ye giriş 3 gün sonra 09:00 (Europe/Istanbul) arama açar; aynı `changeId`; **geri al** onu siler, elle açılanı bırakır | `followUpFor`, `atLocalHour` (saf); `ChangeLeadStage` aynı transaction; `UndoStageChange.removeAutoCreatedByChange` | `activity.test.ts` "kural 2"; `application.test.ts` "kural 2: …" ve "geri al yalnız otomatik…"; `api.test.ts` "Teklif gönderildi takip aktivitesi açar…" |
| 3 | Kaybedildi neden ister | Faz 1 (değişmedi) | Mevcut testler |
| 5 | Gelen kutusundaki kayıt tek tıkla panoya | Faz 1 "Üstlen" + "Sonraki aşama" (değişmedi) | — |
| — | "Bugün": gecikmiş / bugün / yaklaşan **takvim gününe** göre; satışçı yalnız görebildiği lead'lerin işlerini görür | `bucketOf`, `ActivityQueries.today` | `activity.test.ts` "bucketOf…"; `application.test.ts` "Bugün: …" (rep ve admin); `api.test.ts` `GET /activities/today` (rep2 boş) |
| — | Yetki: aktiviteyi lead'in sahibi ya da havuzdan erişen satışçı ve admin yönetir; görüntüleyici yazamaz | `visibleLead` (`canAct`), router `actor(req, res, true)` | `application.test.ts` `lead.forbidden`; `api.test.ts` 403 (viewer, rep2), 404, 422 |

Kural 4 (kolon istatistikleri) ve filtreler 6b'de.

## Test planı ve çıktı

```
npm run verify (2026-11-02)
  lint 0 hata · Prettier temiz · tsc (iki proje) temiz · depcruise 0 ihlal (1 bilgi: server/authDb.d.mts orphan)
  · secretlint temiz · 35 test dosyası / 353 test yeşil
```

Yeni ve güncellenen testler: `domain/activity.test.ts` (takvim ve saat dilimi, kural 1, kural 2, doğrulama),
`application/application.test.ts` "Aktiviteler (Faz 6a)" (6 test), `api/api.test.ts` "aktiviteler (Faz 6a)" (3 test),
`infrastructure.test.ts` (detayda özet ve boş aktivite listesi), `shared/db/migrate.test.ts` (9 migration, 16 tablo),
`outbox.test.ts` ve `infrastructure.test.ts` TRUNCATE listesine `activities`.

## Kabul kriterleri (iş emri)

| Kriter | Doğrulama |
|---|---|
| Takipsiz kuralı seed/mevcut veride görünür | Yerel PGlite verisinde aktivitesi olmayan her açık lead kartta kırmızı "Takipsiz" rozeti taşıyor (ekran: Pano, 2026-11-02 13:16). Yeni lead'ler varsayılan olarak takipsizdir; ilk aktiviteyle rozet kalkar |
| Teklif gönderildi → 3 gün sonra otomatik takip | Yerel akış: lead PROPOSAL'a taşındı → zaman çizelgesinde Teklif gönderildi, toast "Takip araması 3 gün sonrası 09:00 için planlandı"; `api.test.ts` `followUp.autoCreated = true` |
| "Bugün" üç kümede, tek tıkla tamamlama | Ekran: `#/activities` → "Gecikmiş 0 · Bugün 0 · Yaklaşan 1", satırda lead adı/firması ve tarih; onay kutusu `setActivityDone` çağırır (API testi `doneAt` dolu/boş) |
| Lead detayında aktivite ekleme | Ekran: "Aktivite ekle" → tür, tarih-saat (varsayılan yarın 09:00), konu, not → "Planla" → liste ve toast; Kanban kartında "yarın" rozeti |
| Hiçbir aktivite aşamayı değiştirmez | Aktivite komutları `leads.updateStage` çağırmaz; aşama yalnız `ChangeLeadStage` (kod incelemesi; `application.test.ts` aşama değişmeden aktivite ekler/tamamlar) |
| Mimari: aktivite kodu platform adı içermez; modüller arası sınır korunur | Sözlük testi ve depcruise `npm run verify` içinde yeşil |

## Bitti tanımı (Genel plan) — bu faz

- [x] İş kuralı saf ve testli (`activity.ts`: takipsiz, takip, kova, doğrulama; saat dilimi hesabı)
- [x] Dış bağımlılık port arkasında (`ActivityRepository`; bellek içi sahte + Postgres uygulaması)
- [x] Tek transaction: takip aktivitesi aşama olaylarıyla birlikte yazılır, geri al birlikte siler
- [x] Logda kişisel veri yok (aktivite logu yalnız kimlikler ve tür)
- [x] Config ve secret kodda değil (saat dilimi `UseCaseDeps.timeZone`, varsayılan Europe/Istanbul)
- [x] Arayüz metinleri TR ve EN (`activity.*`, `today.*`, `err.activity.*`)
- [x] ADR yazıldı (ADR-0013)
- [x] Sözlük testi geçti

## Bilinen eksikler ve sonraki adımlar

1. **6b:** fırsat alanları (`court_count`, `court_model`, `expected_close_date`, `organization_id`), kolon
   başlığında adet / toplam EUR / ort. gün, sorumlu · ülke · takipsiz filtreleri.
2. **6c:** raporlar yeni aşama olaylarından; **6d:** kuruluşlar ve kişiler sayfası, eski `src/pages/*`, `/api/db/*`,
   `crm.json` kaldırılır; `db:migrate-legacy` eski 28 aktiviteyi ve 15 kuruluşu taşır.
3. "Bugün" sayfası tamamlananları listelemez (yalnız açık işler); detay sayfasında "Tamamlananlar" katlanır listede.
4. Takip aktivitesinin konusu ("Teklif takibi") veride Türkçe tutulur; EN arayüzde konu değişmez (tür etiketi çevrilir).
5. Takvim günü hesabı sunucuda Europe/Istanbul, tarayıcıda yerel saat; farklı saat diliminde çalışan kullanıcı için
   kova sınırı birkaç saat kayabilir (6b'de kullanıcı saat dilimi ayarı değerlendirilir).
