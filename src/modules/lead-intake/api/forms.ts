/**
 * Web formu ucu (Genel plan kural 3): imzayı doğrula → inbox'a yaz → hemen 200. İş kuralı yok.
 * Oturumsuz; HMAC imza + zaman damgası tek kimlik doğrulamadır. Ham gövde imza için gerekir, bu yüzden
 * bu router sunucunun genel JSON ayrıştırıcısından ÖNCE bağlanır. İstek boyutu ve IP başına hız sınırı burada.
 * Honeypot dolu gönderim lead açmaz ama yine 200 döner (bot, reddedildiğini öğrenmesin).
 */
import express, { Router, type Request, type Response } from "express";
import type { Logger } from "../../shared/kernel";
import {
  WEB_FORM_HEADERS,
  WEB_PROVIDER,
  isHoneypotFilled,
  verifyWebFormSignature,
  webFormIsTest,
  webFormSubmissionId,
} from "../adapters/web-form";
import type { AcceptInboundEvent } from "../application";
import { createRateLimiter } from "./webhooks";

export interface FormsDeps {
  accept: AcceptInboundEvent;
  logger: Logger;
  /** null: uç 503 "yapılandırılmadı" döner (WEB_FORM_HMAC_KEY tanımsız). */
  web: { secret: string } | null;
  /** Testler: zaman damgası penceresi için şimdi (ms). */
  now?: () => number;
  rateLimit?: { windowMs: number; max: number };
  bodyLimit?: string;
}

export function createFormsRouter(deps: FormsDeps): Router {
  const r = Router();
  const { logger } = deps;
  const now = deps.now ?? Date.now;
  const limit = deps.bodyLimit ?? "256kb";
  // Form gönderimi insan hızındadır; site sunucusu tek IP'den gelir, kuyruk boşaltırken dakikada 120 yeter.
  const allow = createRateLimiter(deps.rateLimit?.windowMs ?? 60_000, deps.rateLimit?.max ?? 120, now);

  r.use((req: Request, res: Response, next) => {
    if (allow(req.ip ?? "?")) return next();
    logger.warn("form: hız sınırı", { path: req.path, ip: req.ip });
    res.status(429).json({ error: "Çok fazla istek." });
  });

  r.post("/web", express.raw({ type: () => true, limit }), async (req, res) => {
    if (!deps.web) return res.status(503).json({ error: "Web formu ucu yapılandırılmadı." });
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const check = verifyWebFormSignature(
      raw,
      { signature: req.header(WEB_FORM_HEADERS.signature), timestamp: req.header(WEB_FORM_HEADERS.timestamp) },
      deps.web.secret,
      now(),
    );
    if (!check.ok) {
      logger.warn("form: imza reddedildi", { reason: check.reason, ip: req.ip });
      return res.status(401).json({ error: "İmza geçersiz.", reason: check.reason });
    }
    let body: unknown;
    try {
      body = JSON.parse(raw.toString("utf8"));
    } catch {
      return res.status(400).json({ error: "Gövde JSON değil." });
    }
    const submissionId = webFormSubmissionId(body);
    if (!submissionId) return res.status(400).json({ error: "submission_id yok." });
    if (isHoneypotFilled(body)) {
      logger.info("form: honeypot dolu, gönderim yok sayıldı", { submissionId });
      return res.status(200).json({ ok: true, status: "ignored" });
    }
    const out = await deps.accept.execute({
      provider: WEB_PROVIDER,
      kind: "webhook",
      platformLeadId: submissionId,
      payload: body,
    });
    logger.info("form: web gönderimi", { submissionId, status: out.status, isTest: webFormIsTest(body) });
    res.status(200).json({ ok: true, status: out.status });
  });

  r.use((err: unknown, req: Request, res: Response, _next: () => void) => {
    const e = err as { type?: string; status?: number };
    if (e?.type === "entity.too.large") return res.status(413).json({ error: "Gövde çok büyük." });
    logger.error("form hatası", { path: req.path, error: err });
    res.status(500).json({ error: "Beklenmeyen hata." });
  });

  return r;
}
