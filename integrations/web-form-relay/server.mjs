/**
 * Aktarıcının HTTP yüzü. Site formu buraya POST eder (aynı sunucu ya da ters proxy arkasında):
 *   POST /submit            form gövdesi (application/x-www-form-urlencoded ya da application/json)
 *   GET  /health            { ok, queued }
 * Yanıt: Accept text/html ve thanksUrl tanımlıysa 303 yönlendirme; aksi hâlde JSON { ok: true }.
 * CRM'e ulaşılamasa da 200 döner: gönderim diske yazıldı, retry döngüsü iletecek.
 */
import { createServer } from "node:http";
import { buildSubmission, deliver, FileQueue, parseCookies, processQueue } from "./lib.mjs";

const MAX_BODY = 256 * 1024;

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error("gövde çok büyük"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function parseForm(contentType, raw) {
  if ((contentType ?? "").includes("application/json")) {
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  }
  const out = {};
  for (const [k, v] of new URLSearchParams(raw)) {
    if (k in out) out[k] = Array.isArray(out[k]) ? [...out[k], v] : [out[k], v];
    else out[k] = v;
  }
  return out;
}

/**
 * @param opts { crmUrl, secret, queueDir, formId?, consentTextVersion?, honeypotField?, cookieMap?,
 *               thanksUrl?, allowedOrigin?, log?, fetchImpl?, now? }
 */
export function createRelay(opts) {
  const log = opts.log ?? (() => {});
  const queue = new FileQueue(opts.queueDir);
  const deliverOpts = { crmUrl: opts.crmUrl, secret: opts.secret, fetchImpl: opts.fetchImpl, now: opts.now, log };

  const cors = (res) => {
    if (!opts.allowedOrigin) return;
    res.setHeader("access-control-allow-origin", opts.allowedOrigin);
    res.setHeader("access-control-allow-headers", "content-type");
    res.setHeader("access-control-allow-methods", "POST, OPTIONS");
    res.setHeader("vary", "origin");
  };
  const json = (res, status, body) => {
    res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(body));
  };

  const server = createServer(async (req, res) => {
    cors(res);
    const url = new URL(req.url ?? "/", "http://relay");
    if (req.method === "OPTIONS") return void res.writeHead(204).end();
    if (req.method === "GET" && url.pathname === "/health") return json(res, 200, { ok: true, queued: queue.size() });
    if (req.method !== "POST" || url.pathname !== "/submit") return json(res, 404, { error: "yok" });

    let form;
    try {
      form = parseForm(req.headers["content-type"], await readBody(req));
    } catch (e) {
      return json(res, e?.status ?? 400, { error: e?.status === 413 ? "Gövde çok büyük." : "Gövde çözülemedi." });
    }
    const now = new Date((opts.now ?? Date.now)());
    const payload = buildSubmission(form, {
      now,
      pageUrl: typeof req.headers.referer === "string" ? req.headers.referer : "",
      cookies: parseCookies(req.headers.cookie),
      formId: opts.formId,
      consentTextVersion: opts.consentTextVersion,
      honeypotField: opts.honeypotField,
      cookieMap: opts.cookieMap,
    });

    const wantsHtml = (req.headers.accept ?? "").includes("text/html") && opts.thanksUrl;
    const done = () => {
      if (wantsHtml) {
        res.writeHead(303, { location: opts.thanksUrl });
        res.end();
      } else json(res, 200, { ok: true });
    };

    if (payload.honeypot) {
      log("info", "relay: honeypot dolu, gönderim atıldı", { submissionId: payload.submission_id });
      return done();
    }
    const name = queue.put(payload);
    // Yanıtı bekletmeden ilet; başarısızsa dosya kuyrukta kalır, döngü dener.
    const result = await deliver(payload, { ...deliverOpts, timeoutMs: 5000 });
    if (result.ok) {
      queue.remove(name);
      log("info", "relay: iletildi", { submissionId: payload.submission_id, status: result.status });
    } else if (result.retryable) {
      queue.bump(name, { payload, attempts: 0 }, result.error);
      log("warn", "relay: CRM'e ulaşılamadı, kuyruğa alındı", {
        submissionId: payload.submission_id,
        error: result.error,
      });
    } else {
      queue.fail(name, result.error);
      log("error", "relay: CRM reddetti, failed/ klasörüne taşındı", {
        submissionId: payload.submission_id,
        error: result.error,
      });
    }
    done();
  });

  return {
    server,
    queue,
    /** Kuyruğu bir kez boşaltmayı dener (retry döngüsü ve testler). */
    flush: () => processQueue(queue, deliverOpts),
  };
}
