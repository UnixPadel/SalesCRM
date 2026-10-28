export interface TerritoryRule {
  countryCode: string;
  assignedUserId: string;
  fallbackUserId: string | null;
}

/**
 * Ülke → satışçı (Genel plan, CreateLeadFromAd adım 3). Kural yoksa ortak havuz (null).
 * `unavailable` içindeki kullanıcılar (pasif) atlanır; yedek de yoksa havuz.
 */
export function resolveAssignee(
  country: string | null | undefined,
  rules: readonly TerritoryRule[],
  unavailable: ReadonlySet<string> = new Set(),
): string | null {
  const cc = (country ?? "").toUpperCase();
  const rule = rules.find((r) => r.countryCode.toUpperCase() === cc);
  if (!rule) return null;
  if (!unavailable.has(rule.assignedUserId)) return rule.assignedUserId;
  if (rule.fallbackUserId && !unavailable.has(rule.fallbackUserId)) return rule.fallbackUserId;
  return null;
}
