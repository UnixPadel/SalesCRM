/**
 * CreateLeadFromAd: InboundLeadDto → Faz 1 CreateLead. İş kuralı hatası (ad yok, iletişim yok…) bu
 * akışta kalıcı hatadır: yeniden denemek sonucu değiştirmez, satır `failed` olur ve admin görür.
 */
import { PermanentError, err, ok, type Logger, type Result } from "../../shared/kernel";
import type { InboundLeadDto } from "./dto";
import type { LeadCreator } from "./ports";

export interface CreateLeadFromAdResult {
  leadId: string;
  created: boolean;
  personMatched: boolean;
  assignedUserId: string | null;
}

export class CreateLeadFromAd {
  constructor(
    private readonly leads: LeadCreator,
    private readonly logger: Logger,
  ) {}

  async execute(dto: InboundLeadDto): Promise<Result<CreateLeadFromAdResult, PermanentError>> {
    const r = await this.leads.execute({
      source: dto.source,
      platformLeadId: dto.platformLeadId,
      formId: dto.formId,
      fullName: dto.fullName,
      email: dto.email,
      phone: dto.phone,
      country: dto.country,
      city: dto.city,
      company: dto.company,
      productInterest: dto.productInterest,
      notes: dto.notes,
      campaign: dto.campaign,
      attribution: dto.attribution,
      isTest: dto.isTest,
      extraAnswers: dto.extraAnswers,
      actor: null,
    });
    if (!r.ok) {
      return err(
        new PermanentError("intake.invalid_lead", r.error.message, {
          ruleCode: r.error.code,
          provider: dto.provider,
          platformLeadId: dto.platformLeadId,
        }),
      );
    }
    this.logger.info(r.value.created ? "reklam lead'i açıldı" : "reklam lead'i zaten vardı", {
      leadId: r.value.lead.id,
      provider: dto.provider,
      platformLeadId: dto.platformLeadId,
      isTest: dto.isTest,
      assignedUserId: r.value.lead.assignedUserId,
    });
    return ok({
      leadId: r.value.lead.id,
      created: r.value.created,
      personMatched: r.value.personMatched,
      assignedUserId: r.value.lead.assignedUserId,
    });
  }
}
