import { RuleError, type Result } from "../../shared/kernel";
import { parseLeadFields, type Lead } from "../domain";
import type { Actor, UseCaseDeps } from "./types";
import { loadActionableLead } from "./visibility";

export interface UpdateLeadFieldsInput {
  leadId: string;
  /** Ham gövde; yalnız verilen anahtarlar değişir (parseLeadFields doğrular). */
  fields: Record<string, unknown>;
  actor: Actor;
}

/**
 * Fırsat ve serbest metin alanlarını düzenler (Faz 6b). Aşamayı, sorumluyu ve kimlik alanlarını (e-posta,
 * telefon) değiştirmez; bunlar kendi komutlarıyla değişir. Yetki aktivitelerle aynı: sahibi, havuzdan
 * erişen satışçı ya da admin.
 */
export class UpdateLeadFields {
  constructor(private readonly deps: UseCaseDeps) {}

  async execute(input: UpdateLeadFieldsInput): Promise<Result<Lead, RuleError>> {
    const parsed = parseLeadFields(input.fields);
    if (!parsed.ok) return parsed;
    const fields = parsed.value;
    const { uow, clock, logger } = this.deps;
    return uow.run(async (repos): Promise<Result<Lead, RuleError>> => {
      const lead = await loadActionableLead(repos, input.leadId, input.actor);
      if (!lead.ok) return lead;
      if (Object.keys(fields).length === 0) return lead;
      const now = clock.now();
      await repos.leads.updateFields(lead.value.id, fields, now);
      logger.info("lead alanları güncellendi", {
        leadId: lead.value.id,
        fields: Object.keys(fields),
        actorUserId: input.actor.userId,
      });
      return { ok: true, value: { ...lead.value, ...fields, updatedAt: now } };
    });
  }
}
