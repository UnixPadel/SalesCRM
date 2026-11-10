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

export function requireAdmin(actor: Actor, what: string): Result<void, RuleError> {
  if (actor.isAdmin) return ok(undefined);
  return err(new RuleError(ADMIN_ONLY, "Bu bilgiyi yalnız yönetici değiştirebilir.", { what }));
}

/** Verilen alanlardan satışçıya kapalı olanlar; boşsa işlem serbest. */
export function fieldsForbiddenForRep(fields: Partial<LeadFields>): string[] {
  return Object.keys(fields).filter((k) => !REP_EDITABLE_LEAD_FIELDS.includes(k as keyof LeadFields));
}

export function requireFieldAccess(actor: Actor, fields: Partial<LeadFields>): Result<void, RuleError> {
  if (actor.isAdmin) return ok(undefined);
  const forbidden = fieldsForbiddenForRep(fields);
  if (!forbidden.length) return ok(undefined);
  return err(
    new RuleError(ADMIN_ONLY, "Bu alanları yalnız yönetici değiştirebilir.", {
      what: "lead_fields",
      fields: forbidden,
    }),
  );
}
