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

/** Tekrar gönderim işinin notunda görünen kaynak adı (satış çekirdeği platform adı bilmez). */
const SOURCE_LABELS: Record<string, string> = {
  meta_form: "Meta formu",
  google_form: "Google formu",
  web_form: "Web sitesi formu",
};

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
      consents: dto.consents,
      isTest: dto.isTest,
      extraAnswers: dto.extraAnswers,
      createdAt: dto.submittedAt,
      actor: null,
      // Faz 7g (§4.7): form cevapları esnek modda; bozuk telefon + geçerli e-posta lead'i durdurmaz; Excel'den gelen
      // açık lead benimsenir (çift kayıt açılmaz).
      ...(dto.profile ?? {}),
      ...(dto.courtCount != null ? { courtCount: dto.courtCount } : {}),
      ...(dto.adSurface ? { adSurface: dto.adSurface } : {}),
      parseMode: "lenient",
      invalidPhone: "drop",
      adoptImportLead: true,
      // Aynı kişi formu yeniden doldurduysa açık lead'ine işlenir; satışçı iki ayrı lead yürütmez.
      mergeRepeatSubmission: true,
      sourceLabel: SOURCE_LABELS[dto.source] ?? dto.source,
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
    const what = r.value.created
      ? "reklam lead'i açıldı"
      : r.value.merged
        ? "tekrar form gönderimi açık lead'e işlendi"
        : "reklam lead'i zaten vardı";
    this.logger.info(what, {
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
