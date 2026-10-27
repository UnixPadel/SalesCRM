# ADR-0001: Teknoloji yığını — TypeScript, Node 22, modüler monolit

- Durum: Kabul edildi
- Tarih: 2026-10-27
- Karar verenler: Yazılım (Elshan)

## Bağlam

Mevcut depo React 18 + Vite arayüz ve Express 5 sunucudan oluşuyor. Arayüz TypeScript, sunucu (`server/*.mjs`) düz JavaScript. Genel plan domain katmanının framework import etmemesini, her dış sistemin bir port arkasında olmasını ve bunun mimari testle korunmasını istiyor. Tip bilgisi olmadan port/adaptör sınırı ve değer nesneleri (Email, PhoneNumber, Money…) güvenilir kurulamaz.

## Karar

- Dil: her yerde TypeScript (`strict`). Yeni modüller `src/modules/` altında TypeScript olarak yazılır. Mevcut `server/*.mjs` Faz 1'de TypeScript'e taşınır; o zamana kadar lint kapsamında kalır.
- Çalışma zamanı: Node 22 LTS (`engines` alanı ve `.nvmrc` ile sabit). HTTP: Express 5 (mevcut). Arayüz: React 18 + Vite (mevcut).
- Mimari: tek depo, tek dağıtım birimi, **modüler monolit**. Modüller Genel plan'daki gibi: `sales-pipeline`, `lead-intake`, `ad-feedback`, `integration-settings`, `shared`. Modüller birbirine yalnız `application/` katmanı üzerinden erişir; sınır `dependency-cruiser` ile zorlanır (ADR-0007).
- Katmanlar modül içinde: `domain/` (saf kod), `application/`, `infrastructure/`, `api/` veya `adapters/`.

## Seçenekler ve neden seçilmediği

- **Ayrı mikroservis (webhook karşılama servisi ayrı süreç):** Ekip küçük, hacim düşük (ayda yüzlerce lead). İki dağıtım birimi, iki secret seti ve ağ sınırı gereksiz yük. Ters proxy'de yalnız `/webhooks/*` ve `/forms/*` yollarını açmak aynı güvenlik etkisini verir (ADR-0005).
- **NestJS gibi tam çerçeve:** Modül sınırlarını dekoratörlerle verir ama Express 5 üzerine kurulu mevcut sunucuyu yeniden yazmayı gerektirir. Aynı sınır `dependency-cruiser` ile sıfır çerçeve maliyetiyle korunur.
- **Sunucuyu JavaScript bırakmak:** Mimari test ve port arayüzleri tipsiz zayıf kalır; "ham string dolaşmaz" kuralı uygulanamaz.

## Sonuçlar

- `tsconfig` ikiye ayrılır: arayüz (DOM) ve modüller/sunucu (Node).
- Faz 1'de `server/index.mjs` içindeki uç noktalar `sales-pipeline/api` altına TypeScript olarak taşınır; bu ADR o taşımayı kapsar, ayrı karar gerekmez.
- JavaScript `number` Meta lead kimliğini (15–17 hane) bozar; `PlatformLeadId` değer nesnesi `string` tutar, serileştirme adaptörde yapılır.
