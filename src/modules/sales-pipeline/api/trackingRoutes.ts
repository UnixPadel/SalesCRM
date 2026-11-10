import type { Request, Response, Router } from "express";
import type { RuleError, Result } from "../../shared/kernel";
import {
  isContactFilter,
  type Actor,
  type HistoryItem,
  type LeadFilterInput,
  type SalesPipeline,
} from "../application";
import {
  ACTIVITY_OUTCOMES,
  ACTIVITY_TYPES,
  CONTACT_CHANNELS,
  CONTACT_RULES,
  COURT_COUNT_BANDS,
  COURT_PRODUCTS,
  CUSTOMER_PROFILES,
  CUSTOMER_STATUSES,
  CUSTOMER_STATUS_STYLE,
  DEFAULT_TIME_ZONE,
  IMPORT_ISSUE_CODES,
  INSTALL_SITES,
  INSTALL_TIMELINES,
  NO_NEXT_TARGETS,
  OUTCOME_DISPLAY_ORDER,
  PRODUCT_QTY_MAX,
  REPLY_OUTCOMES,
  REP_VISIBLE_WARNINGS,
  WARNING_CODES,
  WARNING_SEVERITY,
  isLeadSource,
  isStageCode,
  timelineHeat,
  type LeadSource,
  type StageCode,
} from "../domain";
import type { TrackingReferenceDto, TrackingReportDto } from "./dto";
import type { ContactHistoryDto, ContactHistoryItemDto } from "./dto.contact";
import { activityDto } from "./mappers";

/**
 * Faz 7g okuma uçları (iş emri §4.4): Temas geçmişi, Özet rapor ve ortak lead süzgecinin tek ayrıştırıcısı
 * (`parseLeadFilter`, `/leads` ve `/board`). `router.ts` yalnız bağlar.
 */
export interface TrackingRouteDeps {
  pipeline: SalesPipeline;
  actor(req: Request, res: Response, write: boolean): (Actor & { readOnly: boolean }) | undefined;
  sendError(res: Response, error: RuleError): Response;
}

/** Sorgu değeri: tek metin, virgüllü metin ya da tekrarlanan anahtar → temiz liste. */
function many(v: unknown): string[] {
  const raw = Array.isArray(v) ? v : typeof v === "string" ? [v] : [];
  return raw
    .flatMap((x) => (typeof x === "string" ? x.split(",") : []))
    .map((x) => x.trim())
    .filter(Boolean);
}

const one = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);

/**
 * Ortak lead süzgeci [U-I14]: `owner` (kimlik, `me`, `pool`; virgüllü), `country`, `source`, `stage` (liste),
 * `rotting=1`, `contact`, `hot=1`, `warning=1`, `scope=excel`, `campaign`, `q`, `includeTest=1`.
 */
export function parseLeadFilter(
  query: Request["query"],
  actor: Actor,
): LeadFilterInput & { stage?: readonly StageCode[] | undefined } {
  const owners = many(query["owner"]).map((o) => (o === "pool" ? null : o === "me" ? actor.userId : o));
  const countries = many(query["country"])
    .map((c) => c.toUpperCase())
    .filter((c) => /^[A-Z]{2}$/.test(c));
  const sources = many(query["source"]).filter((s): s is LeadSource => isLeadSource(s));
  const stages = many(query["stage"]).filter((s): s is StageCode => isStageCode(s));
  const contact = one(query["contact"]);
  return {
    owner: owners.length ? owners : undefined,
    country: countries.length ? countries : undefined,
    source: sources.length ? sources : undefined,
    stage: stages.length ? stages : undefined,
    rotting: query["rotting"] === "1",
    contact: isContactFilter(contact) ? contact : undefined,
    hot: query["hot"] === "1",
    warning: query["warning"] === "1",
    scope: query["scope"] === "excel" ? "excel" : undefined,
    campaign: one(query["campaign"]),
    search: one(query["q"]),
    includeTest: query["includeTest"] === "1",
  };
}

/** /reference'ın Faz 7g listeleri. */
export function trackingReference(policy: { repsEditProducts: boolean }, timeZone?: string): TrackingReferenceDto {
  return {
    activityTypes: [...ACTIVITY_TYPES],
    contactChannels: [...CONTACT_CHANNELS],
    activityOutcomes: [...ACTIVITY_OUTCOMES],
    outcomeDisplayOrder: [...OUTCOME_DISPLAY_ORDER],
    replyOutcomes: [...REPLY_OUTCOMES],
    contactRules: {
      defaultOutcome: { ...CONTACT_RULES.defaultOutcome },
      repliedFlagOutcomes: [...CONTACT_RULES.repliedFlagOutcomes],
      repliedDefaultTypes: [...CONTACT_RULES.repliedDefaultTypes],
      statusOutcomes: [...CONTACT_RULES.statusOutcomes],
      statusSuggestsLost: [...CONTACT_RULES.statusSuggestsLost],
      noNextTargets: [...NO_NEXT_TARGETS],
      noteMax: CONTACT_RULES.noteMax,
      minContactDate: CONTACT_RULES.minContactDate,
      futureToleranceMinutes: CONTACT_RULES.futureToleranceMinutes,
    },
    timeZone: timeZone ?? DEFAULT_TIME_ZONE,
    customerStatuses: CUSTOMER_STATUSES.map((code) => ({ code, ...CUSTOMER_STATUS_STYLE[code] })),
    installSites: [...INSTALL_SITES],
    installTimelines: INSTALL_TIMELINES.map((code) => ({ code, heat: timelineHeat(code) ?? "cold" })),
    customerProfiles: [...CUSTOMER_PROFILES],
    courtCountBands: [...COURT_COUNT_BANDS],
    products: [
      ...COURT_PRODUCTS.map((code) => ({ code, kind: "court" as const })),
      { code: "roof", kind: "roof" as const },
    ],
    productQtyMax: PRODUCT_QTY_MAX,
    warningCodes: WARNING_CODES.map((code) => ({
      code,
      severity: WARNING_SEVERITY[code],
      repVisible: REP_VISIBLE_WARNINGS.includes(code),
    })),
    importIssueCodes: [...IMPORT_ISSUE_CODES],
    permissions: { repsEditProducts: policy.repsEditProducts },
  };
}

function historyItemDto(x: HistoryItem): ContactHistoryItemDto {
  return {
    activity: activityDto(x.activity),
    lead: {
      id: x.lead.id,
      fullName: x.lead.fullName,
      company: x.lead.company,
      currentStage: x.lead.currentStage,
      assignedUserId: x.lead.assignedUserId,
    },
    next: x.next ? { id: x.next.id, type: x.next.type, dueAt: x.next.dueAt.toISOString() } : null,
  };
}

export function registerTrackingRoutes(r: Router, deps: TrackingRouteDeps): void {
  const { pipeline, actor, sendError } = deps;
  const reply = <T>(res: Response, result: Result<T, RuleError>, map: (v: T) => unknown) =>
    result.ok ? res.json(map(result.value)) : sendError(res, result.error);

  r.get("/activities/history", async (req, res) => {
    const a = actor(req, res, false);
    if (!a) return;
    const q = req.query;
    const owner = one(q["owner"]);
    const result = await pipeline.history.history({
      actor: a,
      from: one(q["from"]),
      to: one(q["to"]),
      type: one(q["type"]),
      outcome: one(q["outcome"]),
      owner: owner === "me" ? a.userId : owner,
      doneBy: one(q["doneBy"]) === "me" ? a.userId : one(q["doneBy"]),
      q: one(q["q"]),
      note: one(q["note"]),
      before: one(q["before"]),
      limit: Number(q["limit"]) || undefined,
    });
    reply(res, result, (page): ContactHistoryDto => ({
      items: page.items.map(historyItemDto),
      nextBefore: page.nextBefore,
    }));
  });

  r.get("/reports/tracking", async (req, res) => {
    const a = actor(req, res, false);
    if (!a) return;
    const q = req.query;
    const owner = one(q["owner"]);
    const result = await pipeline.reports.tracking({
      actor: a,
      from: one(q["from"]),
      to: one(q["to"]),
      source: one(q["source"]),
      campaign: one(q["campaign"]),
      owner: owner === "me" ? a.userId : owner,
      scope: q["scope"] === "excel" ? "excel" : undefined,
    });
    reply(res, result, (report) => JSON.parse(JSON.stringify(report)) as TrackingReportDto);
  });
}
