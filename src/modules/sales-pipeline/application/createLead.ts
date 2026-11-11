import { RuleError, err, ok, type Result } from "../../shared/kernel";
import { Email, PhoneNumber } from "../../shared/normalization";
import {
  EMPTY_ATTRIBUTION,
  EMPTY_CAMPAIGN,
  PlatformLeadId,
  emptyTrackingFields,
  hasAnyProduct,
  hasAttribution,
  isAdSource,
  isCustomerStatus,
  isTerminal,
  parseConsents,
  parseLeadFields,
  parseLeadFieldsLenient,
  resolveAssignee,
  type LeadFields,
  type CampaignInfo,
  type ConsentInput,
  type DomainEvent,
  type Lead,
  type LeadAttribution,
  type LeadConsent,
  type LeadSource,
  type Person,
  type Repositories,
  type StageEvent,
} from "../domain";
import { ADMIN_ONLY } from "./permissions";
import type { Actor, UseCaseDeps } from "./types";

/**
 * Satışçının lead açarken verebildiği alanlar (Faz 7g, 7e ile tutarlı): ad, e-posta, telefon, ülke ve bunlar.
 * Fırsat alanları, ürünler, form cevapları ve sorumlu yöneticinindir (`admin_only`).
 */
export const REP_CREATABLE_LEAD_FIELDS = ["notes", "company", "city", "productInterest", "customerStatus"] as const;

/** Satışçıya kapalı oluşturma alanları (dolu verilmişse). */
const REP_FORBIDDEN_CREATE = [
  "courtCount",
  "courtModel",
  "expectedCloseDate",
  "organizationId",
  "installSite",
  "installTimeline",
  "customerProfile",
  "courtCountBand",
  "adSurface",
] as const;

const isBlank = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");

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
  /** Fırsat alanları (Faz 6b); doğrulama parseLeadFields ile. */
  courtCount?: number | string | null;
  courtModel?: string | null;
  expectedCloseDate?: string | null;
  /** Kuruluş bağı (Faz 6d). */
  organizationId?: string | null;
  campaign?: Partial<CampaignInfo>;
  /** Tıklama kimlikleri (Faz 2: reklam platformlarından). Hepsi boşsa satır yazılmaz. */
  attribution?: Partial<LeadAttribution>;
  /** Onay kutuları (Faz 3: web formu). Boşsa satır yazılmaz. */
  consents?: ConsentInput[];
  isTest?: boolean;
  extraAnswers?: Record<string, unknown>;
  /**
   * Lead'in gerçekte oluştuğu an (platformdaki form gönderimi). Verilmezse ya da gelecekteyse şimdi.
   * Yedek senkronla saatler sonra işlenen lead'in yaşı ve platform penceresi bu tarihe göre hesaplanır.
   */
  createdAt?: Date | null;
  /** Açıkça verilirse ülke kuralı atlanır (admin elle atar). */
  assignedUserId?: string | null;
  /** Elle açan kişi; webhook akışında yok. */
  actor?: Actor | null;
  /** Faz 7g: müşteri durumu (D1). */
  customerStatus?: unknown;
  /** Ürün tercihleri (D4) ve form cevapları (D5). */
  products?: unknown;
  installSite?: unknown;
  installTimeline?: unknown;
  customerProfile?: unknown;
  courtCountBand?: unknown;
  adSurface?: unknown;
  /** "lenient" (intake, içe aktarma): geçersiz kod lead'i durdurmaz, alan düşer (`extraAnswers.dropped_fields`). */
  parseMode?: "strict" | "lenient";
  /** "drop": bozuk telefon + geçerli e-posta → telefon boş, ham değer `extraAnswers.phone_raw`. */
  invalidPhone?: "reject" | "drop";
  /** Temas geçmişi bilinmeyen eski kayıt (eski liste aktarımı). */
  contactHistoryUnknown?: boolean;
  /**
   * Intake: eşleşen kişinin Excel'den gelen açık lead'i varsa ve kampanya aynı ya da boşsa yeni lead açılmaz; boş
   * alanlar doldurulur, platform kimliği yazılır [M-I12][K-M15].
   */
  adoptImportLead?: boolean;
}

export interface CreateLeadResult {
  lead: Lead;
  /** false: aynı platform kimliği zaten vardı, yeni kayıt açılmadı. */
  created: boolean;
  /** true: kişi e-posta/telefonla eşleşti, yeni lead mevcut kişiye bağlandı. */
  personMatched: boolean;
  /** true: Excel'den gelen açık lead benimsendi (yeni lead açılmadı). */
  adopted?: boolean;
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
    let phoneRaw: string | null = null;
    if ((input.phone ?? "").trim()) {
      const r = PhoneNumber.parse(input.phone ?? "", country ?? undefined);
      if (r.ok) phone = r.value;
      else if (input.invalidPhone === "drop" && email) phoneRaw = String(input.phone).trim().slice(0, 64);
      else return r;
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
    const consentsR = parseConsents(input.consents ?? []);
    if (!consentsR.ok) return consentsR;
    const consentInputs = consentsR.value;

    // Faz 7g: satışçı oluştururken fırsat alanı, ürün ya da form cevabı veremez (7e ile tutarlı).
    if (input.actor && !input.actor.isAdmin) {
      const given = REP_FORBIDDEN_CREATE.filter((k) => !isBlank(input[k]));
      const products = input.products as Parameters<typeof hasAnyProduct>[0] | undefined;
      if (
        products &&
        typeof products === "object" &&
        hasAnyProduct({ ...products, roof: products.roof ?? { wanted: false, widthM: null, lengthM: null } })
      ) {
        given.push("products" as never);
      }
      // Sorumlu alanını api katmanı yalnız yöneticiden geçirir; burada yalnız alanlar denetlenir.
      if (given.length) {
        return err(
          new RuleError(ADMIN_ONLY, "Bu alanları yalnız yönetici girebilir.", { what: "lead_create", fields: given }),
        );
      }
    }
    if (input.customerStatus !== undefined && input.customerStatus !== null && input.customerStatus !== "") {
      if (!isCustomerStatus(input.customerStatus)) {
        if (input.parseMode !== "lenient") {
          return err(
            new RuleError("lead.customer_status", "Müşteri durumu listede yok.", {
              customerStatus: input.customerStatus,
            }),
          );
        }
      }
    }
    const customerStatus = isCustomerStatus(input.customerStatus) ? input.customerStatus : null;
    const rawFields: Record<string, unknown> = {
      courtCount: input.courtCount ?? null,
      courtModel: input.courtModel ?? "",
      expectedCloseDate: input.expectedCloseDate ?? null,
      organizationId: input.organizationId ?? null,
    };
    for (const k of [
      "products",
      "installSite",
      "installTimeline",
      "customerProfile",
      "courtCountBand",
      "adSurface",
    ] as const) {
      if (input[k] !== undefined) rawFields[k] = input[k];
    }
    let fields: Partial<LeadFields>;
    const dropped: { key: string; raw: unknown }[] = [];
    if (input.parseMode === "lenient") {
      const r = parseLeadFieldsLenient(rawFields);
      fields = r.fields;
      dropped.push(...r.dropped);
    } else {
      const fieldsR = parseLeadFields(rawFields);
      if (!fieldsR.ok) return fieldsR;
      fields = fieldsR.value;
    }
    if (fields.organizationId) {
      const org = await this.deps.uow.run((r) => r.organizations.findById(fields.organizationId!));
      if (!org) {
        return err(
          new RuleError("lead.organization_not_found", "Kuruluş bulunamadı.", {
            organizationId: fields.organizationId,
          }),
        );
      }
    }

    const { clock, ids, platforms, uow } = this.deps;
    const unavailable = (await this.deps.team?.inactiveUserIds?.()) ?? null;
    const extraAnswers: Record<string, unknown> = { ...(input.extraAnswers ?? {}) };
    if (phoneRaw) extraAnswers["phone_raw"] = phoneRaw;
    if (dropped.length)
      extraAnswers["dropped_fields"] = dropped.map((d) => ({ key: d.key, raw: String(d.raw).slice(0, 200) }));

    const outcome = await uow.run(async (repos): Promise<CreateLeadResult & { domainEvents: DomainEvent[] }> => {
      if (platformId) {
        const existing = await repos.leads.findByPlatformId(input.source, platformId.value);
        if (existing) return { lead: existing, created: false, personMatched: false, domainEvents: [] };
      }
      if (input.adoptImportLead) {
        const adopted = await this.adopt(repos, {
          email,
          phone,
          campaignName: input.campaign?.campaignName ?? null,
          platformLeadId: platformId?.value ?? null,
          source: input.source,
          attribution: input.attribution ?? null,
          consents: consentInputs,
          fields,
          extraAnswers,
        });
        if (adopted) return { lead: adopted, created: false, personMatched: true, adopted: true, domainEvents: [] };
      }

      const now = clock.now();
      const submitted = input.createdAt;
      const createdAt =
        submitted && !Number.isNaN(submitted.getTime()) && submitted.getTime() <= now.getTime() ? submitted : now;
      const { person, matched } = await this.findOrCreatePerson(repos, {
        fullName,
        email,
        phone,
        country,
        company: input.company ?? "",
        now,
      });
      const assignedUserId = await this.resolveAssignment(repos, input, country, unavailable);

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
        extraAnswers,
        courtCount: fields.courtCount ?? null,
        courtModel: fields.courtModel ?? "",
        expectedCloseDate: fields.expectedCloseDate ?? null,
        organizationId: fields.organizationId ?? null,
        // Satış takip alanları (Faz 7g).
        ...emptyTrackingFields(),
        customerStatus,
        ...(fields.products ? { products: fields.products } : {}),
        installSite: fields.installSite ?? null,
        installTimeline: fields.installTimeline ?? null,
        customerProfile: fields.customerProfile ?? null,
        courtCountBand: fields.courtCountBand ?? null,
        adSurface: fields.adSurface ?? null,
        contactHistoryUnknown: input.contactHistoryUnknown === true,
        createdAt,
        updatedAt: now,
      };
      await repos.leads.insert(lead);
      if (input.attribution && hasAttribution(input.attribution)) {
        await repos.leads.saveAttribution(lead.id, { ...EMPTY_ATTRIBUTION, ...input.attribution });
      }
      if (consentInputs.length) {
        const rows: LeadConsent[] = consentInputs.map((c) => ({
          id: ids.next(),
          leadId: lead.id,
          type: c.type,
          granted: c.granted,
          textVersion: c.textVersion ?? "",
          grantedAt: c.grantedAt ?? createdAt,
        }));
        await repos.leads.saveConsents(rows);
      }

      const event: StageEvent = {
        id: ids.next(),
        leadId: lead.id,
        changeId: ids.next(),
        stageCode: "NEW",
        // "Yeni lead" platforma gönderim anıyla gider; outbox bekleme süresi yine işleme anından sayılır.
        occurredAt: createdAt,
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
          actorUserId: input.actor?.userId ?? null,
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
    this.deps.logger.info(
      outcome.adopted ? "Excel lead'i benimsendi" : outcome.created ? "lead oluşturuldu" : "lead zaten vardı",
      {
        leadId: outcome.lead.id,
        source: input.source,
        personMatched: outcome.personMatched,
        assignedUserId: outcome.lead.assignedUserId,
      },
    );
    return ok({
      lead: outcome.lead,
      created: outcome.created,
      personMatched: outcome.personMatched,
      ...(outcome.adopted ? { adopted: true } : {}),
    });
  }

  /**
   * Excel'den gelen açık lead'i benimseme: aynı kişi, `extra_answers.excel_no` var, aşama açık, kampanya aynı ya da
   * boş. Boş alanlar doldurulur (esnek), platform kimliği `extra_answers.platform_lead_id`'ye yazılır.
   */
  private async adopt(
    repos: Repositories,
    a: {
      email: Email | null;
      phone: PhoneNumber | null;
      campaignName: string | null;
      platformLeadId: string | null;
      source: LeadSource;
      attribution: Partial<LeadAttribution> | null;
      consents: readonly ConsentInput[];
      fields: Partial<LeadFields>;
      extraAnswers: Record<string, unknown>;
    },
  ): Promise<Lead | null> {
    const person = await repos.persons.findByEmailOrPhone(a.email?.value ?? null, a.phone?.e164 ?? null);
    if (!person) return null;
    const candidates = (await repos.leads.list({ personId: person.id, includeTest: true })).filter(
      (l) =>
        // Excel aktarımı ya da form tablosu eşitlemesinden gelen açık lead (gerçek platform kimliği henüz yok).
        ("excel_no" in l.extraAnswers || "sheet_key" in l.extraAnswers) &&
        !isTerminal(l.currentStage) &&
        (!l.campaign.campaignName || !a.campaignName || l.campaign.campaignName === a.campaignName),
    );
    const lead = candidates[0];
    if (!lead) return null;
    const now = this.deps.clock.now();
    const fill: Partial<LeadFields> = {};
    for (const k of ["installSite", "installTimeline", "customerProfile", "courtCountBand", "adSurface"] as const) {
      if (lead[k] === null && a.fields[k] != null) (fill as Record<string, unknown>)[k] = a.fields[k];
    }
    if (lead.courtCount === null && a.fields.courtCount != null && !hasAnyProduct(lead.products)) {
      fill.courtCount = a.fields.courtCount;
    }
    if (Object.keys(fill).length) await repos.leads.updateFields(lead.id, fill, now);
    // Geri bildirim kimliği (feedbackIdentity): ilk benimseyen reklam kaydı kalır; `source` yine `import`.
    const identity: Record<string, unknown> = {};
    if (isAdSource(a.source) && !isAdSource(lead.extraAnswers["platform_source"])) {
      identity["platform_source"] = a.source;
      if (a.platformLeadId) identity["platform_lead_id"] = a.platformLeadId;
    } else if (a.platformLeadId && !("platform_lead_id" in lead.extraAnswers)) {
      identity["platform_lead_id"] = a.platformLeadId;
    }
    if (Object.keys(identity).length) await repos.leads.mergeExtraAnswers(lead.id, identity, now);
    // Eşleştirme anahtarları ve onaylar da lead'e yazılır (yoksa): site formu lead'i bunlar olmadan gönderilemez.
    if (a.attribution && hasAttribution(a.attribution) && !(await repos.leads.findAttribution(lead.id))) {
      await repos.leads.saveAttribution(lead.id, { ...EMPTY_ATTRIBUTION, ...a.attribution });
    }
    if (a.consents.length) {
      const have = new Set((await repos.leads.findConsents(lead.id)).map((c) => c.type));
      const rows: LeadConsent[] = a.consents
        .filter((c) => !have.has(c.type))
        .map((c) => ({
          id: this.deps.ids.next(),
          leadId: lead.id,
          type: c.type,
          granted: c.granted,
          textVersion: c.textVersion ?? "",
          grantedAt: c.grantedAt ?? now,
        }));
      if (rows.length) await repos.leads.saveConsents(rows);
    }
    // Benimsemeden önce "elle/içe aktarım" diye atlanmış aşama olayları yeniden sıraya girer.
    if ("platform_source" in identity) {
      await repos.outbox.reviveSkipped(lead.id, "manual_source", new Date(now.getTime() + this.deps.undoWindowMs));
    }
    return { ...lead, ...fill, extraAnswers: { ...lead.extraAnswers, ...identity }, updatedAt: now };
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
      organizationId: null,
      createdAt: p.now,
    };
    await repos.persons.insert(person);
    return { person, matched: false };
  }

  /**
   * Öncelik: açık atama > elle açan satışçı (admin değilse) > ülke kuralı > havuz. Faz 7g (D7): pasif kural
   * kullanıcısı atlanır (yedeğe ya da havuza); dizin bilinmiyorsa (null) süzme yapılmaz (fail-open).
   */
  private async resolveAssignment(
    repos: Repositories,
    input: CreateLeadInput,
    country: string | null,
    unavailable: ReadonlySet<string> | null,
  ): Promise<string | null> {
    if (input.assignedUserId !== undefined) return input.assignedUserId;
    if (input.actor && !input.actor.isAdmin) return input.actor.userId;
    return resolveAssignee(country, await repos.territories.all(), unavailable ?? new Set());
  }
}
