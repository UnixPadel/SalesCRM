/**
 * Kriptografi yardımcıları; tek yer. Inbox payload'ı diskte şifreli durur (Faz 2), webhook imzaları
 * ham gövde üzerinde HMAC ile doğrulanır ve her karşılaştırma sabit zamanlıdır.
 */
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export interface PayloadCipher {
  encrypt(plain: string): string;
  decrypt(envelope: string): string;
}

const ENVELOPE_VERSION = "v1";

/** Anahtar üretimi (CLI): 32 bayt, base64. `.env` içine INBOX_ENCRYPTION_KEY olarak yazılır. */
export function generateKeyBase64(): string {
  return randomBytes(32).toString("base64");
}

/**
 * AES-256-GCM. Zarf biçimi: `v1.<iv>.<tag>.<ciphertext>` (base64). Anahtar 32 bayt base64;
 * yanlış uzunlukta anahtar açılışta hata verir, çalışırken değil.
 */
export function createAesGcmCipher(keyBase64: string): PayloadCipher {
  const key = Buffer.from(keyBase64, "base64");
  if (key.length !== 32) {
    throw new Error("Şifreleme anahtarı 32 bayt (base64) olmalı; `npm run secrets:key` ile üretin.");
  }
  return {
    encrypt(plain) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
      const tag = cipher.getAuthTag();
      return [ENVELOPE_VERSION, iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(".");
    },
    decrypt(envelope) {
      const [version, ivB64, tagB64, ctB64] = envelope.split(".");
      if (version !== ENVELOPE_VERSION || !ivB64 || !tagB64 || !ctB64) {
        throw new Error("Şifreli zarf biçimi tanınmadı.");
      }
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
      decipher.setAuthTag(Buffer.from(tagB64, "base64"));
      return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]).toString("utf8");
    },
  };
}

/** Testler ve şifreleme anahtarı tanımsız yerel geliştirme için: düz metin, işaretli. */
export const plainTextCipher: PayloadCipher = {
  encrypt: (plain) => `plain.${Buffer.from(plain, "utf8").toString("base64")}`,
  decrypt: (envelope) => {
    const [version, body] = envelope.split(".");
    if (version !== "plain" || body === undefined) throw new Error("Şifreli zarf biçimi tanınmadı.");
    return Buffer.from(body, "base64").toString("utf8");
  },
};

export function hmacSha256Hex(secret: string, data: Buffer | string): string {
  return createHmac("sha256", secret).update(data).digest("hex");
}

/** Sabit zamanlı karşılaştırma; uzunluk farkında da süre sızdırmaz (her iki tarafı özetler). */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHmac("sha256", "safe-equal").update(a).digest();
  const hb = createHmac("sha256", "safe-equal").update(b).digest();
  return timingSafeEqual(ha, hb) && a.length === b.length;
}
