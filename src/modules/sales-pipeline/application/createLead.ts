import { RuleError, err, ok, type Result } from "../../shared/kernel";
import { Email, PhoneNumber } from "../../shared/normalization";
import {
  EMPTY_CAMPAIGN,
  PlatformLeadId,
  resolveAssignee,
  type CampaignInfo,
  type DomainEvent,
  type Lead,
  type LeadSource,
  type Person,
  type Repositories,
  type StageEvent,
} from "../domain";
import type { Actor, UseCaseDeps } from "./types";

export interface CreateLeadInput {
  source: LeadSource;
  /** Reklam kaynaklı lead'lerde zorunlu; aynı (source, platformLeadId) ikinci kez gelirse mevcut lead döner. */
  platformLeadId?: string | null;
  formId?: string | null;
  fullName: string;
  email?: string | null;
  phone?: string | null;
  country?: string | null;
  city?: string;
  company?: string;
  productInterest?: string;
  notes?: string;
  campaign?: Partial<CampaignInfo>;
  isTest?: boolean;
  extraAnswers?: Record<string, unknown>;
  /** Açıkça verilirse ülke kuralı atlanır (admin elle atar). */
  assignedUserId?: string | null;
  /** Elle açan kişi; webhook akışında yok. */
  actor?: Actor | null;
}

export interface CreateLeadResult {
  lead: Lead;
  /** false: aynı platform kimliği zaten vardı, yeni kayıt açılmadı. */
  created: boolean;
  /** true: kişi e-posta/telefonla eşleşti, yeni lead mevcut kişiye bağlandı. */
  personMatched: boolean;
}

/**
 * Lead oluşturma (manuel ve, Faz 2'de, reklam kaynaklı). Mükerrer kontrolü iki katmanlı:
 * (1) kaynak + platform kimliği → aynı lead, (2) normalize e-posta/telefon → aynı kişi, yeni lead.
 * NEW aşama olayı sistem kaynaklı yazılır ve etkin platformlara outbox satırı açılır (NEW de gönderilir).
 */
export class CreateLead {
  constructor(private readonly deps: UseCaseDeps) {}

  async execute(input: CreateLeadInput): Promise<Result<CreateLeadResult, RuleError>> {
    const fullName = (input.fullName ?? "").trim();
    if (!fullName) return err(new RuleError("lead.name_required", "Ad soyad zorunlu.", {}));

    const country = (input.country ?? "").trim().toUpperCase() || null;
    if (country && !/^[A-Z]{2}$/.test(country)) {
      return err(new RuleError("lead.country_invalid", "Ülke ISO-3166 iki harfli kod olmalı.", { country }));
    }

    let email: Email | null = null;
    if ((input.email ?? "").trim()) {
      const r = Email.parse(input.email ?? "");
      if (!r.ok) return r;
      email = r.value;
    }
    let phone: PhoneNumber | null = null;
    if ((input.phone ?? "").trim()) {
      const r = PhoneNumber.parse(input.phone ?? "", country ?? undefined);
      if (!r.ok) return r;
      phone = r.value;
    }
    if (!email && !phone) {
      return err(new RuleError("lead.contact_required", "E-posta ya da telefon zorunlu.", {}));
    }

    let platformId: PlatformLeadId | null = null;
    if (input.platformLeadId != null && input.platformLeadId !== "") {
      const r = PlatformLeadId.parse(input.platformLeadId);
      if (!r.ok) return r;
      platformId = r.value;
    }
    if (!platformId && input.source !== "manual" && input.source !== "import") {
      return err(
        new RuleError("lead.platform_id_required", "Reklam kaynaklı lead için platform kimliği zorunlu.", {
          source: input.source,
        }),
      );
    }

    const { clock, ids, platforms, uow } = this.deps;
    const outcome = await uow.run(async (repos): Promise<CreateLeadResult & { domainEvents: DomainEvent[] }> => {
      if (platformId) {
        const existing = await repos.leads.findByPlatformId(input.source, platformId.value);
        if (existing) return { lead: existing, created: false, personMatched: false, domainEvents: [] };
      }

      const now = clock.now();
      const { person, matched } = await this.findOrCreatePerson(repos, {
        fullName,
        email,
        phone,
        country,
        company: input.company ?? "",
        now,
      });
      const assignedUserId = await this.resolveAssignment(repos, input, country);

      const lead: Lead = {
        id: ids.next(),
        source: input.source,
        platformLeadId: platformId?.value ?? null,
        formId: input.formId ?? null,
        personId: person.id,
        fullName,
        email: email?.value ?? null,
        phoneE164: phone?.e164 ?? null,
        country,
        city: (input.city ?? "").trim(),
        company: (input.company ?? "").trim(),
        productInterest: (input.productInterest ?? "").trim(),
        campaign: { ...EMPTY_CAMPAIGN, ...(input.campaign ?? {}) },
        assignedUserId,
        currentStage: "NEW",
        isTest: input.isTest ?? false,
        notes: (input.notes ?? "").trim(),
        extraAnswers: input.extraAnswers ?? {},
        createdAt: now,
        updatedAt: now,
      };
      await repos.leads.insert(lead);

      const event: StageEvent = {
        id: ids.next(),
        leadId: lead.id,
        changeId: ids.next(),
        stageCode: "NEW",
        occurredAt: now,
        sequence: 1,
        actorUserId: input.actor?.userId ?? null,
        origin: "system",
        value: null,
        lostReasonCode: null,
        qualificationAnswers: null,
        undoneAt: null,
      };
      await repos.stageEvents.insert(event);
      if (!lead.isTest) {
        for (const provider of platforms.enabledProviders()) {
          await repos.outbox.enqueue(event.id, provider, new Date(now.getTime() + this.deps.undoWindowMs));
        }
      }

      const domainEvents: DomainEvent[] = [
        {
          type: "LeadCreated",
          leadId: lead.id,
          personId: person.id,
          source: lead.source,
          assignedUserId,
          occurredAt: now,
        },
      ];
      if (assignedUserId) {
        domainEvents.push({
          type: "LeadAssigned",
          leadId: lead.id,
          from: null,
          to: assignedUserId,
          actorUserId: input.actor?.userId ?? null,
          occurredAt: now,
        });
      }
      return { lead, created: true, personMatched: matched, domainEvents };
    });

    if (outcome.domainEvents.length) await this.deps.events.publish(outcome.domainEvents);
    this.deps.logger.info(outcome.created ? "lead oluşturuldu" : "lead zaten vardı", {
      leadId: outcome.lead.id,
      source: input.source,
      personMatched: outcome.personMatched,
      assignedUserId: outcome.lead.assignedUserId,
    });
    return ok({ lead: outcome.lead, created: outcome.created, personMatched: outcome.personMatched });
  }

  private async findOrCreatePerson(
    repos: Repositories,
    p: {
      fullName: string;
      email: Email | null;
      phone: PhoneNumber | null;
      country: string | null;
      company: string;
      now: Date;
    },
  ): Promise<{ person: Person; matched: boolean }> {
    const existing = await repos.persons.findByEmailOrPhone(p.email?.value ?? null, p.phone?.e164 ?? null);
    if (existing) return { person: existing, matched: true };
    const person: Person = {
      id: this.deps.ids.next(),
      fullName: p.fullName,
      emailNormalized: p.email?.value ?? null,
      phoneE164: p.phone?.e164 ?? null,
      country: p.country,
      company: p.company.trim(),
      createdAt: p.now,
    };
    await repos.persons.insert(person);
    return { person, matched: false };
  }

  /** Öncelik: açık atama > elle açan satışçı (admin değilse) > ülke kuralı > havuz. */
  private async resolveAssignment(
    repos: Repositories,
    input: CreateLeadInput,
    country: string | null,
  ): Promise<string | null> {
    if (input.assignedUserId !== undefined) return input.assignedUserId;
    if (input.actor && !input.actor.isAdmin) return input.actor.userId;
    return resolveAssignee(country, await repos.territories.all());
  }
}
