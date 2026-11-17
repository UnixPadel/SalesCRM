/**
 * Hata metinlerindeki erişim token'larını gizler. Platformlar bazen isteği hata mesajında geri yazar
 * (2026-11-17: Meta, veri seti alanına yanlışlıkla girilen token'ı "Object with ID '<token>' does not exist" diye
 * döndürdü ve metin Yönetim → Sağlık'ta göründü). Veritabanına ve arayüze giden her hata metni buradan geçer.
 *
 *   EAA…            Meta erişim token'ları (kullanıcı, sayfa, sistem kullanıcısı)
 *   ya29.…          Google OAuth erişim token'ları
 *   Bearer <değer>  Authorization başlığı
 */
const PATTERNS: readonly [RegExp, string][] = [
  [/\bEAA[A-Za-z0-9]{20,}/g, "EAA…(gizlendi)"],
  [/\bya29\.[A-Za-z0-9._-]{20,}/g, "ya29.…(gizlendi)"],
  [/\b(Bearer)\s+[A-Za-z0-9._~+/=-]{16,}/gi, "$1 …(gizlendi)"],
];

export function redactSecrets(text: string): string {
  let out = text;
  for (const [re, by] of PATTERNS) out = out.replace(re, by);
  return out;
}
