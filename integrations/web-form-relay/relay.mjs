#!/usr/bin/env node
/**
 * Giriş noktası: `node integrations/web-form-relay/relay.mjs`. Ayarlar ortam değişkeninden (secret dosyaya yazılmaz):
 *   WEB_FORM_HMAC_KEY        zorunlu; CRM ile paylaşılan imza anahtarı (`npm run secrets:key`)
 *   CRM_FORM_URL             varsayılan http://localhost:8787/forms/web
 *   RELAY_PORT               varsayılan 8790
 *   RELAY_QUEUE_DIR          varsayılan ./queue (bu klasörün yanında); kalıcı diskte olmalı
 *   RELAY_RETRY_SECONDS      varsayılan 30; kuyruk bu aralıkla yeniden denenir
 *   RELAY_FORM_ID            form `form_id` göndermiyorsa kullanılacak kimlik (ör. "contact")
 *   RELAY_CONSENT_TEXT_VERSION  aydınlatma metni sürümü (ör. "2026-01"); her onay kaydına yazılır
 *   RELAY_HONEYPOT_FIELD     varsayılan "website"
 *   RELAY_THANKS_URL         tanımlıysa klasik form POST'u sonrası buraya 303
 *   RELAY_ALLOWED_ORIGIN     tanımlıysa CORS (fetch ile gönderen siteler için), ör. https://www.unixpadel.com
 *   RELAY_COOKIE_MAP         JSON; varsayılan lib.mjs DEFAULT_COOKIE_MAP
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRelay } from "./server.mjs";

const env = process.env;
const secret = env.WEB_FORM_HMAC_KEY ?? "";
if (!secret) {
  console.error("WEB_FORM_HMAC_KEY tanımsız; aktarıcı başlatılmadı.");
  process.exit(1);
}
const here = dirname(fileURLToPath(import.meta.url));
const log = (level, msg, data) =>
  console[level === "error" ? "error" : level === "warn" ? "warn" : "log"](
    JSON.stringify({ t: new Date().toISOString(), level, msg, ...data }),
  );

const relay = createRelay({
  crmUrl: env.CRM_FORM_URL ?? "http://localhost:8787/forms/web",
  secret,
  queueDir: env.RELAY_QUEUE_DIR ?? join(here, "queue"),
  formId: env.RELAY_FORM_ID,
  consentTextVersion: env.RELAY_CONSENT_TEXT_VERSION,
  honeypotField: env.RELAY_HONEYPOT_FIELD,
  thanksUrl: env.RELAY_THANKS_URL,
  allowedOrigin: env.RELAY_ALLOWED_ORIGIN,
  cookieMap: env.RELAY_COOKIE_MAP ? JSON.parse(env.RELAY_COOKIE_MAP) : undefined,
  log,
});

const port = Number(env.RELAY_PORT ?? 8790);
relay.server.listen(port, () => log("info", "relay dinliyor", { port, queued: relay.queue.size() }));

const everyMs = Number(env.RELAY_RETRY_SECONDS ?? 30) * 1000;
let running = false;
const tick = async () => {
  if (running) return;
  running = true;
  try {
    if (relay.queue.size() > 0) await relay.flush();
  } catch (e) {
    log("error", "relay: kuyruk döngüsü hata verdi", { error: e instanceof Error ? e.message : String(e) });
  } finally {
    running = false;
  }
};
const timer = setInterval(tick, everyMs);
void tick();

const stop = () => {
  clearInterval(timer);
  relay.server.close(() => process.exit(0));
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
