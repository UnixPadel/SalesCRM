import { Router, type Request, type Response } from "express";
import type { Db } from "../../shared/db";
import { RuleError, isAppError, type Logger, type Result } from "../../shared/kernel";
import type { Actor, ActivityWithLead, Notification, NotificationQueries, SalesPipeline } from "../application";
import { DEFAULT_EUR_RATES, QUALIFICATION_QUESTIONS, isStageCode, type EurRates } from "../domain";
import { readLostReasons, readStageDefinitions } from "../infrastructure";
import { registerAdminRoutes } from "./adminRoutes";
import { registerContactRoutes } from "./contactRoutes";
import { parseLeadFilter, registerTrackingRoutes, trackingReference } from "./trackingRoutes";
import { activityDto } from "./mappers";
import type {
  AddActivityBody,
  ApiErrorDto,
  AssignBody,
  BoardDto,
  ChangeStageBody,
  OrganizationBody,
  OrganizationDto,
  OrganizationSummaryDto,
  PersonSummaryDto,
  SearchDto,
  UpdateContactBody,
  CreateLeadBody,
  NotificationDto,
  NotificationsDto,
  ReferenceDto,
  ReportDto,
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
  /** Faz 7b: kurların güncel kaynağı (yönetim ekranı ayarı); verilirse `eurRates` yerine bu okunur. */
  eurRatesSource?: (() => Promise<EurRates>) | undefined;
  /** Yetki anahtarları (Faz 7g, D4); arayüze `/reference.permissions` olarak gider. */
  policy?: { repsEditProducts: boolean } | undefined;
  /** Satış ekibinin saat dilimi; verilmezse Europe/Istanbul. */
  timeZone?: string | undefined;
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

  // Faz 7g: temas kaydı uçları ayrı dosyada (iş emri §4.4).
  registerContactRoutes(r, { pipeline, actor, send, sendError });
  registerTrackingRoutes(r, { pipeline, actor, sendError });
  // Faz 7b/7d: bölge kuralları, kişi birleştirme, kuruluş arşivleme.
  registerAdminRoutes(r, { pipeline, actor, send, sendError });

  r.get("/reference", async (req, res) => {
    if (!actor(req, res, false)) return;
    const [stages, lostReasons, rates] = await Promise.all([
      readStageDefinitions(deps.db),
      readLostReasons(deps.db),
      deps.eurRatesSource ? deps.eurRatesSource() : Promise.resolve(deps.eurRates ?? DEFAULT_EUR_RATES),
    ]);
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
      eurRates: { ...rates },
      ...trackingReference(deps.policy ?? { repsEditProducts: false }, deps.timeZone),
    };
    res.json(body);
  });

  r.get("/leads", async (req, res) => {
    const a = actor(req, res, false);
    if (!a) return;
    // Faz 7g: ortak süzgeç (Lead listesi başlık menüleri, rapor hücresinden açılan liste).
    const limit = Math.min(Number(req.query["limit"]) || 500, 2000);
    res.json(await pipeline.queries.list({ actor: a, ...parseLeadFilter(req.query, a), limit }));
  });

  // Pano (Faz 6b): filtreler sorgu parametresi; kolon istatistikleri aynı filtrelenmiş kümeden.
  r.get("/board", async (req, res) => {
    const a = actor(req, res, false);
    if (!a) return;
    // Aşama süzgeci panoda yok (kolonlar aşamadır).
    const { stage: _stage, ...filter } = parseLeadFilter(req.query, a);
    const board = await pipeline.queries.board({ actor: a, ...filter });
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
      organizationId: b.organizationId ?? null,
      isTest: b.isTest === true,
      // Faz 7g: durum (satışçı da verir), ürün ve form cevapları (yalnız yönetici; kural application'da).
      ...(b.customerStatus !== undefined ? { customerStatus: b.customerStatus } : {}),
      ...(b.products !== undefined ? { products: b.products } : {}),
      ...(b.installSite !== undefined ? { installSite: b.installSite } : {}),
      ...(b.installTimeline !== undefined ? { installTimeline: b.installTimeline } : {}),
      ...(b.customerProfile !== undefined ? { customerProfile: b.customerProfile } : {}),
      ...(b.courtCountBand !== undefined ? { courtCountBand: b.courtCountBand } : {}),
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

  r.patch("/leads/:id/contact", async (req, res) => {
    const a = actor(req, res, true);
    if (!a) return;
    const b = (req.body ?? {}) as UpdateContactBody;
    send(
      res,
      await pipeline.updateLeadContact.execute({
        leadId: String(req.params["id"]),
        fullName: b.fullName,
        email: b.email,
        phone: b.phone,
        actor: a,
      }),
    );
  });

  // ---- Kuruluşlar ve kişiler (Faz 6d): ortak defter; herkes okur, yalnız admin yazar (Faz 7e, application katmanı).
  r.get("/organizations", async (req, res) => {
    const a = actor(req, res, false);
    if (!a) return;
    const search = typeof req.query["q"] === "string" ? req.query["q"].trim() || undefined : undefined;
    const limit = Math.min(Number(req.query["limit"]) || 500, 2000);
    // Faz 7d: `archived=1` arşivlenenleri de getirir (Kişiler sayfasındaki süzgeç).
    const includeArchived = req.query["archived"] === "1";
    const rows = await pipeline.people.organizations({ actor: a, search, limit, includeArchived });
    res.json(rows as unknown as OrganizationSummaryDto[]);
  });

  r.post("/organizations", async (req, res) => {
    const a = actor(req, res, true);
    if (!a) return;
    const b = (req.body ?? {}) as OrganizationBody & Record<string, unknown>;
    const result = await pipeline.createOrganization.execute({ fields: b, actor: a });
    if (!result.ok) return sendError(res, result.error);
    res.status(201).json(result.value as unknown as OrganizationDto);
  });

  r.patch("/organizations/:id", async (req, res) => {
    const a = actor(req, res, true);
    if (!a) return;
    const b = (req.body ?? {}) as OrganizationBody & Record<string, unknown>;
    send(
      res,
      await pipeline.updateOrganization.execute({ organizationId: String(req.params["id"]), fields: b, actor: a }),
    );
  });

  r.get("/persons", async (req, res) => {
    const a = actor(req, res, false);
    if (!a) return;
    const search = typeof req.query["q"] === "string" ? req.query["q"].trim() || undefined : undefined;
    const organizationId =
      typeof req.query["organizationId"] === "string" ? req.query["organizationId"].trim() || undefined : undefined;
    const limit = Math.min(Number(req.query["limit"]) || 500, 2000);
    const rows = await pipeline.people.persons({ actor: a, search, organizationId, limit });
    res.json(rows as unknown as PersonSummaryDto[]);
  });

  r.get("/search", async (req, res) => {
    const a = actor(req, res, false);
    if (!a) return;
    const q = typeof req.query["q"] === "string" ? req.query["q"] : "";
    res.json((await pipeline.people.search({ actor: a, q })) as unknown as SearchDto);
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
    const b = (req.body ?? {}) as { changeId?: unknown };
    send(
      res,
      await pipeline.undoStageChange.execute({
        leadId: String(req.params["id"]),
        actor: a,
        changeId: typeof b.changeId === "string" && b.changeId ? b.changeId : undefined,
      }),
    );
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

  // Raporlar (Faz 6c): görünür, test dışı lead'lerden; ay sayısı 1–36.
  r.get("/reports", async (req, res) => {
    const a = actor(req, res, false);
    if (!a) return;
    const months = Number(req.query["months"]);
    const report = await pipeline.reports.summary({ actor: a, months: Number.isFinite(months) ? months : undefined });
    res.json(report as ReportDto);
  });

  r.get("/activities/today", async (req, res) => {
    const a = actor(req, res, false);
    if (!a) return;
    const list = await pipeline.activities.today(a);
    res.json(<TodayDto>{
      overdue: list.overdue.map(todayItemDto),
      today: list.today.map(todayItemDto),
      upcoming: list.upcoming.map(todayItemDto),
      hotUncontacted: list.hotUncontacted,
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
      lastOutcome: x.lastOutcome ?? null,
      lastType: x.lastType ?? null,
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
  admin_only: 403,
  "lead.forbidden": 403,
  "assign.forbidden": 403,
  "undo.not_owner": 403,
};

export function sendError(res: Response, error: RuleError): Response {
  const status = STATUS[error.code] ?? 422;
  return res.status(status).json(<ApiErrorDto>{ error: error.message, code: error.code, details: error.details });
}
