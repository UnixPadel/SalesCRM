/**
 * Web Push göndericisi (`web-push`: VAPID imzası + ileti şifreleme). Anahtarlar bootstrap'tan değer olarak gelir.
 * 404 / 410: tarayıcı aboneliği iptal etmiş → "gone" (çağıran satırı siler). Diğer hata fırlar; çağıran loglar.
 * Adres (endpoint) gizlidir, hata nesnesinden loglara taşınmasın diye yalnız durum kodu aktarılır.
 */
import webpush from "web-push";
import type { PushTransport } from "../application";

export interface VapidKeys {
  /** `mailto:` ya da https adresi; push servisi sorun olursa buraya ulaşır. */
  subject: string;
  publicKey: string;
  privateKey: string;
}

/** İleti bu süre içinde teslim edilemezse push servisi atar (saniye): bayat "iş zamanı geldi" sonradan düşmesin. */
const TTL_SECONDS = 12 * 60 * 60;

export function createWebPushTransport(vapid: VapidKeys): PushTransport {
  return {
    async send(sub, payload) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
          { vapidDetails: vapid, TTL: TTL_SECONDS, timeout: 10_000 },
        );
        return "ok";
      } catch (e) {
        const status = (e as { statusCode?: unknown }).statusCode;
        if (status === 404 || status === 410) return "gone";
        // `cause` bilerek yok: kütüphanenin hata nesnesi abonelik adresini taşır.
        // eslint-disable-next-line preserve-caught-error
        throw new Error(`push servisi ${typeof status === "number" ? status : "yanıt vermedi"}`);
      }
    },
  };
}
