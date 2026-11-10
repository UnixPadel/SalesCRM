import type { Request, Response, Router } from "express";
import { RuleError, type Result } from "../../shared/kernel";
import type { Actor, ContactForm, LogContactResult, SalesPipeline } from "../application";
import { isStageCode } from "../domain";
import type {
  ContactFormDto,
  CustomerStatusBody,
  LogContactBody,
  LogContactResultDto,
  UndoLogContactResultDto,
} from "./dto.contact";
import { activityDto } from "./mappers";

/**
 * Faz 7g temas kaydı uçları (iş emri §4.4). `router.ts` yalnız bağlar; iş kuralı application katmanındadır.
 */
export interface ContactRouteDeps {
  pipeline: SalesPipeline;
  actor(req: Request, res: Response, write: boolean): (Actor & { readOnly: boolean }) | undefined;
  send<T>(res: Response, result: Result<T, RuleError>, okStatus?: number): unknown;
  sendError(res: Response, error: RuleError): Response;
}

const isoOrNull = (v: unknown): Date | null => {
  if (typeof v !== "string" || !v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? new Date(NaN) : d;
};

export function registerContactRoutes(r: Router, deps: ContactRouteDeps): void {
  const { pipeline, actor, send, sendError } = deps;

  r.get("/leads/:id/contact-form", async (req, res) => {
    const a = actor(req, res, false);
    if (!a) return;
    const result = await pipeline.contactForm.get(String(req.params["id"]), a);
    if (!result.ok) return sendError(res, result.error);
    res.json(contactFormDto(result.value));
  });

  r.post("/leads/:id/contacts", async (req, res) => {
    const a = actor(req, res, true);
    if (!a) return;
    const b = (req.body ?? {}) as Partial<LogContactBody>;
    if (b.stage && !isStageCode(b.stage.target)) {
      return sendError(res, new RuleError("stage.unknown", "Bilinmeyen aşama kodu.", { stage: b.stage.target }));
    }
    const result = await pipeline.logContact.execute({
      leadId: String(req.params["id"]),
      actor: a,
      activityId: typeof b.activityId === "string" && b.activityId ? b.activityId : null,
      type: b.type,
      outcome: b.outcome,
      customerReplied: b.customerReplied === true,
      occurredAt: b.occurredAt === undefined ? null : isoOrNull(b.occurredAt),
      note: typeof b.note === "string" ? b.note : "",
      next: b.next
        ? {
            type: b.next.type,
            dueAt: isoOrNull(b.next.dueAt),
            subject: b.next.subject ?? null,
            notes: b.next.notes ?? null,
          }
        : null,
      quick: b.quick === true,
      ...(b.customerStatus !== undefined ? { customerStatus: b.customerStatus } : {}),
      stage: b.stage
        ? { target: b.stage.target, value: b.stage.value ?? null, lostReasonCode: b.stage.lostReasonCode ?? null }
        : null,
    });
    if (!result.ok) return sendError(res, result.error);
    res.status(201).json(logContactResultDto(result.value));
  });

  r.post("/contact-logs/:logId/undo", async (req, res) => {
    const a = actor(req, res, true);
    if (!a) return;
    const result = await pipeline.undoLogContact.execute({ logId: String(req.params["logId"]), actor: a });
    if (!result.ok) return sendError(res, result.error);
    res.json(<UndoLogContactResultDto>result.value);
  });

  r.put("/leads/:id/customer-status", async (req, res) => {
    const a = actor(req, res, true);
    if (!a) return;
    const b = (req.body ?? {}) as Partial<CustomerStatusBody>;
    send(
      res,
      await pipeline.setCustomerStatus.execute({
        leadId: String(req.params["id"]),
        status: b.status ?? null,
        actor: a,
      }),
    );
  });

  const check = (checked: boolean) => async (req: Request, res: Response) => {
    const a = actor(req, res, true);
    if (!a) return;
    send(
      res,
      await pipeline.checkWarning.execute({
        leadId: String(req.params["id"]),
        code: String(req.params["code"]),
        checked,
        actor: a,
      }),
    );
  };
  r.post("/leads/:id/warnings/:code/check", check(true));
  r.delete("/leads/:id/warnings/:code/check", check(false));
}

function contactFormDto(f: ContactForm): ContactFormDto {
  const defaults: ContactFormDto["defaults"] = {};
  for (const [type, perOutcome] of Object.entries(f.defaults)) {
    const out = {} as NonNullable<ContactFormDto["defaults"][keyof ContactFormDto["defaults"]]>;
    for (const [outcome, d] of Object.entries(perOutcome)) {
      out[outcome as keyof typeof out] = {
        stage: d.stage,
        next: d.next ? { type: d.next.type, dueAt: d.next.dueAt.toISOString(), subject: d.next.subject } : null,
      };
    }
    defaults[type as keyof typeof defaults] = out;
  }
  return {
    lead: {
      id: f.lead.id,
      fullName: f.lead.fullName,
      currentStage: f.lead.currentStage,
      assignedUserId: f.lead.assignedUserId,
      customerStatus: f.lead.customerStatus,
      createdAt: f.lead.createdAt.toISOString(),
    },
    openActivities: f.openActivities.map((a) => ({
      id: a.id,
      type: a.type,
      subject: a.subject,
      dueAt: a.dueAt.toISOString(),
    })),
    completableId: f.completableId,
    channels: f.channels,
    defaultType: f.defaultType,
    defaults,
    canSetStatus: f.canSetStatus,
    assignsOnSave: f.assignsOnSave,
    now: f.now.toISOString(),
    timeZone: f.timeZone,
  };
}

function logContactResultDto(r: LogContactResult): LogContactResultDto {
  return {
    logId: r.logId,
    activity: activityDto(r.activity),
    next: r.next ? activityDto(r.next) : null,
    stage: r.stage,
    assignedTo: r.assignedTo,
    undoUntil: r.undoUntil.toISOString(),
    lead: JSON.parse(JSON.stringify(r.lead)) as LogContactResultDto["lead"],
  };
}
