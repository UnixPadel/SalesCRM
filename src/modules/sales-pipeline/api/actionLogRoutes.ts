import type { Request, Response, Router } from "express";
import type { RuleError } from "../../shared/kernel";
import {
  isActionResult,
  isActionType,
  isTargetType,
  type ActionLogQueries,
  type ActionType,
  type Actor,
} from "../application";
import type { ActionLogPageDto } from "./dto.actionLog";

/**
 * İşlem günlüğü ucu (Yönetim > Loglar). Görme izni kişi bazındadır (`seesLogs`, server/roles.mjs CRM_LOG_VIEWERS);
 * karar application katmanında, izinsiz oturum 403 `logs.forbidden` alır. Yalnız okuma: günlükte değiştirme ya da silme
 * ucu yoktur ve olmayacaktır (tablo da reddeder, migration 0027).
 *
 * Süzgeçler: actor · action (virgülle) · target (hedef türü) · targetId · q (hedef adında arama) · result · from · to.
 */
export interface ActionLogRouteDeps {
  actionLog: ActionLogQueries;
  actor(req: Request, res: Response, write: boolean): (Actor & { seesLogs?: boolean }) | undefined;
  sendError(res: Response, error: RuleError): Response;
}

const text = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);

function day(v: unknown): Date | undefined {
  const s = text(v);
  if (!s) return undefined;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** `before` = "<ISO zaman>|<id>" (önceki sayfanın `next` değeri). */
function cursor(v: unknown): { at: Date; id: string } | undefined {
  const [at, id] = (text(v) ?? "").split("|");
  const d = day(at);
  return d && id && /^[0-9a-f-]{36}$/i.test(id) ? { at: d, id } : undefined;
}

export function registerActionLogRoutes(r: Router, deps: ActionLogRouteDeps): void {
  r.get("/action-logs", async (req, res) => {
    const a = deps.actor(req, res, false);
    if (!a) return;
    const actions = (text(req.query["action"]) ?? "").split(",").filter(isActionType) as ActionType[];
    const target = text(req.query["target"]);
    const outcome = text(req.query["result"]);
    const result = await deps.actionLog.list({
      viewer: a,
      actorUserId: text(req.query["actor"]),
      actions,
      targetType: isTargetType(target) ? target : undefined,
      targetId: text(req.query["targetId"])?.slice(0, 100),
      search: text(req.query["q"]),
      result: isActionResult(outcome) ? outcome : undefined,
      from: day(req.query["from"]),
      to: day(req.query["to"]),
      before: cursor(req.query["before"]),
      limit: Number(req.query["limit"]) || undefined,
    });
    if (!result.ok) return deps.sendError(res, result.error);
    const body: ActionLogPageDto = {
      items: result.value.items.map((e) => ({
        id: e.id,
        occurredAt: e.occurredAt.toISOString(),
        actorUserId: e.actorUserId,
        action: e.action,
        leadId: e.leadId,
        leadName: e.leadName,
        targetType: e.targetType,
        targetId: e.targetId,
        targetLabel: e.targetLabel,
        result: e.result,
        details: e.details,
      })),
      next: result.value.next ? `${result.value.next.at.toISOString()}|${result.value.next.id}` : null,
      actors: result.value.actors,
    };
    res.json(body);
  });
}
