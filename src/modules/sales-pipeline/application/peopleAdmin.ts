/**
 * Kişi birleştirme ve kuruluş arşivleme (Faz 7d). Yalnız yönetici (Faz 7e: müşteri kaydını yalnız yönetici değiştirir).
 *  - Birleştirme tek transaction: kaynağın lead'leri (aktiviteleri lead'le gelir) hedefe taşınır; hedefte boş olan
 *    e-posta / telefon / firma / ülke / kuruluş kaynaktan dolar; kaynak silinmez, hedefi gösterir ve listelerde gizlenir.
 *  - Arşiv: kuruluş listelerden ve seçim kutularından düşer; bağlı kişi ve lead'ler kalır. Silme yok; geri alınır.
 */
import { NotFoundError, RuleError, err, ok, type Result } from "../../shared/kernel";
import { planPersonMerge, type Organization, type Person } from "../domain";
import { requireAdmin } from "./permissions";
import type { Actor, UseCaseDeps } from "./types";

export interface MergePersonsResult {
  person: Person;
  movedLeads: number;
}

export class MergePersons {
  constructor(private readonly deps: UseCaseDeps) {}

  async execute(input: {
    targetId: string;
    sourceId: string;
    actor: Actor;
  }): Promise<Result<MergePersonsResult, RuleError>> {
    const allowed = requireAdmin(input.actor, "person");
    if (!allowed.ok) return allowed;
    const { uow, clock, logger } = this.deps;
    const outcome = await uow.run(async (repos): Promise<Result<MergePersonsResult, RuleError>> => {
      const [target, source] = await Promise.all([
        repos.persons.findById(input.targetId),
        repos.persons.findById(input.sourceId),
      ]);
      if (!target) return err(new NotFoundError("Kişi", input.targetId));
      if (!source) return err(new NotFoundError("Kişi", input.sourceId));
      const plan = planPersonMerge(target, source);
      if (!plan.ok) return plan;
      const now = clock.now();
      const movedLeads = await repos.leads.movePerson(source.id, target.id, now);
      // E-posta ve telefon kişi başına tekildir: önce kaynaktan düşer, sonra hedefe yazılır.
      if (Object.keys(plan.value.sourcePatch).length) await repos.persons.update(source.id, plan.value.sourcePatch);
      if (Object.keys(plan.value.targetPatch).length) await repos.persons.update(target.id, plan.value.targetPatch);
      await repos.persons.markMerged(source.id, target.id);
      return ok({ person: { ...target, ...plan.value.targetPatch }, movedLeads });
    });
    if (outcome.ok) {
      logger.info("kişiler birleştirildi", {
        targetId: input.targetId,
        sourceId: input.sourceId,
        movedLeads: outcome.value.movedLeads,
        actorUserId: input.actor.userId,
      });
    }
    return outcome;
  }
}

export class ArchiveOrganization {
  constructor(private readonly deps: UseCaseDeps) {}

  /** `archived: false` arşivden çıkarır. Zaten istenen durumdaysa değişiklik yapmadan döner. */
  async execute(input: {
    organizationId: string;
    archived: boolean;
    actor: Actor;
  }): Promise<Result<Organization, RuleError>> {
    const allowed = requireAdmin(input.actor, "organization");
    if (!allowed.ok) return allowed;
    const { uow, clock, logger } = this.deps;
    return uow.run(async (repos): Promise<Result<Organization, RuleError>> => {
      const current = await repos.organizations.findById(input.organizationId);
      if (!current) return err(new NotFoundError("Kuruluş", input.organizationId));
      if ((current.archivedAt !== null) === input.archived) return ok(current);
      const now = clock.now();
      const archivedAt = input.archived ? now : null;
      await repos.organizations.setArchived(current.id, archivedAt, now);
      logger.info(input.archived ? "kuruluş arşivlendi" : "kuruluş arşivden çıkarıldı", {
        organizationId: current.id,
        actorUserId: input.actor.userId,
      });
      return ok({ ...current, archivedAt, updatedAt: now });
    });
  }
}
