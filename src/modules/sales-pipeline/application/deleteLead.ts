import { NotFoundError, RuleError, err, ok, type Result } from "../../shared/kernel";
import type { Lead } from "../domain";
import { requireAdmin } from "./permissions";
import type { Actor, UseCaseDeps } from "./types";

/**
 * Lead silme (2026-11-24): yalnız yönetici siler, satışçı ve görüntüleyici silemez. Silme "çöp kutusu"dur: kayıt ve
 * bütün geçmişi (aşamalar, temaslar, aktiviteler, dosyalar) yerinde kalır; lead listeden, panodan, kişi/kuruluş
 * sayfalarından, raporlardan, bildirimlerden ve reklam dönüşüm akışından düşer. Yönetici "Silinenler"den geri alır.
 * Gerekçe zorunludur.
 */
export const LEAD_DELETE_REASON_MIN = 3;
export const LEAD_DELETE_REASON_MAX = 500;

export function validateLeadDeleteReason(raw: unknown): Result<string, RuleError> {
  const reason = typeof raw === "string" ? raw.trim() : "";
  if (reason.length < LEAD_DELETE_REASON_MIN) {
    return err(new RuleError("lead.delete_reason", "Silme nedeni yazılmalı.", { min: LEAD_DELETE_REASON_MIN }));
  }
  return ok(reason.slice(0, LEAD_DELETE_REASON_MAX));
}

export interface DeleteLeadInput {
  leadId: string;
  actor: Actor;
  reason: unknown;
}

export class DeleteLead {
  constructor(private readonly deps: UseCaseDeps) {}

  async execute(input: DeleteLeadInput): Promise<Result<Lead, RuleError>> {
    const allowed = requireAdmin(input.actor, "lead_delete");
    if (!allowed.ok) return allowed;
    const reason = validateLeadDeleteReason(input.reason);
    if (!reason.ok) return reason;
    const { uow, clock } = this.deps;
    const out = await uow.run(async (repos): Promise<Result<Lead, RuleError>> => {
      const lead = await repos.leads.findByIdIncludingDeleted(input.leadId);
      if (!lead) return err(new NotFoundError("Lead", input.leadId));
      if (lead.deletion) return err(new RuleError("lead.deleted", "Bu lead zaten silinmiş."));
      const at = clock.now();
      const deletion = { at, by: input.actor.userId, reason: reason.value };
      await repos.leads.markDeleted(lead.id, deletion, at);
      return ok({ ...lead, deletion, updatedAt: at });
    });
    if (out.ok) {
      await this.deps.actions?.record({
        actor: input.actor,
        action: "lead.deleted",
        lead: { id: out.value.id, fullName: out.value.fullName },
        details: { reason: reason.value },
      });
      this.deps.logger.info("lead silindi", { leadId: out.value.id, actorUserId: input.actor.userId });
    }
    return out;
  }
}

export interface RestoreLeadInput {
  leadId: string;
  actor: Actor;
}

export class RestoreLead {
  constructor(private readonly deps: UseCaseDeps) {}

  async execute(input: RestoreLeadInput): Promise<Result<Lead, RuleError>> {
    const allowed = requireAdmin(input.actor, "lead_delete");
    if (!allowed.ok) return allowed;
    const { uow, clock } = this.deps;
    const out = await uow.run(async (repos): Promise<Result<Lead, RuleError>> => {
      const lead = await repos.leads.findByIdIncludingDeleted(input.leadId);
      if (!lead) return err(new NotFoundError("Lead", input.leadId));
      if (!lead.deletion) return err(new RuleError("lead.not_deleted", "Bu lead silinmemiş."));
      const at = clock.now();
      await repos.leads.restore(lead.id, at);
      return ok({ ...lead, deletion: null, updatedAt: at });
    });
    if (out.ok) {
      await this.deps.actions?.record({
        actor: input.actor,
        action: "lead.restored",
        lead: { id: out.value.id, fullName: out.value.fullName },
      });
      this.deps.logger.info("silinen lead geri alındı", { leadId: out.value.id, actorUserId: input.actor.userId });
    }
    return out;
  }
}

/** Yöneticinin "Silinenler" listesi. */
export class DeletedLeadQueries {
  constructor(private readonly deps: UseCaseDeps) {}

  list(actor: Actor): Promise<Result<Lead[], RuleError>> {
    const allowed = requireAdmin(actor, "lead_delete");
    if (!allowed.ok) return Promise.resolve(allowed);
    return this.deps.uow.run(async (repos) => ok(await repos.leads.listDeleted()));
  }
}
