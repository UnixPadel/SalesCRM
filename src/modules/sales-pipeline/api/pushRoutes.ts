import type { Request, Response, Router } from "express";
import type { RuleError } from "../../shared/kernel";
import type { Actor, PushSubscriptions } from "../application";
import type { PushConfigDto } from "./dto";

/**
 * Web Push abonelik uçları (2026-11-23). Herkes yalnız kendi tarayıcısını bağlar ve ayırır; abonelik veri
 * değişikliği sayılmaz (görüntüleyici de bildirim alabilir).
 */
export interface PushRouteDeps {
  push: PushSubscriptions;
  actor(req: Request, res: Response, write: boolean): Actor | undefined;
  sendError(res: Response, error: RuleError): Response;
}

const record = (v: unknown): Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

export function registerPushRoutes(r: Router, deps: PushRouteDeps): void {
  r.get("/push/config", (req, res) => {
    if (!deps.actor(req, res, false)) return;
    res.json(<PushConfigDto>deps.push.config());
  });

  r.post("/push/subscriptions", async (req, res) => {
    const a = deps.actor(req, res, false);
    if (!a) return;
    const body = record(req.body);
    const keys = record(body["keys"]);
    const result = await deps.push.subscribe({
      actor: a,
      endpoint: body["endpoint"],
      p256dh: keys["p256dh"],
      auth: keys["auth"],
      lang: body["lang"],
    });
    if (!result.ok) return deps.sendError(res, result.error);
    res.status(201).json(result.value);
  });

  r.post("/push/unsubscribe", async (req, res) => {
    const a = deps.actor(req, res, false);
    if (!a) return;
    await deps.push.unsubscribe(a, record(req.body)["endpoint"]);
    res.json({ ok: true });
  });
}
