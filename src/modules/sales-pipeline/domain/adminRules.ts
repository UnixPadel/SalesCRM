/**
 * Yönetim işlemlerinin saf kuralları (Faz 7b bölge kuralları, 7d kişi birleştirme). Veritabanı ve HTTP bilmez.
 */
import { RuleError, err, ok, type Result } from "../../shared/kernel";
import { resolveAssignee, type TerritoryRule } from "./assignment";
import type { Lead, Person } from "./lead";
import { isTerminal } from "./stage";

/**
 * Bölge kuralı girdisi → kural. `activeUserIds` verilirse sorumlu ve yedek aktif satış kullanıcısı olmalıdır
 * (dizin okunamıyorsa null: süzme yapılmaz, fail-open).
 */
export function parseTerritoryRule(
  raw: unknown,
  activeUserIds: ReadonlySet<string> | null,
): Result<TerritoryRule, RuleError> {
  const r = (raw ?? {}) as Record<string, unknown>;
  const countryCode = String(r["countryCode"] ?? "")
    .trim()
    .toUpperCase();
  if (!/^[A-Z]{2}$/.test(countryCode)) {
    return err(new RuleError("territory.country_invalid", "Ülke iki harfli kod olmalı (ör. TR).", { countryCode }));
  }
  const assignedUserId = String(r["assignedUserId"] ?? "").trim();
  if (!assignedUserId) return err(new RuleError("territory.user_required", "Sorumlu seçilmeli."));
  const fallback = String(r["fallbackUserId"] ?? "").trim();
  const fallbackUserId = fallback || null;
  if (fallbackUserId === assignedUserId) {
    return err(new RuleError("territory.fallback_same", "Yedek, sorumludan farklı biri olmalı."));
  }
  if (activeUserIds) {
    const inactive = [assignedUserId, fallbackUserId].filter((u): u is string => u !== null && !activeUserIds.has(u));
    if (inactive.length) {
      return err(
        new RuleError("territory.user_inactive", "Seçilen kullanıcı aktif bir satış kullanıcısı değil.", {
          userIds: inactive,
        }),
      );
    }
  }
  return ok({ countryCode, assignedUserId, fallbackUserId });
}

export interface PoolAssignment {
  leadId: string;
  toUserId: string;
}

/**
 * "Havuza uygula": kuralı olan ülkelerin açık havuz lead'leri kural sahibine (pasifse yedeğe) atanır. Test lead'i,
 * kapanmış lead ve içe aktarmada başka sorumluya etiketlenmiş lead (`extra_answers.excel_owner`) atlanır.
 */
export function planPoolAssignment(
  leads: readonly Pick<Lead, "id" | "country" | "assignedUserId" | "currentStage" | "isTest" | "extraAnswers">[],
  rules: readonly TerritoryRule[],
  unavailable: ReadonlySet<string> = new Set(),
): PoolAssignment[] {
  const out: PoolAssignment[] = [];
  for (const l of leads) {
    if (l.assignedUserId !== null || l.isTest || isTerminal(l.currentStage)) continue;
    if (typeof l.extraAnswers["excel_owner"] === "string") continue;
    const toUserId = resolveAssignee(l.country, rules, unavailable);
    if (toUserId) out.push({ leadId: l.id, toUserId });
  }
  return out;
}

export interface PersonMergePlan {
  /** Hedef kişide değişecek alanlar (boş olanlar kaynaktan dolar). */
  targetPatch: Partial<Pick<Person, "emailNormalized" | "phoneE164" | "company" | "country" | "organizationId">>;
  /** Hedefe taşınan e-posta / telefon kaynaktan düşer (kişi başına tekil). */
  sourcePatch: Partial<Pick<Person, "emailNormalized" | "phoneE164">>;
}

/**
 * Kişi birleştirme kuralı: hedef kalır, kaynak hedefi gösterir. Aynı kişi, zaten birleşmiş kaynak ya da birleşmiş
 * hedef (zincir / döngü) reddedilir.
 */
export function planPersonMerge(target: Person, source: Person): Result<PersonMergePlan, RuleError> {
  if (target.id === source.id) {
    return err(new RuleError("person.merge_invalid", "Kişi kendisiyle birleştirilemez.", { reason: "same" }));
  }
  if (source.mergedIntoId !== null) {
    return err(new RuleError("person.merge_invalid", "Kaynak kişi zaten birleştirilmiş.", { reason: "source_merged" }));
  }
  if (target.mergedIntoId !== null) {
    return err(
      new RuleError("person.merge_invalid", "Hedef kişi başka bir kişiye birleştirilmiş.", {
        reason: "target_merged",
      }),
    );
  }
  const targetPatch: PersonMergePlan["targetPatch"] = {};
  const sourcePatch: PersonMergePlan["sourcePatch"] = {};
  if (!target.emailNormalized && source.emailNormalized) {
    targetPatch.emailNormalized = source.emailNormalized;
    sourcePatch.emailNormalized = null;
  }
  if (!target.phoneE164 && source.phoneE164) {
    targetPatch.phoneE164 = source.phoneE164;
    sourcePatch.phoneE164 = null;
  }
  if (!target.company.trim() && source.company.trim()) targetPatch.company = source.company;
  if (!target.country && source.country) targetPatch.country = source.country;
  if (!target.organizationId && source.organizationId) targetPatch.organizationId = source.organizationId;
  return ok({ targetPatch, sourcePatch });
}
