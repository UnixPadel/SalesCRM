# Faz 0 — Yazılım görevleri kabul raporu

Tarih: 2026-10-27. Kapsam: Faz 0 iş emrindeki **Yazılım** başlığı. Yönetim, MarcaDM, satış ve hukuk görevleri `docs/decisions.md` içinde sahipleriyle bekliyor.

## Görevler ve commit'ler

| Görev | Commit | Durum |
|---|---|---|
| Teknoloji yığını, kuyruk / arka plan altyapısı, secret deposu seçimi; her biri için ADR | `docs: ADR-0001…0007` | Tamam — ADR-0001, 0002, 0003, 0004, 0007 kabul edildi |
| Hosting ve webhook giriş yolu | ADR-0005 | **Bekliyor** — üç seçenek ve karar için gereken bilgi yazıldı; IT kararı gerekli |
| Repo iskeleti: modül klasörleri | `skeleton:` | Tamam — `src/modules/` 5 modül, 19 katman klasörü |
| Lint, format, tip kontrolü | `tooling:` + `style:` | Tamam — ESLint 9, Prettier, iki `tsconfig` |
| Mimari test | `arch:` | Tamam — dependency-cruiser + sözlük testi |
| Secret tarayıcı | `secrets:` | Tamam — secretlint |
| CI | `ci:` | Yazıldı — GitHub Actions; uzak depo olmadığı için **yeşil olduğu GitHub'da görülmedi**, aynı zincir yerelde yeşil |

## Kabul kriterleri ve doğrulama

### 1. "Genel plan"daki sekiz açık karar yazılı ve onaylı

Kısmen. Sekiz karar `docs/decisions.md` tablosunda sahip ve durumla listelendi. Yazılımın verebildiği karar (4: teknoloji yığını ve secret deposu) ADR olarak yazıldı ve kabul edildi. Diğer yedi karar yazılım dışı sahiplerde **bekliyor**; hacim ölçümü (2) için mevcut veriden ön sayım eklendi.

### 2. Meta uygulaması, sistem kullanıcısı, veri seti ve Google Cloud projesi Unixpadel hesaplarında

Yazılım dışı; `docs/decisions.md` bölüm 1'de kontrol listesi olarak bekliyor.

### 3. Boş modül iskeleti üzerinde CI yeşil; domain klasörüne framework import'u eklenince build kırılıyor

**Yerelde doğrulandı.** CI zinciriyle aynı komut:

```
$ npm run verify
> eslint .                     ✖ 11 problems (0 errors, 11 warnings)   ← uyarılar eski arayüz kodunda, ADR-0007
> prettier --check .           All matched files use Prettier code style!
> tsc -p tsconfig.json && tsc -p tsconfig.modules.json      (çıktı yok = temiz)
> depcruise …                  ✔ no dependency violations found (67 modules, 165 dependencies cruised)
> secretlint "**/*"            (çıktı yok = temiz)
> vitest run                   Test Files 1 passed · Tests 3 passed
verify exit: 0

$ npm run build:only
✓ built in 1.03s
```

Kırılma kanıtı: `src/modules/sales-pipeline/domain/index.ts` dosyasına kasıtlı olarak şu satırlar eklendi, sonra geri alındı:

```ts
import express from "express";
import { createHash } from "node:crypto";
import {} from "../infrastructure/index";
```

```
$ npm run arch
  error domain-only-own-domain-and-shared: …/domain/index.ts → …/infrastructure/index.ts
  error domain-no-outer-layer:             …/domain/index.ts → …/infrastructure/index.ts
  error domain-no-external:                …/domain/index.ts → node_modules/express/index.js
  error domain-no-external:                …/domain/index.ts → crypto
x 4 dependency violations (4 errors, 0 warnings)
arch exit: 4

$ npm run build          ← verify zinciri arch adımında durdu
build exit: 4

(geri alındıktan sonra)
$ npm run arch
✔ no dependency violations found
```

Secret tarayıcı kanıtı: `src/modules/shared/kernel/leak.ts` içine sahte bir GitHub token yazıldı, sonra silindi:

```
$ npm run secrets
  1:22  error  [GITHUB_TOKEN] found GitHub Token   @secretlint/secretlint-rule-github
✖ 1 problem (1 error)
exit 1
```

Ayrıca `.env.example` içindeki yer tutucu bağlantı adresleri ilk taramada yakalandı ve biçim tetiklemeyecek şekilde yeniden yazıldı; bu, tarayıcının veritabanı bağlantı dizgilerini de gördüğünü gösterir.

## Bitti tanımı (bu faz için uygulananlar)

- İş kuralı domain katmanında ve testli — bu fazda iş kuralı yok (kapsam dışı).
- Dış çağrı port arkasında — bu fazda dış çağrı yok.
- Logda kişisel veri yok — yeni log yok; kural ADR-0004'te, logger Faz 1'de `shared/kernel`.
- Hata türü sınıflandırılmış — Faz 1 (`shared/kernel` hata tipleri).
- Config ve secret kodda değil — `.env.example` temizlendi, `process.env` modüllerde lint ile yasak, secretlint zincirde.
- Arayüz metinleri TR ve EN — arayüz değişikliği yok.
- ADR yazıldı — 7 ADR.

## Bilinen eksikler ve notlar

1. **GitHub uzak deposu yok.** CI iş akışı yazıldı ama henüz hiç koşmadı. `git remote add` + `git push` sonrası ilk koşu izlenmeli; `npm ci` kilit dosyasıyla uyumlu (yerelde `npm install` ile üretildi).
2. **Eski kodda 11 lint uyarısı.** React derleyici kuralları (`set-state-in-effect`, `refs`) ve üç küçük kural eski arayüz/sunucu kodunda uyarı seviyesinde; Faz 1'de kod modüllere taşınırken hata seviyesine çıkar (ADR-0007).
3. **Kişisel veri depoda.** `src/seed/leads.json` ve `legacy/leads.json` 955 gerçek kişinin ad, e-posta ve telefonunu içeriyor ve taban commit'inde sürüm kontrolüne girdi. Hukuk + yazılım kararı bekliyor (`docs/decisions.md` bölüm 6, madde 5). Karar "çıkar" olursa geçmiş de yeniden yazılmalı; uzak depoya **push edilmeden önce** karar verilmesi en ucuz yol. **Sonuç (2026-10-28):** push'tan önce çıkarıldı ve geçmiş temizlendi; bkz. `docs/decisions.md` madde 6.5.
4. **Uygulama tarayıcıda çalıştırılmadı.** Değişiklikler yalnız biçim ve araç yapılandırması; `tsc` ve Vite build temiz. Davranış testi için `npm run dev` ile elle kontrol önerilir.
5. **Aşama modeli çelişkisi** (ADR-0006) Faz 1 başlamadan satışla karara bağlanmalı.
