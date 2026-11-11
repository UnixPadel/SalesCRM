/**
 * Bölge kuralları yönetimi (Faz 7b, "Bölgeler" sekmesi): ülke → sorumlu / yedek. Yalnız yönetici.
 *  - Özet: kurallar (ülkedeki lead ve havuz sayısı, pasif kullanıcı işareti) + lead'i olup kuralı olmayan ülkeler.
 *  - Kaydet / kaldır: kural yalnız **yeni** lead'in otomatik atamasını belirler; mevcut lead'e dokunmaz.
 *  - Havuza uygula: kuralı olan ülkelerin açık havuz lead'leri kural sahibine atanır. Önce kuru çalıştırma sonucu
 *    gösterilir; uygulama tek transaction'dır ve lead başına bildirim göndermez (toplu işlem).
 * Görünürlük değişmez: satışçı bütün havuzu görmeye devam eder.
 */
import { RuleError, err, ok, type Result } from "../../shared/kernel";
import { isTerminal, parseTerritoryRule, planPoolAssignment, type TerritoryRule } from "../domain";
import { requireAdmin } from "./permissions";
import type { Actor, UseCaseDeps } from "./types";

export interface TerritoryRow {
  rule: TerritoryRule;
  /** Ülkedeki (test dışı) lead sayısı ve bunlardan açık olup havuzda bekleyenler. */
  leadCount: number;
  poolCount: number;
  /** Kullanıcı pasif mi; dizin okunamadıysa null. */
  assignedInactive: boolean | null;
  fallbackInactive: boolean | null;
}

export interface TerritoryOverview {
  rules: TerritoryRow[];
  /** Lead'i olup kuralı olmayan ülkeler (çoktan aza). */
  uncovered: { countryCode: string; leadCount: number; poolCount: number }[];
}

export interface PoolApplyResult {
  dryRun: boolean;
  total: number;
  byUser: { userId: string; count: number }[];
}

export class TerritoryAdmin {
  constructor(private readonly deps: UseCaseDeps) {}

  private async inactive(): Promise<ReadonlySet<string> | null> {
    return (await this.deps.team?.inactiveUserIds?.()) ?? null;
  }

  async overview(actor: Actor): Promise<Result<TerritoryOverview, RuleError>> {
    const allowed = requireAdmin(actor, "territory");
    if (!allowed.ok) return allowed;
    const inactive = await this.inactive();
    return this.deps.uow.run(async (repos) => {
      const [rules, leads] = await Promise.all([repos.territories.all(), repos.leads.list({ includeTest: false })]);
      const byCountry = new Map<string, { leadCount: number; poolCount: number }>();
      for (const l of leads) {
        if (!l.country) continue;
        const c = byCountry.get(l.country) ?? { leadCount: 0, poolCount: 0 };
        c.leadCount += 1;
        if (l.assignedUserId === null && !isTerminal(l.currentStage)) c.poolCount += 1;
        byCountry.set(l.country, c);
      }
      const covered = new Set(rules.map((r) => r.countryCode.toUpperCase()));
      return ok({
        rules: rules
          .map((rule) => ({
            rule,
            ...(byCountry.get(rule.countryCode.toUpperCase()) ?? { leadCount: 0, poolCount: 0 }),
            assignedInactive: inactive ? inactive.has(rule.assignedUserId) : null,
            fallbackInactive:
              rule.fallbackUserId === null ? false : inactive ? inactive.has(rule.fallbackUserId) : null,
          }))
          .sort((a, b) => a.rule.countryCode.localeCompare(b.rule.countryCode)),
        uncovered: [...byCountry]
          .filter(([cc]) => !covered.has(cc))
          .map(([countryCode, c]) => ({ countryCode, ...c }))
          .sort((a, b) => b.leadCount - a.leadCount || a.countryCode.localeCompare(b.countryCode)),
      });
    });
  }

  async save(input: { actor: Actor; fields: unknown }): Promise<Result<TerritoryRule, RuleError>> {
    const allowed = requireAdmin(input.actor, "territory");
    if (!allowed.ok) return allowed;
    const active = (await this.deps.team?.activeSalesUserIds()) ?? null;
    const parsed = parseTerritoryRule(input.fields, active ? new Set(active) : null);
    if (!parsed.ok) return parsed;
    await this.deps.uow.run((repos) => repos.territories.upsert(parsed.value, this.deps.clock.now()));
    this.deps.logger.info("bölge kuralı kaydedildi", {
      countryCode: parsed.value.countryCode,
      assignedUserId: parsed.value.assignedUserId,
      fallbackUserId: parsed.value.fallbackUserId,
      actorUserId: input.actor.userId,
    });
    return ok(parsed.value);
  }

  async remove(input: { actor: Actor; countryCode: string }): Promise<Result<true, RuleError>> {
    const allowed = requireAdmin(input.actor, "territory");
    if (!allowed.ok) return allowed;
    const cc = input.countryCode.trim().toUpperCase();
    const removed = await this.deps.uow.run((repos) => repos.territories.remove(cc));
    if (!removed) return err(new RuleError("not_found", `Bölge kuralı bulunamadı: ${cc}`, { countryCode: cc }));
    this.deps.logger.info("bölge kuralı kaldırıldı", { countryCode: cc, actorUserId: input.actor.userId });
    return ok(true);
  }

  async applyToPool(input: { actor: Actor; dryRun: boolean }): Promise<Result<PoolApplyResult, RuleError>> {
    const allowed = requireAdmin(input.actor, "territory");
    if (!allowed.ok) return allowed;
    const inactive = (await this.inactive()) ?? new Set<string>();
    const result = await this.deps.uow.run(async (repos): Promise<PoolApplyResult> => {
      const [rules, leads] = await Promise.all([repos.territories.all(), repos.leads.list({ owner: null })]);
      const plan = planPoolAssignment(leads, rules, inactive);
      const counts = new Map<string, number>();
      const now = this.deps.clock.now();
      for (const p of plan) {
        counts.set(p.toUserId, (counts.get(p.toUserId) ?? 0) + 1);
        if (!input.dryRun) await repos.leads.updateAssignee(p.leadId, p.toUserId, now);
      }
      return {
        dryRun: input.dryRun,
        total: plan.length,
        byUser: [...counts].map(([userId, count]) => ({ userId, count })).sort((a, b) => b.count - a.count),
      };
    });
    if (!input.dryRun) {
      this.deps.logger.info("bölge kuralları havuza uygulandı", {
        total: result.total,
        byUser: result.byUser,
        actorUserId: input.actor.userId,
      });
    }
    return ok(result);
  }
}
