import { NotFoundError, RuleError, err, ok, type Result } from "../../shared/kernel";
import { isCustomerStatus, isWarningCode, type DomainEvent, type Lead } from "../domain";
import { requireAdmin } from "./permissions";
import type { Actor, UseCaseDeps } from "./types";
import { loadActionableLead } from "./visibility";

/**
 * Müşteri durumu (Faz 7g, D1): aşamadan bağımsız, Excel "Müşteri Durumu" sütunu. Yönetici, lead'in sahibi ya da
 * havuz lead'inde satışçı değiştirir (satışçıya atanır). Görüntüleyici api katmanında 403 alır.
 */
export interface SetCustomerStatusInput {
  leadId: string;
  status: unknown;
  actor: Actor;
}

export class SetCustomerStatus {
  constructor(private readonly deps: UseCaseDeps) {}

  async execute(input: SetCustomerStatusInput): Promise<Result<Lead, RuleError>> {
    const status = input.status === "" || input.status === undefined ? null : input.status;
    if (status !== null && !isCustomerStatus(status)) {
      return err(new RuleError("lead.customer_status", "Müşteri durumu listede yok.", { customerStatus: status }));
    }
    const { uow, clock } = this.deps;
    const out = await uow.run(async (repos): Promise<Result<{ lead: Lead; events: DomainEvent[] }, RuleError>> => {
      const loaded = await loadActionableLead(repos, input.leadId, input.actor);
      if (!loaded.ok) return loaded;
      const lead = loaded.value;
      const now = clock.now();
      const events: DomainEvent[] = [];
      if (lead.customerStatus !== status) await repos.leads.setCustomerStatus(lead.id, status, now);
      let assignedUserId = lead.assignedUserId;
      if (assignedUserId === null && !input.actor.isAdmin) {
        assignedUserId = input.actor.userId;
        await repos.leads.updateAssignee(lead.id, assignedUserId, now);
        events.push({
          type: "LeadAssigned",
          leadId: lead.id,
          from: null,
          to: assignedUserId,
          actorUserId: input.actor.userId,
          occurredAt: now,
        });
      }
      return ok({ lead: { ...lead, customerStatus: status, assignedUserId, updatedAt: now }, events });
    });
    if (!out.ok) return out;
    if (out.value.events.length) await this.deps.events.publish(out.value.events);
    this.deps.logger.info("müşteri durumu değişti", {
      leadId: out.value.lead.id,
      customerStatus: status,
      actorUserId: input.actor.userId,
    });
    return ok(out.value.lead);
  }
}

export interface CheckWarningInput {
  leadId: string;
  code: unknown;
  checked: boolean;
  actor: Actor;
}

/** Veri uyarısını "Kontrol edildi" yapar ya da geri alır (D6): yalnız yönetici; idempotent. */
export class CheckWarning {
  constructor(private readonly deps: UseCaseDeps) {}

  async execute(input: CheckWarningInput): Promise<Result<Lead, RuleError>> {
    const allowed = requireAdmin(input.actor, "warnings");
    if (!allowed.ok) return allowed;
    if (!isWarningCode(input.code)) {
      return err(new RuleError("warning.code", "Bilinmeyen uyarı kodu.", { code: input.code }));
    }
    const code = input.code;
    return this.deps.uow.run(async (repos): Promise<Result<Lead, RuleError>> => {
      const lead = await repos.leads.findById(input.leadId);
      if (!lead) return err(new NotFoundError("Lead", input.leadId));
      const has = lead.checkedWarnings.includes(code);
      if (has === input.checked) return ok(lead);
      const codes = input.checked ? [...lead.checkedWarnings, code] : lead.checkedWarnings.filter((c) => c !== code);
      const now = this.deps.clock.now();
      await repos.leads.setCheckedWarnings(lead.id, codes, now);
      return ok({ ...lead, checkedWarnings: codes, updatedAt: now });
    });
  }
}
