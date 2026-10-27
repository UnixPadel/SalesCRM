# ADR-0006: Mevcut 5 kolondan 6 aşamalı modele geçiş

- Durum: **Bekliyor** — karar: Satış + Yönetim + MarcaDM. Hedef tarih: Faz 1 başlamadan.
- Tarih: 2026-10-27

## Bağlam

Mevcut pano (`src/domain/constants.ts`, `STAGES`) beş kolon kullanır ve satış ayrı bir bayraktır:

| Mevcut | Davranış |
|---|---|
| 1 İletişim kuruldu | başlangıç |
| 2 Yeşil hat | dönüş yaptı, fiyat soruyor |
| 3 Proforma gönderildi | 3 gün sonra otomatik takip araması |
| 4 Saha ziyareti | keşif, ölçü |
| 5 Kırmızı hat | neden zorunlu; geri taşınabilir |
| `won_at` bayrağı | kart kolonunda kalır, "satıldı" işareti alır |

Geriye taşıma serbest; "geri al" sınırsız. Mevcut veride 52 aşama hareketinin 4'ü geriye.

Genel plan altı aşama ister: NEW, CONTACTED, QUALIFIED, PROPOSAL, WON, LOST. İleri yönlü, 10 dakikalık geri al, atlanan aşama otomatik yazılır, kayıp terminal. Platformlara giden sinyal bu modele bağlıdır.

## Karar

Verilmedi. Faz 1'de aşama motoru yazılmadan önce aşağıdaki sorular yanıtlanmalı.

## Seçenekler

1. **Tam geçiş:** Altı aşama panoyu değiştirir. Eşleme: İletişim → CONTACTED, Yeşil hat → QUALIFIED (üç soru "evet" ise), Proforma → PROPOSAL, Saha ziyareti → PROPOSAL (alt durum), `won_at` → WON, Kırmızı hat → LOST. "Saha ziyareti" kolon olmaktan çıkar, aktivite olarak kalır.
2. **İç aşama + platform eşleme katmanı:** Pano beş kolonunu korur; `platform_stage_mappings` tablosu iç aşamayı platform olayına çevirir. Geriye taşıma panoda kalır ama platforma **yalnız ileri** olaylar gider (ilk ulaşılan zaman damgasıyla). Kod maliyeti daha yüksek, ekip alışkanlığı korunur.
3. **Hibrit:** Altı aşama kodda sabit, panoda görünen adlar satış ekibinin alıştığı adlar ("Yeşil hat" = QUALIFIED). Genel plan'ın "görünen ad değişebilir, kod sabit" kuralıyla uyumlu; önerilen seçenek.

## Karar için gereken bilgi

- Satış: "Nitelikli" için üç soru; "Saha ziyareti" ayrı aşama mı, aktivite mi?
- Satış: geriye taşıma gerçekten gerekli mi, yoksa yanlış tıkı 10 dakikalık geri al karşılar mı?
- Yönetim: raporlar (`ReportsPage`, `winRateByStage`) yeni modele göre yeniden tanımlanacak.

## Sonuçlar (karar sonrası)

- Mevcut `deals.stage` ve `deal_stage_changes` verisi tek seferlik eşleme betiğiyle `lead_stage_events` tablosuna taşınır.
- Rapor ve pano bileşenleri Faz 1 kapsamında güncellenir.
