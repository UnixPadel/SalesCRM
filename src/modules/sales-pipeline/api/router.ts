import { Router, type Request, type Response } from "express";
import type { Db } from "../../shared/db";
import { RuleError, isAppError, type Logger, type Result } from "../../shared/kernel";
import type { Actor, SalesPipeline } from "../application";
import { QUALIFICATION_QUESTIONS, isStageCode } from "../domain";
import { readLostReasons, readStageDefinitions } from "../infrastructure";
import type { ApiErrorDto, AssignBody, ChangeStageBody, CreateLeadBody, ReferenceDto } from "./dto";

export interface RouterDeps {
  pipeline: SalesPipeline;
  db: Db;
  logger: Logger;
  undoWindowMinutes: number;
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
      isTest: b.isTest === true,
      actor: a,
      ...(a.isAdmin && b.assignedUserId !== undefined ? { assignedUserId: b.assignedUserId } : {}),
    };
    send(res, await pipeline.createLead.execute(input), 201);
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

  // Beklenmeyen hata: logla (kişisel veri maskelenir), ayrıntı dışarı sızmaz.
  r.use((err: unknown, req: Request, res: Response, _next: () => void) => {
    if (isAppError(err) && err.kind === "rule") return sendError(res, err as RuleError);
    logger.error("pipeline api hatası", { path: req.path, method: req.method, error: err });
    res.status(500).json(<ApiErrorDto>{ error: "Beklenmeyen hata. Lütfen tekrar deneyin.", code: "internal" });
  });

  return r;
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
