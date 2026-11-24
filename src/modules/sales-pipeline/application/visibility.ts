import { NotFoundError, RuleError, err, ok, type Result } from "../../shared/kernel";
import type { Lead, Repositories } from "../domain";
import type { Actor } from "./types";

/**
 * Görünürlük: satışçı kendi lead'lerini ve bütün ortak havuzu (sorumlusu olmayan lead'ler) görür; havuz
 * ülkeye göre süzülmez (ADR 0014 D7). Bölge kuralları yalnız yeni lead'in otomatik atanmasında kullanılır.
 * Admin hepsini görür.
 */
export function canSee(lead: Lead, actor: Actor): boolean {
  if (actor.isAdmin) return true;
  return lead.assignedUserId === null || lead.assignedUserId === actor.userId;
}

/** Aşama değiştirme ve geri alma: kendi lead'i, ya da havuzdan üstlenerek; admin her zaman. */
export function canAct(lead: Lead, actor: Actor): boolean {
  return canSee(lead, actor);
}

/** Lead'i yükler; yoksa not_found, kişi üzerinde işlem yapamıyorsa lead.forbidden (aktivite, alan düzenleme). */
export async function loadActionableLead(
  repos: Repositories,
  leadId: string,
  actor: Actor,
): Promise<Result<Lead, RuleError>> {
  const lead = await repos.leads.findById(leadId);
  if (!lead) return err(new NotFoundError("Lead", leadId));
  if (!canAct(lead, actor)) {
    return err(new RuleError("lead.forbidden", "Bu lead başka bir satışçıya ait.", { leadId: lead.id }));
  }
  return ok(lead);
}
