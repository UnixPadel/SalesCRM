import { NotFoundError, RuleError, err, ok, type Result } from "../../shared/kernel";
import { planUndo, type Lead, type StageCode } from "../domain";
import type { Actor, UseCaseDeps } from "./types";
import { canAct, territoriesOf } from "./visibility";

export interface UndoStageChangeInput {
  leadId: string;
  actor: Actor;
}

export interface UndoStageChangeResult {
  lead: Lead;
  changeId: string;
  revertedTo: StageCode;
}

/** 10 dakikalık geri al: olaylar silinmez (undone_at), outbox satırları skipped olur, aşama geri döner. */
export class UndoStageChange {
  constructor(private readonly deps: UseCaseDeps) {}

  async execute(input: UndoStageChangeInput): Promise<Result<UndoStageChangeResult, RuleError>> {
    const { uow, clock, undoWindowMs } = this.deps;
    const outcome = await uow.run(async (repos): Promise<Result<UndoStageChangeResult, RuleError>> => {
      const lead = await repos.leads.findById(input.leadId);
      if (!lead) return err(new NotFoundError("Lead", input.leadId));
      const myCountries = input.actor.isAdmin ? [] : territoriesOf(input.actor.userId, await repos.territories.all());
      if (!canAct(lead, input.actor, myCountries)) {
        return err(new RuleError("lead.forbidden", "Bu lead başka bir satışçıya ait.", { leadId: lead.id }));
      }
      const now = clock.now();
      const plan = planUndo({
        events: await repos.stageEvents.listByLead(lead.id),
        now,
        windowMs: undoWindowMs,
        actorUserId: input.actor.userId,
        actorIsAdmin: input.actor.isAdmin,
      });
      if (!plan.ok) return plan;

      await repos.stageEvents.markUndone(plan.value.eventIds, now, input.actor.userId);
      await repos.outbox.skipForEvents(plan.value.eventIds, "undone");
      await repos.leads.updateStage(lead.id, plan.value.revertTo, now);
      return ok({
        lead: { ...lead, currentStage: plan.value.revertTo, updatedAt: now },
        changeId: plan.value.changeId,
        revertedTo: plan.value.revertTo,
      });
    });

    if (!outcome.ok) return outcome;
    await this.deps.events.publish([
      {
        type: "LeadStageChangeUndone",
        leadId: outcome.value.lead.id,
        changeId: outcome.value.changeId,
        revertedTo: outcome.value.revertedTo,
        actorUserId: input.actor.userId,
        occurredAt: outcome.value.lead.updatedAt,
      },
    ]);
    this.deps.logger.info("aşama değişikliği geri alındı", {
      leadId: outcome.value.lead.id,
      changeId: outcome.value.changeId,
      revertedTo: outcome.value.revertedTo,
    });
    return outcome;
  }
}
