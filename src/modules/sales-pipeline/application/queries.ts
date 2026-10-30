import { NotFoundError, RuleError, err, ok, type Result } from "../../shared/kernel";
import {
  allowedTransitions,
  planUndo,
  type Lead,
  type LeadAttribution,
  type LeadConsent,
  type LeadSource,
  type StageCode,
  type StageEvent,
  type StageEventOrigin,
} from "../domain";
import type { Actor, UseCaseDeps } from "./types";
import { canSee, territoriesOf } from "./visibility";

export interface LeadDetail {
  lead: Lead;
  events: StageEvent[];
  /** Arayüz aşama kuralını tekrar yazmaz; izinli geçişleri buradan okur. */
  allowedTransitions: readonly StageCode[];
  undo: { available: boolean; reason?: string; untilIso?: string };
}

export interface ListLeadsInput {
  actor: Actor;
  stage?: StageCode | undefined;
  search?: string | undefined;
  includeTest?: boolean | undefined;
  limit?: number | undefined;
}

/**
 * Giden olay dağıtıcısının (ad-feedback) bir aşama olayını platforma çevirmek için gereken her şey.
 * Modüller arası tek kapı: dağıtıcı sales-pipeline tablolarını okumaz, bu DTO'yu alır.
 */
export interface OutboundStageEvent {
  stageEventId: string;
  leadId: string;
  stageCode: StageCode;
  occurredAt: Date;
  undoneAt: Date | null;
  origin: StageEventOrigin;
  value: { amount: number; currency: string } | null;
  lead: {
    source: LeadSource;
    platformLeadId: string | null;
    /** Normalize e-posta (küçük harf, boşluksuz) ya da null. */
    email: string | null;
    /** E.164 ("+90…") ya da null. */
    phoneE164: string | null;
    isTest: boolean;
    country: string | null;
  };
  attribution: LeadAttribution | null;
  consents: LeadConsent[];
}

export class LeadQueries {
  constructor(private readonly deps: UseCaseDeps) {}

  /** Aşama olayı kimlikleri → dağıtım bağlamı; bulunamayan olay ya da lead atlanır. */
  async outboundContext(stageEventIds: readonly string[]): Promise<OutboundStageEvent[]> {
    if (!stageEventIds.length) return [];
    return this.deps.uow.run(async (repos) => {
      const events = await repos.stageEvents.findByIds(stageEventIds);
      const leadIds = [...new Set(events.map((e) => e.leadId))];
      const leads = new Map<string, Lead>();
      const attributions = new Map<string, LeadAttribution | undefined>();
      const consents = new Map<string, LeadConsent[]>();
      for (const id of leadIds) {
        const lead = await repos.leads.findById(id);
        if (!lead) continue;
        leads.set(id, lead);
        attributions.set(id, await repos.leads.findAttribution(id));
        consents.set(id, await repos.leads.findConsents(id));
      }
      const out: OutboundStageEvent[] = [];
      for (const e of events) {
        const lead = leads.get(e.leadId);
        if (!lead) continue;
        out.push({
          stageEventId: e.id,
          leadId: lead.id,
          stageCode: e.stageCode,
          occurredAt: e.occurredAt,
          undoneAt: e.undoneAt,
          origin: e.origin,
          value: e.value,
          lead: {
            source: lead.source,
            platformLeadId: lead.platformLeadId,
            email: lead.email,
            phoneE164: lead.phoneE164,
            isTest: lead.isTest,
            country: lead.country,
          },
          attribution: attributions.get(lead.id) ?? null,
          consents: consents.get(lead.id) ?? [],
        });
      }
      return out;
    });
  }

  async list(input: ListLeadsInput): Promise<Lead[]> {
    return this.deps.uow.run(async (repos) => {
      const visibleTo = input.actor.isAdmin
        ? undefined
        : { userId: input.actor.userId, countries: territoriesOf(input.actor.userId, await repos.territories.all()) };
      return repos.leads.list({
        visibleTo,
        stage: input.stage,
        search: input.search,
        includeTest: input.includeTest,
        limit: input.limit,
      });
    });
  }

  /** Tıklama kimlikleri; yoksa undefined. Yalnız iç kullanım ve testler (erişim denetimi `get` ile). */
  async attribution(leadId: string): Promise<LeadAttribution | undefined> {
    return this.deps.uow.run((repos) => repos.leads.findAttribution(leadId));
  }

  /** Onay kayıtları; iç kullanım ve testler. */
  async consents(leadId: string): Promise<LeadConsent[]> {
    return this.deps.uow.run((repos) => repos.leads.findConsents(leadId));
  }

  async get(leadId: string, actor: Actor): Promise<Result<LeadDetail, RuleError>> {
    return this.deps.uow.run(async (repos) => {
      const lead = await repos.leads.findById(leadId);
      if (!lead) return err(new NotFoundError("Lead", leadId));
      const myCountries = actor.isAdmin ? [] : territoriesOf(actor.userId, await repos.territories.all());
      if (!canSee(lead, actor, myCountries)) return err(new NotFoundError("Lead", leadId));
      const events = await repos.stageEvents.listByLead(lead.id);
      const now = this.deps.clock.now();
      const undo = planUndo({
        events,
        now,
        windowMs: this.deps.undoWindowMs,
        actorUserId: actor.userId,
        actorIsAdmin: actor.isAdmin,
      });
      const last = events.filter((e) => !e.undoneAt).sort((a, b) => b.sequence - a.sequence)[0];
      return ok({
        lead,
        events,
        allowedTransitions: allowedTransitions(lead.currentStage),
        undo: undo.ok
          ? {
              available: true,
              untilIso: new Date((last?.occurredAt.getTime() ?? 0) + this.deps.undoWindowMs).toISOString(),
            }
          : { available: false, reason: undo.error.code },
      });
    });
  }
}
