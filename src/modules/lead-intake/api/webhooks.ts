/**
 * Webhook controller'ları (Genel plan kural 3): doğrula → inbox'a yaz → hemen 200. İş kuralı yok.
 * Oturum gerektirmez; imza / anahtar tek kimlik doğrulamadır. Ham gövde imza için gerekir, bu yüzden
 * bu router sunucunun genel JSON ayrıştırıcısından ÖNCE bağlanır. İstek boyutu ve hız sınırı burada.
 */
import express, { Router, type Request, type Response } from "express";
import type { Logger } from "../../shared/kernel";
import { googleLeadId, stripGoogleKey, verifyGoogleKey, type GoogleLeadPayload } from "../adapters/google";
import { changePayload, extractLeadgenChanges, verifyChallenge, verifySignature } from "../adapters/meta";
import type { AcceptInboundEvent } from "../application";

export interface WebhookDeps {
  accept: AcceptInboundEvent;
  logger: Logger;
  /** null: uç 503 "yapılandırılmadı" döner (secret tanımsız). */
  meta: { appSecret: string; verifyToken: string } | null;
  google: { key: string } | null;
  rateLimit?: { windowMs: number; max: number };
  bodyLimit?: string;
}

/** Basit bellek içi hız sınırı: IP başına pencere içinde en fazla `max` istek. Tek instance için yeterli. */
export function createRateLimiter(windowMs: number, max: number, now: () => number = Date.now) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return (key: string): boolean => {
    const t = now();
    const h = hits.get(key);
    if (!h || h.resetAt <= t) {
      hits.set(key, { count: 1, resetAt: t + windowMs });
      if (hits.size > 10_000) for (const [k, v] of hits) if (v.resetAt <= t) hits.delete(k);
      return true;
    }
    h.count += 1;
    return h.count <= max;
  };
}

export function createWebhookRouter(deps: WebhookDeps): Router {
  const r = Router();
  const { logger } = deps;
  const limit = deps.bodyLimit ?? "1mb";
  const allow = createRateLimiter(deps.rateLimit?.windowMs ?? 60_000, deps.rateLimit?.max ?? 600);

  r.use((req: Request, res: Response, next) => {
    if (allow(req.ip ?? "?")) return next();
    logger.warn("webhook: hız sınırı", { path: req.path, ip: req.ip });
    res.status(429).json({ error: "Çok fazla istek." });
  });

  // ---- Meta Lead Ads ----
  r.get("/meta", (req, res) => {
    if (!deps.meta) return res.status(503).json({ error: "Meta webhook yapılandırılmadı." });
    const challenge = verifyChallenge(req.query as Record<string, unknown>, deps.meta.verifyToken);
    if (challenge === null) {
      logger.warn("webhook: Meta doğrulama reddedildi", { mode: req.query["hub.mode"] });
      return res.status(403).send("Forbidden");
    }
    res.status(200).type("text/plain").send(challenge);
  });

  r.post("/meta", express.raw({ type: () => true, limit }), async (req, res) => {
    if (!deps.meta) return res.status(503).json({ error: "Meta webhook yapılandırılmadı." });
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!verifySignature(raw, req.header("x-hub-signature-256"), deps.meta.appSecret)) {
      logger.warn("webhook: Meta imzası geçersiz", { hasHeader: Boolean(req.header("x-hub-signature-256")) });
      return res.status(401).json({ error: "İmza geçersiz." });
    }
    let body: unknown;
    try {
      body = JSON.parse(raw.toString("utf8"));
    } catch {
      return res.status(400).json({ error: "Gövde JSON değil." });
    }
    const changes = extractLeadgenChanges(body);
    let inserted = 0;
    for (const c of changes) {
      const out = await deps.accept.execute({
        provider: "meta",
        kind: "webhook",
        platformLeadId: c.leadgenId,
        payload: changePayload(c),
      });
      if (out.status === "inserted") inserted += 1;
    }
    logger.info("webhook: Meta bildirimi", { changes: changes.length, inserted });
    res.status(200).type("text/plain").send("EVENT_RECEIVED");
  });

  // ---- Google Ads lead form ----
  r.post("/google", express.json({ limit, type: () => true }), async (req, res) => {
    if (!deps.google) return res.status(503).json({ error: "Google webhook yapılandırılmadı." });
    const body = req.body as GoogleLeadPayload | undefined;
    if (!verifyGoogleKey(body, deps.google.key)) {
      logger.warn("webhook: Google anahtarı geçersiz", { hasKey: typeof body?.google_key === "string" });
      return res.status(401).json({ error: "Anahtar geçersiz." });
    }
    const leadId = googleLeadId(body);
    if (!leadId || !body) return res.status(400).json({ error: "lead_id yok." });
    const out = await deps.accept.execute({
      provider: "google",
      kind: "webhook",
      platformLeadId: leadId,
      payload: stripGoogleKey(body),
    });
    logger.info("webhook: Google bildirimi", { status: out.status, isTest: body.is_test === true });
    res.status(200).json({});
  });

  r.use((err: unknown, req: Request, res: Response, _next: () => void) => {
    const e = err as { type?: string; status?: number };
    if (e?.type === "entity.too.large") return res.status(413).json({ error: "Gövde çok büyük." });
    if (e?.type === "entity.parse.failed") return res.status(400).json({ error: "Gövde JSON değil." });
    logger.error("webhook hatası", { path: req.path, error: err });
    res.status(500).json({ error: "Beklenmeyen hata." });
  });

  return r;
}
