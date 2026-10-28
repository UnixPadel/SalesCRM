import { NotFoundError, RuleError, err, ok, type Result } from "../../shared/kernel";
import type { Lead } from "../domain";
import type { Actor, UseCaseDeps } from "./types";
import { canSee, territoriesOf } from "./visibility";

export interface AssignLeadInput {
  leadId: string;
  /** null = havuza bırak */
  toUserId: string | null;
  actor: Actor;
}

/**
 * Sorumlu değiştirme. Admin herkese atar ya da havuza bırakır. Satışçı yalnız havuzdaki (görebildiği)
 * lead'i kendine alır ya da kendi lead'ini havuza bırakır; başkasına devredemez.
 */
export class AssignLead {
  constructor(private readonly deps: UseCaseDeps) {}

  async execute(input: AssignLeadInput): Promise<Result<Lead, RuleError>> {
    const { uow, clock } = this.deps;
    const outcome = await uow.run(async (repos): Promise<Result<{ lead: Lead; from: string | null }, RuleError>> => {
      const lead = await repos.leads.findById(input.leadId);
      if (!lead) return err(new NotFoundError("Lead", input.leadId));
      const myCountries = input.actor.isAdmin ? [] : territoriesOf(input.actor.userId, await repos.territories.all());
      if (!canSee(lead, input.actor, myCountries)) {
        return err(new RuleError("lead.forbidden", "Bu lead başka bir satışçıya ait.", { leadId: lead.id }));
      }
      if (!input.actor.isAdmin) {
        const takingForSelf = lead.assignedUserId === null && input.toUserId === input.actor.userId;
        const releasingOwn = lead.assignedUserId === input.actor.userId && input.toUserId === null;
        if (!takingForSelf && !releasingOwn) {
          return err(
            new RuleError("assign.forbidden", "Satışçı lead'i yalnız üstlenebilir ya da havuza bırakabilir.", {}),
          );
        }
      }
      const from = lead.assignedUserId;
      if (from === input.toUserId) return ok({ lead, from });
      const now = clock.now();
      await repos.leads.updateAssignee(lead.id, input.toUserId, now);
      return ok({ lead: { ...lead, assignedUserId: input.toUserId, updatedAt: now }, from });
    });
    if (!outcome.ok) return outcome;
    if (outcome.value.from !== outcome.value.lead.assignedUserId) {
      await this.deps.events.publish([
        {
          type: "LeadAssigned",
          leadId: outcome.value.lead.id,
          from: outcome.value.from,
          to: outcome.value.lead.assignedUserId,
          actorUserId: input.actor.userId,
          occurredAt: outcome.value.lead.updatedAt,
        },
      ]);
    }
    return ok(outcome.value.lead);
  }
}
