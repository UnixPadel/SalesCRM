import { NotFoundError, RuleError, err, ok, type Result } from "../../shared/kernel";
import type { Lead, Repositories, TerritoryRule } from "../domain";
import type { Actor } from "./types";

/** Kullanıcının sorumlu ya da yedek olduğu ülkeler. */
export function territoriesOf(userId: string, rules: readonly TerritoryRule[]): string[] {
  return rules.filter((r) => r.assignedUserId === userId || r.fallbackUserId === userId).map((r) => r.countryCode);
}

/**
 * Görünürlük (Genel plan, güvenlik): satışçı yalnız kendi ve bölgesinin lead'lerini görür.
 * Bölge = territory_rules'ta sorumlu/yedek olduğu ülkelerdeki havuz lead'leri. Admin hepsini görür.
 */
export function canSee(lead: Lead, actor: Actor, myCountries: readonly string[]): boolean {
  if (actor.isAdmin) return true;
  if (lead.assignedUserId === actor.userId) return true;
  if (lead.assignedUserId === null) {
    // Ülke kuralı yoksa havuz herkese açık (mevcut panodaki "ortak havuz" davranışı korunur).
    return !lead.country || myCountries.length === 0 || myCountries.includes(lead.country.toUpperCase());
  }
  return false;
}

/** Aşama değiştirme ve geri alma: kendi lead'i, ya da havuzdan üstlenerek; admin her zaman. */
export function canAct(lead: Lead, actor: Actor, myCountries: readonly string[]): boolean {
  return canSee(lead, actor, myCountries);
}

/** Lead'i yükler; yoksa not_found, kişi üzerinde işlem yapamıyorsa lead.forbidden (aktivite, alan düzenleme). */
export async function loadActionableLead(
  repos: Repositories,
  leadId: string,
  actor: Actor,
): Promise<Result<Lead, RuleError>> {
  const lead = await repos.leads.findById(leadId);
  if (!lead) return err(new NotFoundError("Lead", leadId));
  const myCountries = actor.isAdmin ? [] : territoriesOf(actor.userId, await repos.territories.all());
  if (!canAct(lead, actor, myCountries)) {
    return err(new RuleError("lead.forbidden", "Bu lead başka bir satışçıya ait.", { leadId: lead.id }));
  }
  return ok(lead);
}
