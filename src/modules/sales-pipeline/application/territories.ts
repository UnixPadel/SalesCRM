/**
 * Bölge kuralları yönetimi (Faz 7b, "Bölgeler" sekmesi): ülke → sorumlu / yedek. Yalnız yönetici.
 *  - Özet: kurallar (ülkedeki lead ve havuz sayısı, pasif kullanıcı işareti) + lead'i olup kuralı olmayan ülkeler.
 *  - Kaydet / kaldır: kural yalnız **yeni** lead'in otomatik atamasını belirler; mevcut lead'e dokunmaz.
 *  - Havuza uygula: kuralı olan ülkelerin açık havuz lead'leri kural sahibine atanır. Önce kuru çalıştırma sonucu
 *    gösterilir; uygulama tek transaction'dır ve lead başına bildirim göndermez (toplu işlem).
 * Görünürlük değişmez: satışçı bütün havuzu görmeye devam eder.
 */
import { RuleError, err, ok, type Result } from "../../shared/kernel";
import {
  isTerminal,
  parseTerritoryRule,
  planNonSalesReassignment,
  planPoolAssignment,
  type TerritoryRule,
} from "../domain";
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

export interface NonSalesReassignResult {
  dryRun: boolean;
  /** Aktarılan (kuru çalıştırmada: aktarılacak) lead sayısı. */
  total: number;
  /** Lead'lerin gideceği satışçılar. */
  byUser: { userId: string; count: number }[];
  /** Lead'lerin alınacağı, satışçı olmayan sorumlular (aktarılan + yerinde kalan). */
  fromUsers: { userId: string; count: number }[];
  /** Ülkesinde uygun kural olmadığı için yerinde kalanlar, ülkeye göre (ülkesi yoksa null). */
  noRule: { countryCode: string | null; count: number }[];
}

const countBy = <K>(keys: readonly K[]): [K, number][] => {
  const m = new Map<K, number>();
  for (const k of keys) m.set(k, (m.get(k) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1]);
};

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

  /**
   * Sorumlusu aktif satış kullanıcısı olmayan lead'leri ülkelerinin kural sahibine aktarır (yalnız yönetici). Önce
   * kuru çalıştırma sonucu gösterilir; uygulama tek transaction'dır ve lead başına bildirim göndermez. Ekip dizini
   * okunamıyorsa kimin satışçı olduğu bilinemez: işlem yapılmaz.
   */
  async reassignNonSales(input: { actor: Actor; dryRun: boolean }): Promise<Result<NonSalesReassignResult, RuleError>> {
    const allowed = requireAdmin(input.actor, "territory");
    if (!allowed.ok) return allowed;
    const active = (await this.deps.team?.activeSalesUserIds()) ?? null;
    if (!active) {
      return err(
        new RuleError(
          "territory.directory_unavailable",
          "Kullanıcı tablosu okunamadı; kimin satışçı olduğu bilinemiyor.",
        ),
      );
    }
    const result = await this.deps.uow.run(async (repos): Promise<NonSalesReassignResult> => {
      const [rules, leads] = await Promise.all([repos.territories.all(), repos.leads.list({ includeTest: true })]);
      const plan = planNonSalesReassignment(leads, rules, new Set(active));
      const now = this.deps.clock.now();
      if (!input.dryRun) {
        for (const m of plan.moves) await repos.leads.updateAssignee(m.leadId, m.toUserId, now);
      }
      return {
        dryRun: input.dryRun,
        total: plan.moves.length,
        byUser: countBy(plan.moves.map((m) => m.toUserId)).map(([userId, count]) => ({ userId, count })),
        fromUsers: countBy([...plan.moves, ...plan.noRule].map((m) => m.fromUserId)).map(([userId, count]) => ({
          userId,
          count,
        })),
        noRule: countBy(plan.noRule.map((m) => m.countryCode)).map(([countryCode, count]) => ({
          countryCode,
          count,
        })),
      };
    });
    if (!input.dryRun) {
      this.deps.logger.info("satışçı olmayanların lead'leri aktarıldı", {
        total: result.total,
        byUser: result.byUser,
        actorUserId: input.actor.userId,
      });
    }
    return ok(result);
  }
}
