-- Hata metinlerinden erişim token'larını temizler (2026-11-17). Meta veri seti alanına yanlışlıkla bir token girilince
-- Graph API onu "Object with ID '<token>' does not exist" diye geri yazdı; metin giden olay kuyruğuna kaydedildi ve
-- Yönetim → Sağlık'ta göründü. Bundan sonra yazılan hatalar uygulamada gizlenir (shared/kernel/redact.ts); bu
-- migration önceden kaydedilmiş olanları aynı kurallarla düzeltir. Yalnız last_error metni değişir.

UPDATE outbound_conversion_events
   SET last_error = regexp_replace(
         regexp_replace(
           regexp_replace(last_error, 'EAA[A-Za-z0-9]{20,}', 'EAA…(gizlendi)', 'g'),
           'ya29\.[A-Za-z0-9._-]{20,}', 'ya29.…(gizlendi)', 'g'),
         '(Bearer)\s+[A-Za-z0-9._~+/=-]{16,}', '\1 …(gizlendi)', 'gi')
 WHERE last_error ~* '(EAA[A-Za-z0-9]{20,}|ya29\.|Bearer\s)';

UPDATE inbound_webhook_events
   SET last_error = regexp_replace(
         regexp_replace(
           regexp_replace(last_error, 'EAA[A-Za-z0-9]{20,}', 'EAA…(gizlendi)', 'g'),
           'ya29\.[A-Za-z0-9._-]{20,}', 'ya29.…(gizlendi)', 'g'),
         '(Bearer)\s+[A-Za-z0-9._~+/=-]{16,}', '\1 …(gizlendi)', 'gi')
 WHERE last_error ~* '(EAA[A-Za-z0-9]{20,}|ya29\.|Bearer\s)';
