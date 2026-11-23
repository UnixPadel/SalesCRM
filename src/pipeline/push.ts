import type { Lang } from "../i18n";
import type { PushConfigDto } from "../modules/sales-pipeline/api/dto";
import { call } from "./api";

/**
 * Web Push'un tarayıcı tarafı (2026-11-23): izin, service worker kaydı (`/sw.js`), abonelik ve sunucuya bildirme.
 * Abonelik tarayıcıya aittir, kişiye değil: aynı tarayıcıda başka biri oturum açınca `syncPush` aboneliği ona
 * geçirir, çıkışta `releasePush` sunucudaki bağı koparır (tarayıcı izni ve abonelik durur).
 *
 * Durumlar: unsupported (tarayıcı desteklemiyor ya da site https değil) · disabled (sunucuda kapalı) ·
 * denied (kullanıcı tarayıcıda engellemiş) · off · on.
 */
export type PushState = "unsupported" | "disabled" | "denied" | "off" | "on";

const supported = (): boolean =>
  typeof navigator !== "undefined" &&
  "serviceWorker" in navigator &&
  typeof window !== "undefined" &&
  "PushManager" in window &&
  "Notification" in window;

const config = () => call<PushConfigDto>("GET", "/push/config");

function keyBytes(base64url: string): Uint8Array {
  const padded = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

/** Aboneliğin anahtarı sunucunun bugünkü anahtarı mı (anahtar değiştiyse eski abonelik işe yaramaz). */
function sameKey(sub: PushSubscription, publicKey: string): boolean {
  const have = sub.options.applicationServerKey;
  if (!have) return false;
  const a = new Uint8Array(have);
  const b = keyBytes(publicKey);
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

async function current(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration("/");
  return (await reg?.pushManager.getSubscription()) ?? null;
}

const save = (sub: PushSubscription, lang: Lang) => {
  const json = sub.toJSON();
  return call<{ ok: true }>("POST", "/push/subscriptions", { endpoint: json.endpoint, keys: json.keys, lang });
};

async function subscribe(publicKey: string, lang: Lang): Promise<void> {
  const reg = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
  await save(sub, lang);
}

/**
 * Açılışta: bu tarayıcının durumu. Abonelik varsa sunucuya yeniden bildirilir (oturumdaki kişiye bağlanır, dil
 * güncellenir); sunucunun anahtarı değiştiyse abonelik yenilenir.
 */
export async function syncPush(lang: Lang): Promise<PushState> {
  if (!supported()) return "unsupported";
  const { enabled, publicKey } = await config();
  if (!enabled) return "disabled";
  if (Notification.permission === "denied") return "denied";
  const sub = await current();
  if (!sub || Notification.permission !== "granted") return "off";
  if (sameKey(sub, publicKey)) await save(sub, lang);
  else {
    await sub.unsubscribe();
    await subscribe(publicKey, lang);
  }
  return "on";
}

/** Düğme: izin ister, abone olur. Kullanıcı reddederse "denied" (ya da soruyu kapattıysa "off"). */
export async function enablePush(lang: Lang): Promise<PushState> {
  if (!supported()) return "unsupported";
  const { enabled, publicKey } = await config();
  if (!enabled) return "disabled";
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "denied" : "off";
  const old = await current();
  if (old && !sameKey(old, publicKey)) await old.unsubscribe();
  await subscribe(publicKey, lang);
  return "on";
}

/** Düğme: bu tarayıcıda kapat. */
export async function disablePush(): Promise<PushState> {
  const sub = supported() ? await current() : null;
  if (sub) {
    await call<{ ok: true }>("POST", "/push/unsubscribe", { endpoint: sub.endpoint }).catch(() => undefined);
    await sub.unsubscribe();
  }
  return "off";
}

/** Çıkıştan önce: sunucu bu tarayıcıya artık bu kişi adına bildirim yollamasın. Hata çıkışı engellemez. */
export async function releasePush(): Promise<void> {
  try {
    const sub = supported() ? await current() : null;
    if (sub) await call<{ ok: true }>("POST", "/push/unsubscribe", { endpoint: sub.endpoint });
  } catch {
    /* çıkış sürer */
  }
}

/** Bildirime tıklanınca service worker açık sekmeye lead adresini yollar; sekme oraya gider. */
export function onPushOpen(go: (hash: string) => void): () => void {
  if (!supported()) return () => undefined;
  const handler = (e: MessageEvent) => {
    const data = e.data as { type?: unknown; url?: unknown } | null;
    if (data?.type !== "crm-open" || typeof data.url !== "string") return;
    try {
      const url = new URL(data.url);
      if (url.origin === window.location.origin && url.hash) go(url.hash);
    } catch {
      /* geçersiz adres yok sayılır */
    }
  };
  navigator.serviceWorker.addEventListener("message", handler);
  return () => navigator.serviceWorker.removeEventListener("message", handler);
}
