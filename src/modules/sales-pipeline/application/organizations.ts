import { NotFoundError, RuleError, err, ok, type Result } from "../../shared/kernel";
import { Email, PhoneNumber } from "../../shared/normalization";
import {
  isTerminal,
  parseOrganizationFields,
  toEur,
  type Lead,
  type Organization,
  type Person,
  type Repositories,
} from "../domain";
import { withSummaries, type LeadListItem } from "./queries";
import type { Actor, UseCaseDeps } from "./types";
import { loadActionableLead, territoriesOf } from "./visibility";

/**
 * Kuruluşlar ve kişiler (Faz 6d). Kuruluş ve kişi kayıtları ekibin ortak defteridir: her satışçı görür ve düzenler,
 * görüntüleyici yalnız okur (api katmanı). Lead'ler ise görünürlük kuralına tabidir; kişi/kuruluş özetlerinde
 * yalnız görünür lead'ler sayılır.
 */

export interface CreateOrganizationInput {
  fields: Record<string, unknown>;
  actor: Actor;
}

export class CreateOrganization {
  constructor(private readonly deps: UseCaseDeps) {}

  async execute(input: CreateOrganizationInput): Promise<Result<Organization, RuleError>> {
    const parsed = parseOrganizationFields(input.fields, { requireName: true });
    if (!parsed.ok) return parsed;
    const f = parsed.value;
    const { uow, clock, ids, logger } = this.deps;
    return uow.run(async (repos): Promise<Result<Organization, RuleError>> => {
      const dup = await repos.organizations.findByName(f.name!, f.country ?? null);
      if (dup) {
        return err(
          new RuleError("organization.duplicate", "Aynı ad ve ülkede bir kuruluş zaten var.", {
            organizationId: dup.id,
          }),
        );
      }
      const now = clock.now();
      const organization: Organization = {
        id: ids.next(),
        name: f.name!,
        type: f.type ?? "club",
        country: f.country ?? null,
        website: f.website ?? "",
        notes: f.notes ?? "",
        legacyId: null,
        createdAt: now,
        updatedAt: now,
      };
      await repos.organizations.insert(organization);
      logger.info("kuruluş açıldı", { organizationId: organization.id, actorUserId: input.actor.userId });
      return ok(organization);
    });
  }
}

export interface UpdateOrganizationInput {
  organizationId: string;
  fields: Record<string, unknown>;
  actor: Actor;
}

export class UpdateOrganization {
  constructor(private readonly deps: UseCaseDeps) {}

  async execute(input: UpdateOrganizationInput): Promise<Result<Organization, RuleError>> {
    const parsed = parseOrganizationFields(input.fields);
    if (!parsed.ok) return parsed;
    const f = parsed.value;
    const { uow, clock } = this.deps;
    return uow.run(async (repos): Promise<Result<Organization, RuleError>> => {
      const current = await repos.organizations.findById(input.organizationId);
      if (!current) return err(new NotFoundError("Kuruluş", input.organizationId));
      if (Object.keys(f).length === 0) return ok(current);
      const next = { ...current, ...f };
      if (next.name !== current.name || next.country !== current.country) {
        const dup = await repos.organizations.findByName(next.name, next.country);
        if (dup && dup.id !== current.id) {
          return err(
            new RuleError("organization.duplicate", "Aynı ad ve ülkede bir kuruluş zaten var.", {
              organizationId: dup.id,
            }),
          );
        }
      }
      const now = clock.now();
      await repos.organizations.update(current.id, f, now);
      return ok({ ...next, updatedAt: now });
    });
  }
}

export interface UpdateLeadContactInput {
  leadId: string;
  fullName?: string | null | undefined;
  email?: string | null | undefined;
  phone?: string | null | undefined;
  actor: Actor;
}

/**
 * Lead'in kimlik alanları: ad, e-posta, telefon. Lead ve bağlı kişi kaydı birlikte güncellenir (aynı transaction).
 * Kural: e-posta ya da telefondan en az biri kalır; başka bir kişiye ait e-posta/telefon verilemez (mükerrer kişi
 * kuralı; birleştirme 6d kapsamı dışında).
 */
export class UpdateLeadContact {
  constructor(private readonly deps: UseCaseDeps) {}

  async execute(input: UpdateLeadContactInput): Promise<Result<Lead, RuleError>> {
    const { uow, clock, logger } = this.deps;
    return uow.run(async (repos): Promise<Result<Lead, RuleError>> => {
      const leadR = await loadActionableLead(repos, input.leadId, input.actor);
      if (!leadR.ok) return leadR;
      const lead = leadR.value;

      let fullName = lead.fullName;
      if (input.fullName !== undefined && input.fullName !== null) {
        fullName = input.fullName.trim();
        if (!fullName) return err(new RuleError("lead.name_required", "Ad soyad zorunlu.", {}));
        if (fullName.length > 200) return err(new RuleError("lead.name_too_long", "Ad en fazla 200 karakter.", {}));
      }
      let email = lead.email;
      if (input.email !== undefined) {
        if (input.email === null || !input.email.trim()) email = null;
        else {
          const r = Email.parse(input.email);
          if (!r.ok) return r;
          email = r.value.value;
        }
      }
      let phoneE164 = lead.phoneE164;
      if (input.phone !== undefined) {
        if (input.phone === null || !input.phone.trim()) phoneE164 = null;
        else {
          const r = PhoneNumber.parse(input.phone, lead.country ?? undefined);
          if (!r.ok) return r;
          phoneE164 = r.value.e164;
        }
      }
      if (!email && !phoneE164) {
        return err(new RuleError("lead.contact_required", "E-posta ya da telefon zorunlu.", {}));
      }
      if (fullName === lead.fullName && email === lead.email && phoneE164 === lead.phoneE164) return ok(lead);

      // Başka bir kişinin e-postası / telefonu verilemez.
      if (email && email !== lead.email) {
        const other = await repos.persons.findByEmailOrPhone(email, null);
        if (other && other.id !== lead.personId) {
          return err(
            new RuleError("person.email_taken", "Bu e-posta başka bir kişiye kayıtlı.", { personId: other.id }),
          );
        }
      }
      if (phoneE164 && phoneE164 !== lead.phoneE164) {
        const other = await repos.persons.findByEmailOrPhone(null, phoneE164);
        if (other && other.id !== lead.personId) {
          return err(
            new RuleError("person.phone_taken", "Bu telefon başka bir kişiye kayıtlı.", { personId: other.id }),
          );
        }
      }
      const now = clock.now();
      await repos.leads.updateIdentity(lead.id, { fullName, email, phoneE164 }, now);
      await repos.persons.update(lead.personId, { fullName, emailNormalized: email, phoneE164 });
      logger.info("lead kimliği güncellendi", { leadId: lead.id, actorUserId: input.actor.userId });
      return ok({ ...lead, fullName, email, phoneE164, updatedAt: now });
    });
  }
}

export interface OrganizationSummary {
  organization: Organization;
  personCount: number;
  /** Görünür lead'ler. */
  leadCount: number;
  openCount: number;
  wonCount: number;
  openTotalEur: number;
}

export interface PersonSummary {
  person: Person;
  organization: Pick<Organization, "id" | "name"> | null;
  /** Görünür lead'ler, yeniden eskiye. */
  leads: LeadListItem[];
}

export interface SearchResult {
  leads: Lead[];
  persons: Person[];
  organizations: Organization[];
}

export class PeopleQueries {
  constructor(private readonly deps: UseCaseDeps) {}

  private async visibleLeads(repos: Repositories, actor: Actor, extra: { search?: string; limit?: number } = {}) {
    const visibleTo = actor.isAdmin
      ? undefined
      : { userId: actor.userId, countries: territoriesOf(actor.userId, await repos.territories.all()) };
    return repos.leads.list({ visibleTo, includeTest: false, search: extra.search, limit: extra.limit });
  }

  /** Kuruluş listesi; kişi ve görünür lead sayılarıyla. */
  async organizations(input: {
    actor: Actor;
    search?: string | undefined;
    limit?: number | undefined;
  }): Promise<OrganizationSummary[]> {
    return this.deps.uow.run(async (repos) => {
      const orgs = await repos.organizations.list({ search: input.search, limit: input.limit });
      if (!orgs.length) return [];
      const [persons, leads] = await Promise.all([repos.persons.list({}), this.visibleLeads(repos, input.actor)]);
      const withValue = await withSummaries(
        repos,
        leads.filter((l) => l.organizationId !== null),
      );
      const rates = this.deps.eurRates;
      return orgs.map((organization) => {
        const mine = withValue.filter((l) => l.organizationId === organization.id);
        const open = mine.filter((l) => !isTerminal(l.currentStage));
        return {
          organization,
          personCount: persons.filter((p) => p.organizationId === organization.id).length,
          leadCount: mine.length,
          openCount: open.length,
          wonCount: mine.filter((l) => l.currentStage === "WON").length,
          openTotalEur:
            Math.round(open.reduce((s, l) => s + (l.value ? (toEur(l.value, rates) ?? 0) : 0), 0) * 100) / 100,
        };
      });
    });
  }

  /** Kişi listesi; kuruluş adı ve görünür lead'leriyle. */
  async persons(input: {
    actor: Actor;
    search?: string | undefined;
    organizationId?: string | undefined;
    limit?: number | undefined;
  }): Promise<PersonSummary[]> {
    return this.deps.uow.run(async (repos) => {
      const persons = await repos.persons.list({
        search: input.search,
        organizationId: input.organizationId,
        limit: input.limit,
      });
      if (!persons.length) return [];
      const ids = new Set(persons.map((p) => p.id));
      const leads = (await this.visibleLeads(repos, input.actor)).filter((l) => ids.has(l.personId));
      const items = await withSummaries(repos, leads);
      const orgIds = [...new Set(persons.map((p) => p.organizationId).filter((x): x is string => x !== null))];
      const orgs = new Map((await repos.organizations.findByIds(orgIds)).map((o) => [o.id, o]));
      return persons.map((person) => {
        const org = person.organizationId ? orgs.get(person.organizationId) : undefined;
        return {
          person,
          organization: org ? { id: org.id, name: org.name } : null,
          leads: items.filter((l) => l.personId === person.id),
        };
      });
    });
  }

  /** Üst menü araması: lead (görünür), kişi, kuruluş; her biri en çok `limit`. */
  async search(input: { actor: Actor; q: string; limit?: number | undefined }): Promise<SearchResult> {
    const q = input.q.trim();
    const limit = input.limit ?? 6;
    if (q.length < 2) return { leads: [], persons: [], organizations: [] };
    return this.deps.uow.run(async (repos) => {
      const [leads, persons, organizations] = await Promise.all([
        this.visibleLeads(repos, input.actor, { search: q, limit }),
        repos.persons.list({ search: q, limit }),
        repos.organizations.list({ search: q, limit }),
      ]);
      return { leads, persons, organizations };
    });
  }
}
