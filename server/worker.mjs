// Arayüzsüz worker (Clever Cloud Node uygulaması, `npm run worker`): yalnız zamanlanmış işler.
//
//   - web-pull         sitenin çekme API'si → gelen kutusu → onay (WEB_PULL_URL + WEB_FORM_HMAC_KEY)
//   - inbox-process    gelen kutusu → lead (bölge ataması, "yeni lead" bildirimi)
//   - inbox-backfill   Meta yedek senkronu (META_SYSTEM_USER_TOKEN varsa)
//   - inbox-purge      30 günden eski payload'ları siler
//   - outbox-dispatch  aşama olaylarını Meta / Google'a gönderir (gönderici yapılandırıldıysa)
//   - sheet-sync       form tablosu eşitlemesi (SHEET_SYNC_CSV_URL varsa)
//
// Webhook, form ucu, oturum, arayüz ve IMAP yoktur. Şirket kullanıcı tablosuna (AUTH_DB_URL, MySQL) bağlanmaz:
// atanan satışçıya uygulama içi bildirim yazılır; bildirim e-postası için kullanıcı rehberi olmadığından gönderilmez.
// HTTP yalnız GET /health: Clever Cloud uygulamanın 0.0.0.0:$PORT (8080) dinlemesini bekler.
import "./env.mjs";
import { createServer } from "node:http";
import { bootSalesPipeline } from "../src/bootstrap/salesPipeline.ts";
import { bootLeadIntake } from "../src/bootstrap/leadIntake.ts";
import { bootAdFeedback } from "../src/bootstrap/adFeedback.ts";
import { bootSheetSync } from "../src/bootstrap/sheetSync.ts";

// Clever Cloud PORT'u kendisi verir (8080); yerelde API_PORT ile çakışmasın diye varsayılan 8788.
const PORT = Number(process.env.PORT) || 8788;
const HOST = process.env.WORKER_HOST || "0.0.0.0";

const salesPipeline = await bootSalesPipeline();
const log = salesPipeline.logger.child({ module: "worker" });
const leadIntake = bootLeadIntake(salesPipeline);
const adFeedback = bootAdFeedback(salesPipeline, leadIntake.settings);
const sheetSync = bootSheetSync(salesPipeline);

if (!leadIntake.webPull) log.warn("web-pull kapalı: WEB_PULL_URL ve WEB_FORM_HMAC_KEY birlikte tanımlanmalı");

/** {ok, lastPullAt, lastError}: veritabanı yanıt veriyorsa 200 (ok = son çekme turu hatasız); yoksa 503. */
async function health() {
  const pull = leadIntake.webPull?.status() ?? null;
  try {
    await salesPipeline.db.query("SELECT 1 AS one");
  } catch {
    return { status: 503, body: { ok: false, lastPullAt: pull?.lastPullAt ?? null, lastError: "db_unreachable" } };
  }
  return {
    status: 200,
    body: {
      ok: pull ? pull.lastRunOk !== false : true,
      webPull: Boolean(pull),
      lastPullAt: pull?.lastPullAt ?? null,
      lastError: pull && pull.lastRunOk === false ? pull.lastErrorCode : null,
    },
  };
}

const server = createServer((req, res) => {
  const path = (req.url || "/").split("?")[0];
  if (req.method === "GET" && (path === "/health" || path === "/")) {
    health().then(
      ({ status, body }) => {
        res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
        res.end(JSON.stringify(body));
      },
      () => {
        res.writeHead(500, { "content-type": "application/json" });
        res.end('{"ok":false,"lastError":"health_failed"}');
      },
    );
    return;
  }
  res.writeHead(404, { "content-type": "application/json" });
  res.end('{"ok":false}');
});

server.listen(PORT, HOST, () => {
  log.info("worker hazır", {
    port: PORT,
    jobs: {
      webPull: leadIntake.providers.webPull,
      metaBackfill: leadIntake.providers.meta,
      outbound: adFeedback.providers,
      sheetSync: Boolean(sheetSync),
    },
    database: salesPipeline.config.databaseUrl ? "postgres" : "pglite",
    encrypted: leadIntake.providers.encrypted,
  });
});

let stopping = false;
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  log.info("worker duruyor", { signal });
  leadIntake.scheduler.stop();
  adFeedback.scheduler.stop();
  sheetSync?.scheduler.stop();
  server.close();
  await salesPipeline.close().catch(() => undefined);
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
