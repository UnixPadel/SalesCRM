# Faz 1 — Çekirdek ve satışçı arayüzü: kabul raporu

Tarih: 2026-10-28. Kapsam: Faz 1 iş emri (veri ve domain, arayüz, test). Kapsam dışı bırakılanlar: webhook uçları, Meta/Google çağrıları, dağıtıcı, admin ve rapor ekranları.

## Görevler ve commit'ler

| Görev | Commit | Durum |
|---|---|---|
| Migration'lar (10 tablo) ve seed (aşamalar, kayıp nedenleri; ülke kuralları boş) | `db:` | Tamam — `db/migrations/0001`, `0002` |
| Değer nesneleri: Email, PhoneNumber (E.164), Money, StageCode, PlatformLeadId | `kernel:`, `normalization:`, `domain:` | Tamam |
| `ChangeLeadStage`: yalnız ileri, atlanan `auto_fill`, WON tutar, LOST neden | `domain:`, `application:` | Tamam |
| 10 dakikalık geri al | `domain:` (planUndo), `application:` | Tamam |
| Tek transaction: current_stage + olay + platform başına outbox | `application:`, `infrastructure:` | Tamam — sahte platformlarla testli |
| `CreateLead` (manuel), `AssignLead`, ülke kuralıyla otomatik atama | `application:` | Tamam |
| Normalize e-posta / telefonla mükerrer kişi | `application:` | Tamam |
| Domain olayları LeadCreated, LeadStageChanged, LeadAssigned (+ LeadStageChangeUndone) | `domain:` | Tamam — yayıncı Faz 1'de yalnız loglar |
| API: liste, detay, aşama değiştir, geri al, `allowedTransitions` (+ assign, reference) | `api:` | Tamam |
| Gelen kutusu: kaynak rozeti, ülke, "geleli" sayacı, 1 sa / 24 sa renkleri | `ui:` | Tamam |
| Lead detayı ve zaman çizelgesi | `ui:` | Tamam |
| "Sonraki aşama" ve aşamaya özel pencereler | `ui:` | Tamam |
| Geri al düğmesi (sayaçlı) | `ui:` | Tamam |
| Kanban; geriye sürükleme engellenir ve nedeni gösterilir | `ui:` | Tamam |
| Manuel lead ekleme formu | `ui:` | Tamam |
| TR / EN metinler, telefonda tam kullanım | `ui:` | Tamam — 375px'te doğrulandı |
| Eski JSON veri → Postgres taşıma betiği | `legacy:` | Tamam — kuru çalıştırma: 960 + 15 kayıt, 0 atlanan |

## Kabul kriterleri ve doğrulama

### 1. Geçiş matrisi testleri yeşil; domain ve application kodunda %90 satır kapsamı

**Doğrulandı.** `src/modules/sales-pipeline/domain/stage.test.ts` 6 × 6 = 36 hücreyi tek tek test eder (`canTransition`) ve `allowedTransitions` listesini matrisle karşılaştırır; `transition.test.ts` ek bilgi kurallarını (WON tutar, LOST neden, QUALIFIED üç soru, auto_fill) kapsar.

```
$ npm run test:coverage
Test Files  11 passed (11)      Tests  151 passed (151)
Statements : 99.64% ( 564/566 )   Branches : 94.62%   Functions : 100%   Lines : 99.64% ( 564/566 )
 domain       100 % satır        application  99.51 % satır
```

Eşik `vitest.config.ts` içinde (satır, ifade, fonksiyon ≥ %90); CI adımı `Coverage threshold`. Tip/port/olay dosyaları (`types.ts`, `ports.ts`, `events.ts`), `index.ts` ve sahte uygulamalar ölçüm dışı.

### 2. Mimari test: domain katmanında framework veya altyapı import'u yok

**Doğrulandı.** `npm run arch` → `✔ no dependency violations found (131 modules, 408 dependencies cruised)`. Kurallar: domain yalnız kendi domain'ini ve `shared/kernel`, `shared/normalization` görür; domain ve application `shared/db` import edemez; modüller arası erişim yalnız `application`; `src/bootstrap` yalnız sunucu ve testlerden. Sözlük testi (`tests/architecture`) çekirdekte platform adı olmadığını doğrular.

### 3. Satış ekibinden en az iki kişi staging'de 20 manuel test lead'iyle akışı denedi; geri bildirimleri işlendi

**Yapılamadı.** Staging ortamı yok; hosting kararı (ADR-0005) bekliyor. Bu kriter Faz 1'i yazılım tarafında kapatmaz, satış + IT'ye bağlıdır. Yerine yazılım tarafında yapılan: tarayıcıda uçtan uca el testi (aşağıda). Staging açıldığında yapılacak: `npm run db:migrate` → `npm run db:migrate-legacy` (önce `--dry-run`) → iki satışçıya giriş → 20 test lead'i (`isTest` işaretli) → geri bildirim.

## Test planındaki maddeler

| Madde | Nerede | Sonuç |
|---|---|---|
| Aşama motorunun 6 × 6 geçiş matrisi | `domain/stage.test.ts` | 49 test yeşil |
| Değer nesneleri ve normalleştirme | `shared/kernel/kernel.test.ts`, `shared/normalization/normalization.test.ts` | 38 test yeşil (TR, GB, DE, US telefon örnekleri) |
| Entegrasyon: aşama değişikliği → olay + outbox aynı transaction'da; hata olunca hiçbiri yazılmıyor | `infrastructure/infrastructure.test.ts` (PGlite, gerçek migration'lar; trigger ile üretilen DB hatası) ve `application/application.test.ts` (sahte UoW) | 8 + 17 test yeşil |
| API sözleşmesi | `api/api.test.ts` (gerçek Express + PGlite) | 9 test yeşil |
| Uçtan uca: gelen kutusundan aşama değiştirme en fazla iki tık | Tarayıcıda el testi | Gelen kutusu → lead (1 tık) → "Sonraki aşama" (1 tık) = CONTACTED. Nitelikli / Kazanıldı / Kaybedildi: 1 tık + pencere onayı. |

## Tarayıcıda el testi (2026-10-28, yerel, dev girişi)

1. Giriş → Gelen kutusu listelendi (kaynak rozeti, ülke, aşama, sorumlu, "geleli").
2. "Yeni lead" → form → kayıt; telefon `0532 987 65 43` → `+905329876543`, ülke TR; detay sayfası açıldı, zaman çizelgesinde "Yeni lead".
3. "Başka aşama → Nitelikli" → üç soru penceresi → üçü "evet" → aşama Nitelikli; çizelgede "İletişim kuruldu (otomatik)" ve "Nitelikli"; "Geri al (9:58)" düğmesi ve bildirimde "Geri al".
4. "Geri al" → aşama Yeni lead; olaylar silinmedi, "geri alındı" etiketiyle üstü çizili.
5. Pano: 6 sütun. Kartı 1 → 2 sürükleme: aşama İletişim kuruldu. 2 → 1 sürükleme: sütun kırmızı, bırakınca "Aşama geriye alınmaz. Yanlış tık için 10 dakika içinde \"Geri al\" kullanın." (sürükleme olayları DragEvent ile tetiklendi).
6. Dil: kullanıcı menüsünden İngilizce → tüm metinler ve aşama adları İngilizce; geri Türkçe.
7. Telefon (375 × 812): gelen kutusu kart düzeni, lead sayfası tek sütun ve tam genişlik düğmeler, Pano yatay kaydırmalı sütunlar; başlık sığıyor.

Bilinen küçük nokta: dev girişi (`CRM_DEV_PASSWORD`) kullanıcı kimliği olarak giriş adını verir ("elshan"); gerçek girişte kimlik `KullaniciID`'dir (tabloda okundu, 22 kayıt). Atama listesi gerçek kimlikleri gösterir.

## Bitti tanımı (Genel plan) — bu faz

- [x] İş kuralı domain katmanında ve testli (`domain/*.test.ts`)
- [x] Dış çağrı bir port arkasında, sahte uygulamayla testli (`application/fakes.ts`; Postgres adaptörleri ayrıca PGlite ile)
- [x] Logda kişisel veri yok (`shared/kernel/logger.ts` maskeler; API hata logu e-posta/telefonu maskeler)
- [x] Hata türü sınıflandırılmış (RuleError / TransientError / PermanentError; API 422 / 403 / 404 / 500)
- [x] Config ve secret kodda değil (`loadConfig`, `.env.example` yer tutucu)
- [x] Arayüz metinleri TR ve EN (`src/i18n`)
- [x] ADR yazıldı (ADR-0008; ADR-0006 güncellendi)

## Bilinen eksikler ve sonraki adımlar

1. **Staging ve satışçı testi** (kabul kriteri 3) hosting kararına bağlı.
2. **Eski sayfalar** (Bugün, Kişiler, Raporlar, eski form listesi `#/leads`) hâlâ JSON veriyle çalışıyor; raporlar yeni aşama modeline Faz 6'da taşınacak. Eski "Pano" sayfası (`src/pages/PipelinePage.tsx`) artık menüde değil, kod duruyor; Faz 2'de silinebilir.
3. **Bildirimler** (atanan satışçıya uygulama içi ve e-posta) domain olaylarına abone olacak; Faz 2 kapsamı. Olay yayıncısı şimdilik loglar.
4. **Seed varsayılanları** (aşama adları, üç soru, kayıp nedenleri) satış onayı bekliyor; onay yeni bir migration ile uygulanır.
5. **Ülke → satışçı tablosu boş**; dolana kadar reklam kaynaklı lead'ler havuza düşer, elle açılan lead'ler açan satışçıya atanır.
6. **Sunucu hâlâ `server/index.mjs`** (JavaScript); pipeline uçları TypeScript modülünden geliyor. Kalan sunucu kodunun TypeScript'e taşınması ADR-0001'e göre sonraki fazlarda.
7. PR boyutu: arayüz commit'i ~400 satır sınırını aşıyor (tek commit'te 10 dosya); bölünmesi gerekirse `src/pipeline` sayfa başına ayrılabilir.
