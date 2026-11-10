import { RuleError, err, ok, type Result } from "../../shared/kernel";
import type { LeadFields } from "../domain";
import type { Actor } from "./types";

/**
 * Müşteri bilgilerini yalnız yönetici değiştirir (Faz 7e, 2026-11-10 kararı).
 * Satışçı: aşama, aktivite, not, havuzdan üstlenme. Yönetici: kişi kimliği (ad, e-posta, telefon), kuruluş kaydı,
 * fırsat alanları (kort, model, kapanış, kuruluş bağı, firma, şehir, ürün), atama, silme, birleştirme.
 * Görüntüleyici hiçbir şeyi değiştiremez (api katmanı 403 `read_only`).
 */
export const ADMIN_ONLY = "admin_only";

/** Satışçının `UpdateLeadFields` ile dokunabildiği alanlar. */
export const REP_EDITABLE_LEAD_FIELDS: readonly (keyof LeadFields)[] = ["notes"];

/**
 * Açık soru 1 (Faz 7g, D4): satışçı ürün tercihlerini düzenleyebilsin mi? Tek anahtar: config `repsEditProducts`
 * (env REPS_EDIT_PRODUCTS=1), varsayılan kapalı.
 */
export const repEditableLeadFields = (p: { repsEditProducts: boolean } | undefined): readonly (keyof LeadFields)[] =>
  p?.repsEditProducts ? [...REP_EDITABLE_LEAD_FIELDS, "products"] : REP_EDITABLE_LEAD_FIELDS;

export function requireAdmin(actor: Actor, what: string): Result<void, RuleError> {
  if (actor.isAdmin) return ok(undefined);
  return err(new RuleError(ADMIN_ONLY, "Bu bilgiyi yalnız yönetici değiştirebilir.", { what }));
}

/** Verilen alanlardan satışçıya kapalı olanlar; boşsa işlem serbest. */
export function fieldsForbiddenForRep(
  fields: Partial<LeadFields>,
  allowed: readonly (keyof LeadFields)[] = REP_EDITABLE_LEAD_FIELDS,
): string[] {
  return Object.keys(fields).filter((k) => !allowed.includes(k as keyof LeadFields));
}

export function requireFieldAccess(
  actor: Actor,
  fields: Partial<LeadFields>,
  policy?: { repsEditProducts: boolean },
): Result<void, RuleError> {
  if (actor.isAdmin) return ok(undefined);
  const forbidden = fieldsForbiddenForRep(fields, repEditableLeadFields(policy));
  if (!forbidden.length) return ok(undefined);
  return err(
    new RuleError(ADMIN_ONLY, "Bu alanları yalnız yönetici değiştirebilir.", {
      what: "lead_fields",
      fields: forbidden,
    }),
  );
}
