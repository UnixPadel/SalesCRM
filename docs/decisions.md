# Açık kararlar — Faz 0

Genel plan'daki sekiz karar. İlk ikisi verilmeden Faz 1'e başlanmaz. Durum: **Bekliyor** · **Verildi** · **Kısmen**.

| # | Karar | Sahip | Durum | Nerede / not |
|---|---|---|---|---|
| 1 | Hesap sahipliği: Meta uygulaması, sistem kullanıcısı, CRM veri seti, Google Cloud projesi Unixpadel hesaplarında | Yönetim + MarcaDM | Bekliyor | Kontrol listesi aşağıda |
| 2 | Hacim ölçümü: son 3 ayın aylık Meta ve Google lead sayısı; lead → nitelikli ve lead → teklif medyan süreleri | MarcaDM + Satış | Kısmen | Mevcut CRM verisinden ön sayım aşağıda; MarcaDM kaynak doğrulaması bekliyor |
| 3 | Hosting ve webhook girişi | Yazılım + IT | Bekliyor | [ADR-0005](adr/0005-hosting-ve-webhook-girisi.md) |
| 4 | Teknoloji yığını ve secret deposu | Yazılım | Verildi | [ADR-0001](adr/0001-teknoloji-yigini.md), [ADR-0002](adr/0002-veritabani.md), [ADR-0003](adr/0003-kuyruk-ve-outbox.md), [ADR-0004](adr/0004-secret-deposu.md) |
| 5 | Aşama adları (TR/EN) ve "Nitelikli" için üç soru | Satış + MarcaDM | Bekliyor | [ADR-0006](adr/0006-asama-modeli-gecisi.md); öneri: bütçe onaylı mı, proje yeri belli mi, kurulum 12 ay içinde mi |
| 6 | KVKK ve GDPR görüşü: hash'li verinin yurt dışına aktarımı, onay metni, saklama süreleri | Hukuk | Bekliyor | Sorular aşağıda |
| 7 | Optimizasyon olayı (Meta ve Google'da hangi aşama) | MarcaDM | Bekliyor | 2 numaralı ölçüme bağlı |
| 8 | Ülke → sorumlu ve yedek satışçı tablosu | Satış | Bekliyor | `territory_rules` tablosunu doldurur; şablon aşağıda |

## 1 — Hesap sahipliği kontrol listesi

- [ ] Unixpadel Business Manager'da "Business" tipi Meta uygulaması; MarcaDM'e yalnız rol bazlı erişim
- [ ] Sistem kullanıcısı; Unixpadel sayfası ve reklam hesabı atanmış (token Faz 2'de)
- [ ] Events Manager'da CRM veri seti Unixpadel hesabında
- [ ] Google Cloud projesi Unixpadel hesabında
- [ ] Google Ads'te gelişmiş dönüşümler açık, müşteri verisi şartları kabul edilmiş
- [ ] Meta App Review gerekli mi, netleşti; gerekiyorsa başvuru Faz 2 sonuna planlı
- [ ] **Uyarı (Meta):** entegrasyondan sonra veri seti / pixel değişirse model eğitimi sıfırlanır. Veri seti bir kez açılır, ajans değişse de kalır.

## 2 — Hacim ön sayımı (mevcut CRM verisi, 2026-10-27)

Kaynak: `server/data/crm.json`, 960 lead; 955'i form kampanyası dışa aktarımından, kaynak etiketi "instagram". Bunların Meta Instant Form lead'i olup olmadığını MarcaDM doğrulamalı.

| Ay | Lead |
|---|---|
| 2026-05 | 294 |
| 2026-06 | 241 |
| 2026-07 | 178 |
| 2026-08 | 91 |
| 2026-09 | 134 |
| 2026-10 (kısmi) | 22 |

Son üç tam ay ortalaması ≈ 134/ay; Meta'nın Dönüşüm Lead'leri eşiği (200–250/ay) altında. Google lead formu sayısı bilinmiyor. Aşama süreleri için yalnız 15 fırsat var; medyan hesaplanamaz. Faz 1'den sonra `lead_stage_events` tablosu bu ölçümü verir.

## 6 — Hukuka sorular

1. Hash'lenmiş e-posta/telefonun Meta ve Google'a gönderimi yurt dışına aktarım sayılır mı; açık onay mı, meşru menfaat mi?
2. Onay metni sürümü lead'le birlikte saklanacak; form onay kutusu metni kim yazar?
3. Saklama süresi: ham webhook payload'ı 30 gün, lead kaydı ne kadar?
4. AB ve Birleşik Krallık lead'leri için GDPR değerlendirmesi aynı görüşe eklenir mi?
5. **Mevcut depo:** `src/seed/leads.json` ve `legacy/leads.json` 955 gerçek kişinin ad, e-posta ve telefonunu içeriyor ve sürüm kontrolünde. Bu veri depodan çıkarılmalı mı; çıkarılacaksa geçmiş de temizlenmeli mi? (Yazılım + Hukuk)

## 8 — Ülke → satışçı şablonu

| Ülke (ISO-2) | Sorumlu | Yedek |
|---|---|---|
| TR | | |
| GB | | |
| DE | | |
| … | | |

Satış doldurur; Faz 2'de `territory_rules` tablosuna aktarılır. Eşleşmeyen ülke ortak havuza düşer.
