import { Router, type Request, type Response } from "express";
import type { Db } from "../../shared/db";
import { RuleError, isAppError, type Logger, type Result } from "../../shared/kernel";
import type { Actor, ActivityWithLead, Notification, NotificationQueries, SalesPipeline } from "../application";
import { DEFAULT_EUR_RATES, QUALIFICATION_QUESTIONS, isStageCode, type Activity, type EurRates } from "../domain";
import { readLostReasons, readStageDefinitions } from "../infrastructure";
import type {
  ActivityDto,
  AddActivityBody,
  ApiErrorDto,
  AssignBody,
  BoardDto,
  ChangeStageBody,
  CreateLeadBody,
  NotificationDto,
  NotificationsDto,
  ReferenceDto,
  SetActivityDoneBody,
  TodayDto,
  TodayItemDto,
  UpdateLeadBody,
} from "./dto";

export interface RouterDeps {
  pipeline: SalesPipeline;
  notifications: NotificationQueries;
  db: Db;
  logger: Logger;
  undoWindowMinutes: number;
  /** Pano toplamları için kurlar; arayüze de verilir. */
  eurRates?: EurRates | undefined;
  /** Oturumdan kişiyi çıkarır; yoksa undefined (401). `readOnly` görüntüleyici rolü. */
  actorOf(req: Request): (Actor & { readOnly: boolean }) | undefined;
}

const CURRENCIES = ["EUR", "USD", "GBP", "TRY"];

/** Controller doğrular, çağırır, döner (Genel plan kural 3). İş kuralı yok. */
export function createSalesPipelineRouter(deps: RouterDeps): Router {
  const r = Router();
  const { pipeline, logger } = deps;

  const actor = (req: Request, res: Response, write: boolean): (Actor & { readOnly: boolean }) | undefined => {
    const a = deps.actorOf(req);
    if (!a) {
      res.status(401).json(<ApiErrorDto>{ error: "Oturum açılmamış.", code: "unauthorized" });
      return undefined;
    }
    if (write && a.readOnly) {
      res.status(403).json(<ApiErrorDto>{ error: "Görüntüleyici hesabı değişiklik yapamaz.", code: "read_only" });
      return undefined;
    }
    return a;
  };

  const send = <T>(res: Response, result: Result<T, RuleError>, okStatus = 200) => {
    if (result.ok) return res.status(okStatus).json(result.value);
    return sendError(res, result.error);
  };

  r.get("/reference", async (req, res) => {
    if (!actor(req, res, false)) return;
    const [stages, lostReasons] = await Promise.all([readStageDefinitions(deps.db), readLostReasons(deps.db)]);
    const body: ReferenceDto = {
      stages: stages.map((s) => ({
        code: s.code as ReferenceDto["stages"][number]["code"],
        nameTr: s.nameTr,
        nameEn: s.nameEn,
        isTerminal: s.isTerminal,
        requiresValue: s.requiresValue,
        requiresReason: s.requiresReason,
      })),
      lostReasons,
      qualificationQuestions: [...QUALIFICATION_QUESTIONS],
      currencies: CURRENCIES,
      undoWindowMinutes: deps.undoWindowMinutes,
      eurRates: { ...(deps.eurRates ?? DEFAULT_EUR_RATES) },
    };
    res.json(body);
  });

  r.get("/leads", async (req, res) => {
    const a = actor(req, res, false);
    if (!a) return;
    const stage =
      typeof req.query["stage"] === "string" && isStageCode(req.query["stage"]) ? req.query["stage"] : undefined;
    const search = typeof req.query["q"] === "string" ? req.query["q"].trim() || undefined : undefined;
    const limit = Math.min(Number(req.query["limit"]) || 500, 2000);
    res.json(
      await pipeline.queries.list({ actor: a, stage, search, includeTest: req.query["includeTest"] === "1", limit }),
    );
  });

  // Pano (Faz 6b): filtreler sorgu parametresi; kolon istatistikleri aynı filtrelenmiş kümeden.
  r.get("/board", async (req, res) => {
    const a = actor(req, res, false);
    if (!a) return;
    const ownerQ = typeof req.query["owner"] === "string" ? req.query["owner"].trim() : "";
    const owner = ownerQ === "" ? undefined : ownerQ === "pool" ? null : ownerQ === "me" ? a.userId : ownerQ;
    const countryQ = typeof req.query["country"] === "string" ? req.query["country"].trim().toUpperCase() : "";
    const board = await pipeline.queries.board({
      actor: a,
      owner,
      country: /^[A-Z]{2}$/.test(countryQ) ? countryQ : undefined,
      rotting: req.query["rotting"] === "1",
      includeTest: req.query["includeTest"] === "1",
    });
    res.json(board as unknown as BoardDto);
  });

  r.get("/leads/:id", async (req, res) => {
    const a = actor(req, res, false);
    if (!a) return;
    send(res, await pipeline.queries.get(String(req.params["id"]), a));
  });

  r.post("/leads", async (req, res) => {
    const a = actor(req, res, true);
    if (!a) return;
    const b = (req.body ?? {}) as CreateLeadBody;
    const input = {
      source: "manual" as const,
      fullName: String(b.fullName ?? ""),
      email: b.email ?? null,
      phone: b.phone ?? null,
      country: b.country ?? null,
      city: b.city ?? "",
      company: b.company ?? "",
      productInterest: b.productInterest ?? "",
      notes: b.notes ?? "",
      courtCount: b.courtCount ?? null,
      courtModel: b.courtModel ?? "",
      expectedCloseDate: b.expectedCloseDate ?? null,
      isTest: b.isTest === true,
      actor: a,
      ...(a.isAdmin && b.assignedUserId !== undefined ? { assignedUserId: b.assignedUserId } : {}),
    };
    send(res, await pipeline.createLead.execute(input), 201);
  });

  r.patch("/leads/:id", async (req, res) => {
    const a = actor(req, res, true);
    if (!a) return;
    const b = (req.body ?? {}) as UpdateLeadBody & Record<string, unknown>;
    send(res, await pipeline.updateLeadFields.execute({ leadId: String(req.params["id"]), fields: b, actor: a }));
  });

  r.post("/leads/:id/stage", async (req, res) => {
    const a = actor(req, res, true);
    if (!a) return;
    const b = (req.body ?? {}) as ChangeStageBody;
    if (!isStageCode(b.target)) {
      return sendError(res, new RuleError("stage.unknown", "Bilinmeyen aşama kodu.", { stage: b.target }));
    }
    send(
      res,
      await pipeline.changeLeadStage.execute({
        leadId: String(req.params["id"]),
        target: b.target,
        actor: a,
        value: b.value ?? null,
        lostReasonCode: b.lostReasonCode ?? null,
        qualificationAnswers: b.qualificationAnswers ?? null,
      }),
    );
  });

  r.post("/leads/:id/undo", async (req, res) => {
    const a = actor(req, res, true);
    if (!a) return;
    send(res, await pipeline.undoStageChange.execute({ leadId: String(req.params["id"]), actor: a }));
  });

  r.post("/leads/:id/assign", async (req, res) => {
    const a = actor(req, res, true);
    if (!a) return;
    const b = (req.body ?? {}) as AssignBody;
    const toUserId = b.toUserId === null || b.toUserId === "" ? null : String(b.toUserId ?? "");
    send(res, await pipeline.assignLead.execute({ leadId: String(req.params["id"]), toUserId, actor: a }));
  });

  // ---- Aktiviteler (Faz 6a): yetki lead'inkiyle aynı; tarih ISO metin gelir, doğrulama domain'de.
  r.post("/leads/:id/activities", async (req, res) => {
    const a = actor(req, res, true);
    if (!a) return;
    const b = (req.body ?? {}) as Partial<AddActivityBody>;
    const dueAt = typeof b.dueAt === "string" && b.dueAt ? new Date(b.dueAt) : null;
    const result = await pipeline.addActivity.execute({
      leadId: String(req.params["id"]),
      type: b.type,
      subject: b.subject ?? null,
      dueAt,
      notes: b.notes ?? null,
      actor: a,
    });
    if (!result.ok) return sendError(res, result.error);
    res.status(201).json(activityDto(result.value));
  });

  r.get("/activities/today", async (req, res) => {
    const a = actor(req, res, false);
    if (!a) return;
    const list = await pipeline.activities.today(a);
    res.json(<TodayDto>{
      overdue: list.overdue.map(todayItemDto),
      today: list.today.map(todayItemDto),
      upcoming: list.upcoming.map(todayItemDto),
    });
  });

  r.post("/activities/:id/done", async (req, res) => {
    const a = actor(req, res, true);
    if (!a) return;
    const b = (req.body ?? {}) as Partial<SetActivityDoneBody>;
    const result = await pipeline.setActivityDone.execute({
      activityId: String(req.params["id"]),
      done: b.done !== false,
      actor: a,
    });
    if (!result.ok) return sendError(res, result.error);
    res.json(activityDto(result.value));
  });

  r.delete("/activities/:id", async (req, res) => {
    const a = actor(req, res, true);
    if (!a) return;
    const result = await pipeline.deleteActivity.execute({ activityId: String(req.params["id"]), actor: a });
    if (!result.ok) return sendError(res, result.error);
    res.status(204).end();
  });

  // ---- Bildirimler: herkes yalnız kendininkini görür; okundu işareti veri değişikliği sayılmaz (görüntüleyici de yapabilir).
  r.get("/notifications", async (req, res) => {
    const a = actor(req, res, false);
    if (!a) return;
    const limit = Math.min(Number(req.query["limit"]) || 50, 200);
    const { items, unreadCount } = await deps.notifications.list(a, limit);
    res.json(<NotificationsDto>{ items: items.map(notificationDto), unreadCount });
  });

  r.post("/notifications/read-all", async (req, res) => {
    const a = actor(req, res, false);
    if (!a) return;
    res.json({ marked: await deps.notifications.markAllRead(a) });
  });

  r.post("/notifications/:id/read", async (req, res) => {
    const a = actor(req, res, false);
    if (!a) return;
    const ok = await deps.notifications.markRead(String(req.params["id"]), a);
    if (!ok) return res.status(404).json(<ApiErrorDto>{ error: "Bildirim bulunamadı.", code: "not_found" });
    res.json({ ok: true });
  });

  // Beklenmeyen hata: logla (kişisel veri maskelenir), ayrıntı dışarı sızmaz.
  r.use((err: unknown, req: Request, res: Response, _next: () => void) => {
    if (isAppError(err) && err.kind === "rule") return sendError(res, err as RuleError);
    logger.error("pipeline api hatası", { path: req.path, method: req.method, error: err });
    res.status(500).json(<ApiErrorDto>{ error: "Beklenmeyen hata. Lütfen tekrar deneyin.", code: "internal" });
  });

  return r;
}

const parseBody = (raw: string): Record<string, unknown> => {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
};

function activityDto(a: Activity): ActivityDto {
  return {
    id: a.id,
    leadId: a.leadId,
    type: a.type,
    subject: a.subject,
    dueAt: a.dueAt.toISOString(),
    doneAt: a.doneAt === null ? null : a.doneAt.toISOString(),
    notes: a.notes,
    autoCreated: a.autoCreated,
    createdByUserId: a.createdByUserId,
    createdAt: a.createdAt.toISOString(),
  };
}

function todayItemDto(x: ActivityWithLead): TodayItemDto {
  return {
    activity: activityDto(x.activity),
    lead: {
      id: x.lead.id,
      fullName: x.lead.fullName,
      company: x.lead.company,
      country: x.lead.country,
      currentStage: x.lead.currentStage,
      assignedUserId: x.lead.assignedUserId,
    },
  };
}

function notificationDto(n: Notification): NotificationDto {
  const body = parseBody(n.body);
  return {
    id: n.id,
    type: n.type,
    leadId: n.leadId,
    title: n.title,
    body,
    createdAt: n.createdAt.toISOString(),
    readAt: n.readAt === null ? null : n.readAt.toISOString(),
  };
}

const STATUS: Record<string, number> = {
  not_found: 404,
  "lead.forbidden": 403,
  "assign.forbidden": 403,
  "undo.not_owner": 403,
};

export function sendError(res: Response, error: RuleError): Response {
  const status = STATUS[error.code] ?? 422;
  return res.status(status).json(<ApiErrorDto>{ error: error.message, code: error.code, details: error.details });
}
