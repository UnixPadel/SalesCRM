# ADR-0005: Hosting ve webhook giriş yolu

- Durum: **Bekliyor** — karar: Yazılım + IT. Hedef tarih: Faz 2 başlamadan.
- Tarih: 2026-10-27

## Bağlam

CRM'in bugün nerede çalıştığı belgelenmemiş. Bilinenler: giriş tablosu Clever Cloud MySQL'de; uygulama tek Node süreci (`npm start`, port 8787) olarak `dist/` klasörünü de servis ediyor. Meta ve Google webhook'ları internetten erişilebilir **HTTPS** adres ister (ajans önerisi `crm.unixpadel.com`). Genel plan: CRM iç ağda çalışacaksa internete yalnız `/webhooks/*` ve `/forms/*` yolları ters proxy üzerinden açılır; imza doğrulama, istek boyutu ve hız sınırı zorunlu.

## Karar

Verilmedi. Aşağıdaki üç seçenekten biri seçilince bu bölüm doldurulur.

## Seçenekler

| Seçenek | Artı | Eksi | Webhook girişi |
|---|---|---|---|
| **A. Clever Cloud** (Node uygulaması + Postgres addon) | Zaten müşteri; HTTPS, ortam değişkeni, yedek hazır; pg-boss için ikinci instance kolay | Aylık ücret; ters proxy kuralı sağlayıcı tarafında sınırlı, yol bazlı kısıt uygulama içinde yapılır | Uygulama doğrudan internette; `/api/*` oturum zorunlu, `/webhooks/*` imza zorunlu, diğer yollar IP allow-list ile |
| **B. Kendi VPS'i** (Ubuntu, Caddy/Nginx, Docker Compose: app + Postgres) | Tam kontrol; yol bazlı ters proxy; maliyet düşük | İşletme yükü IT'de: yama, yedek, izleme | Caddy yalnız `/webhooks/*` ve `/forms/*` yollarını dışa açar; CRM arayüzü VPN ya da IP kısıtlı |
| **C. Fabrika ağı + Cloudflare Tunnel** | Veri şirkette; internete port açılmaz | Tünel ve fabrika interneti tek hata noktası; webhook kaçarsa yedek senkron telafi eder ama gecikir | Tünel yalnız `/webhooks/*` ve `/forms/*` yollarını yayınlar |

Yazılımın önerisi: **A** hızlı başlangıç için, **B** uzun vadede. C yalnız hukuk "veri yurt içinde kalsın" derse.

## Karar için gereken bilgi

- CRM'in bugün nerede çalıştığı ve kimin yönettiği (IT).
- `crm.unixpadel.com` alan adının DNS yönetimi kimde (IT / MarcaDM).
- Aylık hosting bütçesi (Yönetim).

## Sonuçlar (karar sonrası doldurulacak)

- Secret deposu aracı (ADR-0004).
- Postgres'in yeri (ADR-0002).
- Ters proxy / yol kısıtı yapılandırması `docs/runbooks/` altına.
