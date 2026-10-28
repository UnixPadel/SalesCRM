import { NotFoundError, RuleError, err, ok, type Result } from "../../shared/kernel";
import { planStageChange, type DomainEvent, type Lead, type StageCode, type StageEvent } from "../domain";
import type { Actor, UseCaseDeps } from "./types";
import { canAct, territoriesOf } from "./visibility";

export interface ChangeLeadStageInput {
  leadId: string;
  target: StageCode;
  actor: Actor;
  value?: { amount: number; currency: string } | null;
  lostReasonCode?: string | null;
  qualificationAnswers?: Partial<Record<string, boolean>> | null;
}

export interface ChangeLeadStageResult {
  lead: Lead;
  changeId: string;
  events: StageEvent[];
  /** Havuzdaki lead'i değiştiren satışçı onu üstlenmiş olur. */
  assignedTo: string | null;
}

/**
 * Aşama sistemde yalnız buradan değişir (Genel plan): UI, API, toplu işlem hepsi bu komutu çağırır.
 * Tek transaction: current_stage + aşama olayları + etkin platform başına outbox satırı birlikte
 * yazılır; biri başarısızsa hiçbiri yazılmaz.
 */
export class ChangeLeadStage {
  constructor(private readonly deps: UseCaseDeps) {}

  async execute(input: ChangeLeadStageInput): Promise<Result<ChangeLeadStageResult, RuleError>> {
    const { uow, clock, ids, platforms, undoWindowMs } = this.deps;

    const outcome = await uow.run(
      async (repos): Promise<Result<ChangeLeadStageResult & { domainEvents: DomainEvent[] }, RuleError>> => {
        const lead = await repos.leads.findById(input.leadId);
        if (!lead) return err(new NotFoundError("Lead", input.leadId));

        const myCountries = input.actor.isAdmin ? [] : territoriesOf(input.actor.userId, await repos.territories.all());
        if (!canAct(lead, input.actor, myCountries)) {
          return err(new RuleError("lead.forbidden", "Bu lead başka bir satışçıya ait.", { leadId: lead.id }));
        }

        const plan = planStageChange({
          currentStage: lead.currentStage,
          target: input.target,
          value: input.value ?? null,
          lostReasonCode: input.lostReasonCode ?? null,
          qualificationAnswers: input.qualificationAnswers ?? null,
          knownLostReasons: await repos.lostReasons.activeCodes(),
        });
        if (!plan.ok) return plan;

        const now = clock.now();
        const changeId = ids.next();
        let sequence = await repos.stageEvents.nextSequence(lead.id);
        const events: StageEvent[] = [];
        const notBefore = new Date(now.getTime() + undoWindowMs);
        for (const draft of plan.value.events) {
          const event: StageEvent = {
            id: ids.next(),
            leadId: lead.id,
            changeId,
            stageCode: draft.stageCode,
            occurredAt: now,
            sequence: sequence++,
            actorUserId: input.actor.userId,
            origin: draft.origin,
            value: draft.value,
            lostReasonCode: draft.lostReasonCode,
            qualificationAnswers: draft.qualificationAnswers,
            undoneAt: null,
          };
          await repos.stageEvents.insert(event);
          if (!lead.isTest) {
            for (const provider of platforms.enabledProviders())
              await repos.outbox.enqueue(event.id, provider, notBefore);
          }
          events.push(event);
        }
        await repos.leads.updateStage(lead.id, plan.value.to, now);

        const domainEvents: DomainEvent[] = [
          {
            type: "LeadStageChanged",
            leadId: lead.id,
            changeId,
            from: plan.value.from,
            to: plan.value.to,
            actorUserId: input.actor.userId,
            occurredAt: now,
          },
        ];
        let assignedTo = lead.assignedUserId;
        if (lead.assignedUserId === null && !input.actor.isAdmin) {
          assignedTo = input.actor.userId;
          await repos.leads.updateAssignee(lead.id, assignedTo, now);
          domainEvents.push({
            type: "LeadAssigned",
            leadId: lead.id,
            from: null,
            to: assignedTo,
            actorUserId: input.actor.userId,
            occurredAt: now,
          });
        }
        return ok({
          lead: { ...lead, currentStage: plan.value.to, assignedUserId: assignedTo, updatedAt: now },
          changeId,
          events,
          assignedTo,
          domainEvents,
        });
      },
    );

    if (!outcome.ok) return outcome;
    await this.deps.events.publish(outcome.value.domainEvents);
    this.deps.logger.info("aşama değişti", {
      leadId: outcome.value.lead.id,
      changeId: outcome.value.changeId,
      to: outcome.value.lead.currentStage,
      events: outcome.value.events.length,
      actorUserId: input.actor.userId,
    });
    const { domainEvents: _d, ...result } = outcome.value;
    return ok(result);
  }
}
