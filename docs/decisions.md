# Açık kararlar — Faz 0

Genel plan'daki sekiz karar. İlk ikisi verilmeden Faz 1'e başlanmaz. Durum: **Bekliyor** · **Verildi** · **Kısmen**.

| # | Karar | Sahip | Durum | Nerede / not |
|---|---|---|---|---|
| 1 | Hesap sahipliği: Meta uygulaması, sistem kullanıcısı, CRM veri seti, Google Cloud projesi Unixpadel hesaplarında | Yönetim + MarcaDM | Bekliyor | Kontrol listesi aşağıda |
| 2 | Hacim ölçümü: son 3 ayın aylık Meta ve Google lead sayısı; lead → nitelikli ve lead → teklif medyan süreleri | MarcaDM + Satış | Kısmen | Mevcut CRM verisinden ön sayım aşağıda; MarcaDM kaynak doğrulaması bekliyor |
| 3 | Hosting ve webhook girişi | Yazılım + IT | Bekliyor | [ADR-0005](adr/0005-hosting-ve-webhook-girisi.md) |
| 4 | Teknoloji yığını ve secret deposu | Yazılım | Verildi | [ADR-0001](adr/0001-teknoloji-yigini.md), [ADR-0002](adr/0002-veritabani.md), [ADR-0003](adr/0003-kuyruk-ve-outbox.md), [ADR-0004](adr/0004-secret-deposu.md) |
| 5 | Aşama adları (TR/EN) ve "Nitelikli" için üç soru | Satış + MarcaDM | Bekliyor (varsayılanla kodlandı) | [ADR-0006](adr/0006-asama-modeli-gecisi.md); Faz 1 seed'i: `db/migrations/0002_faz1_seed.sql`, sorular `src/modules/sales-pipeline/domain/qualification.ts`. Onay gelince yeni migration ile ad/metin değişir. |
| 6 | KVKK ve GDPR görüşü: hash'li verinin yurt dışına aktarımı, onay metni, saklama süreleri | Hukuk | Bekliyor | Sorular aşağıda |
| 7 | Optimizasyon olayı (Meta ve Google'da hangi aşama) | MarcaDM | Bekliyor | 2 numaralı ölçüme bağlı |
| 8 | Ülke → sorumlu ve yedek satışçı tablosu | Satış | Bekliyor | `territory_rules` tablosunu doldurur; şablon aşağıda |

## Faz 2 ile açılan işler (yazılım dışı)

| # | İş | Sahip | Durum | Not |
|---|---|---|---|---|
| 9 | Meta sistem kullanıcısı token'ı ve Lead Erişimi | Yönetim + MarcaDM | Bekliyor | `docs/runbooks/meta-lead-ads.md`; token hosting ortam değişkenine girer |
| 10 | Google lead form webhook anahtarının MarcaDM'e teslimi | IT + MarcaDM | Bekliyor | `docs/runbooks/google-lead-form.md`; güvenli kanal |
| 11 | Bildirim e-postası için SMTP hesabı (gönderen adres, şifre) | IT | Bekliyor | `SMTP_*` değişkenleri; yoksa yalnız uygulama içi bildirim |
| 12 | `INBOX_ENCRYPTION_KEY` üretimi ve yedeği | IT | Bekliyor | ADR-0009; anahtar kaybolursa eski payload okunamaz |

## Faz 3 ile açılan işler (yazılım dışı)

| # | İş | Sahip | Durum | Not |
|---|---|---|---|---|
| 13 | Site teknolojisi ve aktarıcının konuşlandırılması: `integrations/web-form-relay` site sunucusunda çalışır ya da site diline çevrilir | Site ekibi / MarcaDM + Yazılım | Bekliyor | `docs/runbooks/web-form.md` bölüm 2–4; ADR-0010 |
| 14 | `WEB_FORM_HMAC_KEY` üretimi; CRM hosting'e ve site sunucusuna girilmesi | IT | Bekliyor | `npm run secrets:key`; runbook bölüm 1 ve 6 |
| 15 | GTM: `gclid`, `fbclid`, `_fbc`, `_fbp`, UTM değerlerinin 90 gün birinci taraf çerezde tutulması ve form gizli alanlarına yazılması; honeypot alanı `website` | MarcaDM | Bekliyor | runbook bölüm 3; çerez adları farklıysa `RELAY_COOKIE_MAP` |
| 16 | Aydınlatma metni sürümü (`RELAY_CONSENT_TEXT_VERSION`) ve onay kutusu türleri (`consent_kvkk`, `consent_marketing`) | Hukuk + Site ekibi | Bekliyor | madde 6 ile birlikte; `lead_consents.text_version` |

## Faz 4 ile açılan işler (yazılım dışı)

| # | İş | Sahip | Durum | Not |
|---|---|---|---|---|
| 17 | CRM veri seti (dataset) kimliği ve Conversions API token'ının teslimi; `ENABLED_PROVIDERS=meta` | MarcaDM + IT | Bekliyor | `docs/runbooks/meta-capi.md` bölüm 1; veri seti Unixpadel Business Manager'da (madde 1) |
| 18 | Aylık Meta lead hacmi eşiğin altında: MarcaDM'e yazılı bildirim | Yönetim | Bekliyor | Metin aşağıda; akış ölçüm amaçlı açık kalır, kampanya hedefi çevrilmez |
| 19 | Meta olay adlarının onayı (seed `0006`: Yeni Lead, İletişim Kuruldu, Nitelikli Lead, Teklif Gönderildi, Kazanıldı, Kaybedildi; optimizasyon hedefi Nitelikli Lead) | MarcaDM + Satış | Bekliyor (varsayılanla kodlandı) | Değişiklik migration ya da Faz 6 ekranı ile; madde 5 ve 7 ile birlikte |
| 20 | Dead-letter raporu alıcıları (`OUTBOX_REPORT_TO`) ve staging Test Olayları kodu (`META_TEST_EVENT_CODE`) | IT + MarcaDM | Bekliyor | Test kodu yalnız staging; canlıda boş |

### Madde 18 — MarcaDM'e bildirim metni (taslak)

> Konu: Meta Dönüşüm Lead'leri optimizasyonu — hacim durumu
>
> Mevcut CRM verisine göre son üç tam ayın ortalaması yaklaşık 134 Meta lead/ay (docs/decisions.md bölüm 2, 2026-10-27
> sayımı). Meta'nın Dönüşüm Lead'leri optimizasyonu için belirttiği eşik aylık 200–250 nitelikli olaydır; mevcut hacim
> bu eşiğin altındadır. Bu nedenle kampanya hedefinin "Dönüşüm Lead'leri"ne çevrilmesini şimdilik önermiyoruz.
> CRM → Meta olay akışı (Conversions API, CRM olayları) ölçüm amaçlı açık kalacak; her aşama değişikliği `lead_id`,
> `event_source = crm` ve `lead_event_source = Unixpadel CRM` ile Events Manager'daki Unixpadel veri setine gidecek.
> Veri seti CRM kurulum ekranındaki yeterlilik göstergesi eşiğe yaklaştığında hedef değişikliğini birlikte planlayalım.
> MarcaDM'den beklenen: veri seti kimliği ve sistem kullanıcısı token'ının güvenli kanaldan iletilmesi, olay adlarının
> onayı (madde 19) ve kendi lead sayımınızla bu rakamın doğrulanması (madde 2).

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
5. **Mevcut depo:** `src/seed/leads.json` ve `legacy/leads.json` 955 gerçek kişinin ad, e-posta ve telefonunu içeriyor ve sürüm kontrolünde. Bu veri depodan çıkarılmalı mı; çıkarılacaksa geçmiş de temizlenmeli mi? (Yazılım + Hukuk) **Karar 2026-10-28 (Elshan), aynı gün güncellendi:** uzak depoya push'tan önce **çıkarıldı**. `legacy/leads.json` silindi, `src/seed/leads.json` 24 kayıtlık sentetik örnekle değiştirildi (example.com adresleri, uydurma numaralar) ve iki dosyanın eski içeriği `git filter-repo` ile geçmişten temizlendi. Gerçek dışa aktarımlar yalnız `server/data/` (git dışı) altında durur; taşıma betiği `--file` ile oradan okur. Hukuk görüşü yine de bekleniyor (saklama süresi, onay metni).

## 8 — Ülke → satışçı şablonu

| Ülke (ISO-2) | Sorumlu | Yedek |
|---|---|---|
| TR | | |
| GB | | |
| DE | | |
| … | | |

Satış doldurur; `territory_rules` tablosuna SQL ile girilir (`INSERT INTO territory_rules (country_code, assigned_user_id, fallback_user_id) VALUES ('TR', '<KullaniciID>', NULL);`). Eşleşmeyen ülke ortak havuza düşer. Faz 2 gelen lead akışı bu tabloyu kullanır; boşken reklam lead'leri havuza düşer ve kimseye bildirim gitmez.
