# ADR-0004: Secret deposu — ortam değişkenleri, kodda yalnız referans

- Durum: Kabul edildi (somut araç ADR-0005'e bağlı)
- Tarih: 2026-10-27
- Karar verenler: Yazılım (Elshan), IT

## Bağlam

Secret'lar: Meta app secret, sistem kullanıcısı token'ı, `google_key`, Google kimlik bilgileri, web formu HMAC anahtarı, Postgres ve MySQL bağlantıları. Bugün `.env` (gitignore'da) ve `server/data/config.json` içinde düz metin admin şifresi var. Genel plan: secret'lar kodda, logda ve arayüzde yok; `integration_settings` tablosu secret'ın değerini değil **referansını** tutar; 90 günde bir ve personel ayrılınca yenilenir.

## Karar

- Çalışma zamanında secret'lar **yalnız ortam değişkeninden** okunur. Tek okuma noktası: `shared/kernel` içindeki config yükleyici; modüller `process.env`'e doğrudan erişmez (lint kuralı).
- `integration_settings.secret_ref` ortam değişkeninin **adını** tutar (ör. `META_SYSTEM_USER_TOKEN`), değerini değil. Admin paneli yalnız "tanımlı / tanımlı değil / son yenileme" gösterir.
- Yerel geliştirme: `.env` dosyası, `.env.example` yer tutucularla. Örnek dosyada gerçek sunucu adı, hesap ya da anahtar bulunmaz.
- Üretim: hosting sağlayıcısının secret yönetimi (Clever Cloud ortam değişkenleri, VPS'te `systemd` `EnvironmentFile` + 600 izin, ya da Docker secret). Hosting kararı verilince bu ADR'ye araç adı eklenir; karar değişmez.
- Yenileme: her secret için `docs/runbooks/secret-yenileme.md` (Faz 6) ve `integration_settings.rotated_at` alanı.
- Mevcut `server/data/config.json` içindeki admin şifresi Faz 1'de ortam değişkenine taşınır; dosya kaldırılır.

## Seçenekler ve neden seçilmediği

- **Doppler / Infisical / 1Password Connect:** İyi araçlar; ama ek abonelik ve ağ bağımlılığı. Ekip tek geliştirici, secret sayısı on civarı. Ortam değişkeni + hosting paneli yeterli. Secret sayısı veya ekip büyürse geçiş adaptör katmanı değiştirmeden yapılır.
- **Secret'ları veritabanında şifreli tutmak:** Anahtarı yine ortamda tutmak gerekir; tek fazla katman, az kazanç.

## Sonuçlar

- `secretlint` her commit'te ve CI'da kaynak kodu tarar (ADR-0007).
- Loglarda korelasyon kimliği ve lead kimliği olur; e-posta ve telefon maskelenir (Genel plan kural 9). Logger `shared/kernel` içinde tek yerden gelir.
