# ADR-0007: Kod kalitesi araçları — lint, format, test, mimari test, secret tarayıcı, CI

- Durum: Kabul edildi
- Tarih: 2026-10-27
- Karar verenler: Yazılım (Elshan)

## Bağlam

Genel plan CI kuralları: her PR'da lint, format, tip kontrolü ve tüm testler; domain katmanı framework import ederse build kırılır; koda token girerse build kırılır; PR başına ~400 satır. Depoda bugün yalnız `tsc --noEmit` var.

## Karar

| Görev | Araç | Komut |
|---|---|---|
| Lint | ESLint 9 (flat config) + typescript-eslint | `npm run lint` |
| Format | Prettier | `npm run format:check` / `npm run format` |
| Tip kontrolü | `tsc --noEmit`, iki proje (arayüz, modüller) | `npm run typecheck` |
| Birim / sözleşme testi | Vitest | `npm run test` |
| Mimari test | dependency-cruiser (katman ve modül sınırı) + Vitest sözlük testi (`sales-pipeline` içinde "meta"/"google" geçmez) | `npm run arch` |
| Secret tarayıcı | secretlint (önerilen kural seti) | `npm run secrets` |
| Hepsi birden | | `npm run verify` — `npm run build` önce bunu çalıştırır |
| CI | GitHub Actions, Node 22, `npm ci` + `verify` + `build` | `.github/workflows/ci.yml` |

Mimari kurallar (dependency-cruiser):

1. `src/modules/*/domain` hiçbir npm paketi, Node çekirdek modülü veya üst katman (`application`, `infrastructure`, `api`, `adapters`) import etmez. Yalnız kendi domain'i ve `shared/kernel`, `shared/normalization`.
2. `application` → `infrastructure`, `api`, `adapters` import etmez (portlar domain'de, uygulamalar enjekte edilir).
3. Modül X → modül Y yalnız `Y/application` üzerinden; `Y/domain`, `Y/infrastructure`, `Y/api`, `Y/adapters` yasak.
4. `shared/*` hiçbir modülü import etmez.
5. Döngüsel bağımlılık yok.

## Seçenekler ve neden seçilmediği

- **Biome (lint + format tek araç):** Hızlı; ama typescript-eslint kadar kural yok ve `no-restricted-imports` türü mimari kurallar zayıf. ESLint + Prettier ekip dışı katkıcı için de tanıdık.
- **Jest:** Vitest Vite yapılandırmasını paylaşır, ESM'de sorunsuz, daha hızlı.
- **ArchUnit benzeri (ts-arch):** dependency-cruiser aynı işi görür ve grafik çıkarır.
- **gitleaks:** Daha güçlü tarayıcı, ancak GitHub Action sürümü kurumsal hesaplarda lisans ister ve yerelde ikili dosya kurulumu gerekir. secretlint npm paketidir, yerelde ve CI'da aynı çalışır. Depo kurumsal GitHub'a taşınırsa gitleaks ek adım olarak eklenebilir.

## Sonuçlar

- Mevcut arayüz kodu lint kapsamındadır; Faz 0'da yalnız kural ihlali sıfırlanana kadar gereken en küçük düzeltme yapılır, davranış değişmez.
- Format kuralı: 2 boşluk, çift tırnak, 120 sütun. Mevcut kod bu kurala göre bir kez biçimlendirilir (ayrı commit).
- PR şablonu "Bitti tanımı" listesini taşır.
