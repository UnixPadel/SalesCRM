import { NotFoundError, RuleError, err, ok, type Result } from "../../shared/kernel";
import {
  allowedTransitions,
  planUndo,
  type Lead,
  type LeadAttribution,
  type LeadConsent,
  type StageCode,
  type StageEvent,
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

export class LeadQueries {
  constructor(private readonly deps: UseCaseDeps) {}

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
