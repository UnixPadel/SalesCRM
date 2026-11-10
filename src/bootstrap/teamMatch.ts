/**
 * Excel "Sorumlu Kişi" etiketi → kullanıcı tablosu (KullaniciBilgileri) kimliği (Faz 7g, D7; iş emri §4.8). Saf kod.
 * Sıra: 1) `overrides` (etiketin ad kısmı ya da tam etiket) 2) "ATANMADI" → havuz 3) e-posta (aktif satış
 * kullanıcıları arasında tam bir eşleşme) 4) katlanmış Ad ya da "Ad Soyad" (aynı küme, tam bir eşleşme)
 * 5) çözülemedi + neden. Pasif kullanıcıya hiçbir zaman eşlenmez.
 */
import { fold } from "../modules/lead-intake/application";

export interface DirectoryEntry {
  id: string;
  first: string;
  last: string;
  email: string;
  /** Satış yetkisi: admin = Yönetici, rep = Temsilci; diğerleri viewer. */
  role: "admin" | "rep" | "viewer";
  active: boolean;
}

export type TeamMatch =
  | { kind: "user"; userId: string; via: "override" | "email" | "name" }
  | { kind: "pool"; via: "unassigned" | "override" }
  | {
      kind: "unresolved";
      reason: "ambiguous" | "inactive_only" | "not_in_directory";
      candidates: string[];
    };

export const UNASSIGNED_LABEL = "ATANMADI";

/** "Ad (e-posta)" → { name, email }; e-posta parantezi yoksa ya da "email bekleniyor" ise email null. */
export function labelParts(label: string): { name: string; email: string | null } {
  const t = label.trim();
  const m = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(t);
  if (!m) return { name: t, email: null };
  const inner = m[2]!.trim().toLowerCase();
  return { name: m[1]!.trim(), email: /^[^\s@]+@[^\s@]+$/.test(inner) ? inner : null };
}

const isSales = (u: DirectoryEntry) => u.role === "admin" || u.role === "rep";

export function matchTeamLabel(
  label: string,
  directory: readonly DirectoryEntry[],
  overrides: Readonly<Record<string, string | null>> = {},
): TeamMatch {
  const { name, email } = labelParts(label);
  for (const key of [label.trim(), name]) {
    if (key in overrides) {
      const id = overrides[key];
      return id === null || id === undefined
        ? { kind: "pool", via: "override" }
        : { kind: "user", userId: String(id), via: "override" };
    }
  }
  if (fold(name) === fold(UNASSIGNED_LABEL)) return { kind: "pool", via: "unassigned" };

  const active = directory.filter((u) => u.active && isSales(u));
  const inactive = directory.filter((u) => !u.active && isSales(u));
  if (email) {
    const hits = active.filter((u) => u.email.toLowerCase() === email);
    if (hits.length === 1) return { kind: "user", userId: hits[0]!.id, via: "email" };
    if (hits.length > 1) return { kind: "unresolved", reason: "ambiguous", candidates: hits.map((u) => u.id) };
  }
  const n = fold(name);
  const byName = (list: readonly DirectoryEntry[]) =>
    list.filter((u) => fold(u.first) === n || fold(`${u.first} ${u.last}`) === n);
  const named = byName(active);
  if (named.length === 1) return { kind: "user", userId: named[0]!.id, via: "name" };
  if (named.length > 1) return { kind: "unresolved", reason: "ambiguous", candidates: named.map((u) => u.id) };
  const passive = [...byName(inactive), ...(email ? inactive.filter((u) => u.email.toLowerCase() === email) : [])];
  if (passive.length) {
    return { kind: "unresolved", reason: "inactive_only", candidates: [...new Set(passive.map((u) => u.id))] };
  }
  return { kind: "unresolved", reason: "not_in_directory", candidates: [] };
}
