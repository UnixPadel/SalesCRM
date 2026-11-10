import { RuleError, err, type Result } from "../../shared/kernel";
import { PROVENANCE_KEYS, WARNINGS_CLEARED_BY, courtCountConflict, parseLeadFields, type Lead } from "../domain";
import type { Actor, UseCaseDeps } from "./types";
import { requireFieldAccess } from "./permissions";
import { loadActionableLead } from "./visibility";

export interface UpdateLeadFieldsInput {
  leadId: string;
  /** Ham gövde; yalnız verilen anahtarlar değişir (parseLeadFields doğrular). */
  fields: Record<string, unknown>;
  actor: Actor;
}

/**
 * Fırsat ve serbest metin alanlarını düzenler (Faz 6b). Aşamayı, sorumluyu ve kimlik alanlarını (e-posta,
 * telefon) değiştirmez; bunlar kendi komutlarıyla değişir. Lead'i görebilen satışçı yalnız **notu** değiştirir
 * (Faz 7e); diğer alanlar yöneticiye aittir (`admin_only`).
 */
export class UpdateLeadFields {
  constructor(private readonly deps: UseCaseDeps) {}

  async execute(input: UpdateLeadFieldsInput): Promise<Result<Lead, RuleError>> {
    const parsed = parseLeadFields(input.fields);
    if (!parsed.ok) return parsed;
    const fields = parsed.value;
    const access = requireFieldAccess(input.actor, fields, this.deps.policy);
    if (!access.ok) return access;
    const { uow, clock, logger } = this.deps;
    return uow.run(async (repos): Promise<Result<Lead, RuleError>> => {
      const lead = await loadActionableLead(repos, input.leadId, input.actor);
      if (!lead.ok) return lead;
      if (Object.keys(fields).length === 0) return lead;
      if (fields.organizationId && !(await repos.organizations.findById(fields.organizationId))) {
        return err(
          new RuleError("lead.organization_not_found", "Kuruluş bulunamadı.", {
            organizationId: fields.organizationId,
          }),
        );
      }
      // Faz 7g (§3.4): ürün adedi varken kort sayısı ayrıca yazılmaz; iki kaynak çelişmesin.
      if (courtCountConflict(fields, lead.value.products)) {
        return err(
          new RuleError("court_count.derived", "Kort sayısı ürün adetlerinden gelir; ürünleri düzenleyin.", {}),
        );
      }
      const now = clock.now();
      await repos.leads.updateFields(lead.value.id, fields, now);
      let extraAnswers = lead.value.extraAnswers;
      let checkedWarnings = lead.value.checkedWarnings;
      // Ülke düzeltilince köken bilgisi ve ilgili "kontrol edildi" işaretleri düşer (D6).
      if ("country" in fields && fields.country !== lead.value.country) {
        const keys: readonly string[] = PROVENANCE_KEYS.country;
        await repos.leads.removeExtraAnswerKeys(lead.value.id, keys, now);
        extraAnswers = Object.fromEntries(Object.entries(extraAnswers).filter(([k]) => !keys.includes(k)));
        const cleared: readonly string[] = WARNINGS_CLEARED_BY.country;
        const kept = checkedWarnings.filter((c) => !cleared.includes(c));
        if (kept.length !== checkedWarnings.length) {
          await repos.leads.setCheckedWarnings(lead.value.id, kept, now);
          checkedWarnings = kept;
        }
      }
      logger.info("lead alanları güncellendi", {
        leadId: lead.value.id,
        fields: Object.keys(fields),
        actorUserId: input.actor.userId,
      });
      return { ok: true, value: { ...lead.value, ...fields, extraAnswers, checkedWarnings, updatedAt: now } };
    });
  }
}
