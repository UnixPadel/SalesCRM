/**
 * Bellek içi sahte uygulamalar (Genel plan kural 2: testler sahte uygulamayla çalışır).
 * `InMemoryUnitOfWork` gerçek transaction gibi davranır: fn fırlatırsa hiçbir yazma kalmaz.
 */
import { FixedClock, SequentialIdGenerator, silentLogger } from "../../shared/kernel";
import { filterValues } from "../domain";
import type {
  Activity,
  ActivityRepository,
  ContactLog,
  ContactLogRepository,
  DomainEvent,
  DomainEventPublisher,
  Lead,
  LeadAttribution,
  LeadConsent,
  LeadListFilter,
  LeadRepository,
  LostReasonSource,
  Organization,
  OrganizationRepository,
  OutboxWriter,
  Person,
  PersonRepository,
  PlatformRegistry,
  Repositories,
  StageCode,
  StageEvent,
  StageEventRepository,
  TerritoryRule,
  TerritoryRuleSource,
  UnitOfWork,
} from "../domain";
import type { UseCaseDeps } from "./types";

export interface OutboxRow {
  id: string;
  stageEventId: string;
  provider: string;
  status: "pending" | "skipped";
  skipReason: string | null;
  nextAttemptAt: Date;
}

export interface MemoryState {
  leads: Lead[];
  persons: Person[];
  organizations: Organization[];
  events: StageEvent[];
  attributions: Record<string, LeadAttribution>;
  consents: LeadConsent[];
  activities: Activity[];
  /** Temas kayıtları (Faz 7g). */
  contactLogs: ContactLog[];
  outbox: OutboxRow[];
  territories: TerritoryRule[];
  lostReasons: string[];
  /** Test: bu aşama kodunda olay eklemesi veritabanı hatasıyla patlar (transaction testi). */
  poisonStage?: StageCode;
}

export const emptyState = (): MemoryState => ({
  leads: [],
  persons: [],
  organizations: [],
  events: [],
  attributions: {},
  consents: [],
  activities: [],
  contactLogs: [],
  outbox: [],
  territories: [],
  lostReasons: ["price_too_high", "competitor", "no_response", "unqualified"],
});

function reposFor(s: MemoryState): Repositories {
  const leads: LeadRepository = {
    async findById(id) {
      const l = s.leads.find((x) => x.id === id);
      return l ? { ...l } : undefined;
    },
    async findByPlatformId(source, pid) {
      const l = s.leads.find((x) => x.source === source && x.platformLeadId === pid);
      return l ? { ...l } : undefined;
    },
    async list(f: LeadListFilter) {
      let rows = s.leads.filter((l) => f.includeTest || !l.isTest);
      if (f.visibleTo) {
        const { userId, countries } = f.visibleTo;
        rows = rows.filter(
          (l) =>
            l.assignedUserId === userId ||
            (l.assignedUserId === null && (!l.country || countries.length === 0 || countries.includes(l.country))),
        );
      }
      // Çoklu değerli süzgeçler (Faz 7g): Postgres deposuyla aynı anlam (liste = bunlardan biri, boş = süzgeç yok).
      const stages = filterValues(f.stage);
      if (stages) rows = rows.filter((l) => stages.includes(l.currentStage));
      const owners = filterValues(f.owner);
      if (owners) rows = rows.filter((l) => owners.includes(l.assignedUserId));
      const countries = filterValues(f.country)?.map((c) => c.toUpperCase());
      if (countries) rows = rows.filter((l) => l.country !== null && countries.includes(l.country));
      if (f.organizationId) rows = rows.filter((l) => l.organizationId === f.organizationId);
      if (f.personId) rows = rows.filter((l) => l.personId === f.personId);
      const sources = filterValues(f.source);
      if (sources) rows = rows.filter((l) => sources.includes(l.source));
      if (f.search) {
        const q = f.search.toLowerCase();
        rows = rows.filter((l) =>
          [l.fullName, l.email, l.company, l.phoneE164].some((v) => (v ?? "").toLowerCase().includes(q)),
        );
      }
      rows = [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return f.limit ? rows.slice(0, f.limit) : rows;
    },
    async insert(lead) {
      if (s.leads.some((l) => l.id === lead.id)) throw new Error("duplicate lead id");
      if (
        lead.platformLeadId &&
        s.leads.some((l) => l.source === lead.source && l.platformLeadId === lead.platformLeadId)
      ) {
        throw new Error("leads_platform_uq");
      }
      s.leads.push({ ...lead });
    },
    async updateStage(id, stage: StageCode, updatedAt) {
      const l = s.leads.find((x) => x.id === id);
      if (!l) throw new Error("lead yok");
      l.currentStage = stage;
      l.updatedAt = updatedAt;
    },
    async updateAssignee(id, userId, updatedAt) {
      const l = s.leads.find((x) => x.id === id);
      if (!l) throw new Error("lead yok");
      l.assignedUserId = userId;
      l.updatedAt = updatedAt;
    },
    async updateFields(id, fields, updatedAt) {
      const l = s.leads.find((x) => x.id === id);
      if (!l) throw new Error("lead yok");
      Object.assign(l, fields);
      l.updatedAt = updatedAt;
    },
    async updateIdentity(id, identity, updatedAt) {
      const l = s.leads.find((x) => x.id === id);
      if (!l) throw new Error("lead yok");
      l.fullName = identity.fullName;
      l.email = identity.email;
      l.phoneE164 = identity.phoneE164;
      l.updatedAt = updatedAt;
    },
    async saveAttribution(leadId, a) {
      s.attributions[leadId] = { ...a };
    },
    async findAttribution(leadId) {
      const a = s.attributions[leadId];
      return a ? { ...a } : undefined;
    },
    async saveConsents(rows) {
      s.consents.push(...rows.map((c) => ({ ...c })));
    },
    async findConsents(leadId) {
      return s.consents.filter((c) => c.leadId === leadId).map((c) => ({ ...c }));
    },
  };
  const persons: PersonRepository = {
    async findById(id) {
      const p = s.persons.find((x) => x.id === id);
      return p ? { ...p } : undefined;
    },
    async findByEmailOrPhone(email, phone) {
      const p = s.persons.find((x) => (email && x.emailNormalized === email) || (phone && x.phoneE164 === phone));
      return p ? { ...p } : undefined;
    },
    async list(f) {
      let rows = [...s.persons];
      if (f.search) {
        const q = f.search.toLowerCase();
        rows = rows.filter((p) =>
          [p.fullName, p.emailNormalized, p.phoneE164, p.company].some((v) => (v ?? "").toLowerCase().includes(q)),
        );
      }
      if (f.organizationId) rows = rows.filter((p) => p.organizationId === f.organizationId);
      rows.sort((a, b) => a.fullName.localeCompare(b.fullName) || a.id.localeCompare(b.id));
      return (f.limit ? rows.slice(0, f.limit) : rows).map((p) => ({ ...p }));
    },
    async insert(p) {
      if (p.emailNormalized && s.persons.some((x) => x.emailNormalized === p.emailNormalized)) {
        throw new Error("persons_email_uq");
      }
      if (p.phoneE164 && s.persons.some((x) => x.phoneE164 === p.phoneE164)) throw new Error("persons_phone_uq");
      s.persons.push({ ...p });
    },
    async update(id, patch) {
      const p = s.persons.find((x) => x.id === id);
      if (!p) throw new Error("kişi yok");
      Object.assign(p, patch);
    },
  };
  const organizations: OrganizationRepository = {
    async findById(id) {
      const o = s.organizations.find((x) => x.id === id);
      return o ? { ...o } : undefined;
    },
    async findByIds(ids) {
      return s.organizations.filter((o) => ids.includes(o.id)).map((o) => ({ ...o }));
    },
    async findByLegacyId(legacyId) {
      const o = s.organizations.find((x) => x.legacyId === legacyId);
      return o ? { ...o } : undefined;
    },
    async findByName(name, country) {
      const o = s.organizations.find(
        (x) =>
          x.name.toLowerCase() === name.trim().toLowerCase() && (x.country ?? "") === (country?.toUpperCase() ?? ""),
      );
      return o ? { ...o } : undefined;
    },
    async list(f) {
      let rows = [...s.organizations];
      if (f.search) {
        const q = f.search.toLowerCase();
        rows = rows.filter((o) => [o.name, o.website, o.country].some((v) => (v ?? "").toLowerCase().includes(q)));
      }
      if (f.country) rows = rows.filter((o) => o.country === f.country!.toUpperCase());
      if (f.type) rows = rows.filter((o) => o.type === f.type);
      rows.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
      return (f.limit ? rows.slice(0, f.limit) : rows).map((o) => ({ ...o }));
    },
    async insert(o) {
      if (
        s.organizations.some(
          (x) => x.name.toLowerCase() === o.name.toLowerCase() && (x.country ?? "") === (o.country ?? ""),
        )
      ) {
        throw new Error("organizations_name_country_uq");
      }
      s.organizations.push({ ...o });
    },
    async update(id, fields, updatedAt) {
      const o = s.organizations.find((x) => x.id === id);
      if (!o) throw new Error("kuruluş yok");
      Object.assign(o, fields);
      o.updatedAt = updatedAt;
    },
  };
  const stageEvents: StageEventRepository = {
    async listByLead(leadId) {
      return s.events.filter((e) => e.leadId === leadId).map((e) => ({ ...e }));
    },
    async listByLeads(leadIds) {
      return s.events
        .filter((e) => leadIds.includes(e.leadId))
        .sort((a, b) => a.leadId.localeCompare(b.leadId) || a.sequence - b.sequence)
        .map((e) => ({ ...e }));
    },
    async findByIds(ids) {
      return s.events.filter((e) => ids.includes(e.id)).map((e) => ({ ...e }));
    },
    async listSince(since, sources) {
      const leadOk = new Set(s.leads.filter((l) => !l.isTest && sources.includes(l.source)).map((l) => l.id));
      return s.events
        .filter((e) => leadOk.has(e.leadId) && !e.undoneAt && e.occurredAt >= since)
        .map((e) => ({ ...e }));
    },
    async nextSequence(leadId) {
      return s.events.filter((e) => e.leadId === leadId).reduce((m, e) => Math.max(m, e.sequence), 0) + 1;
    },
    async insert(e) {
      if (s.poisonStage === e.stageCode) throw new Error(`db hatası (poison: ${e.stageCode})`);
      if (s.events.some((x) => x.leadId === e.leadId && x.sequence === e.sequence))
        throw new Error("lead_stage_events_seq_uq");
      s.events.push({ ...e });
    },
    async markUndone(ids, at, by) {
      for (const e of s.events) if (ids.includes(e.id)) e.undoneAt = at;
      void by;
    },
  };
  const byDue = (a: Activity, b: Activity) => a.dueAt.getTime() - b.dueAt.getTime();
  /** DB: contact_logs.completed_activity_id ON DELETE SET NULL (silinen aktiviteye işaret eden kayıt bağı düşer). */
  const unlinkCompleted = (removed: ReadonlySet<string>) => {
    for (const l of s.contactLogs) {
      if (l.completedActivityId !== null && removed.has(l.completedActivityId)) l.completedActivityId = null;
    }
  };
  const activities: ActivityRepository = {
    async findById(id) {
      const a = s.activities.find((x) => x.id === id);
      return a ? { ...a } : undefined;
    },
    async listByLead(leadId) {
      return s.activities
        .filter((a) => a.leadId === leadId)
        .sort(byDue)
        .map((a) => ({ ...a }));
    },
    async listOpenByLeads(leadIds) {
      return s.activities
        .filter((a) => a.doneAt === null && leadIds.includes(a.leadId))
        .sort(byDue)
        .map((a) => ({ ...a }));
    },
    async insert(a) {
      if (s.activities.some((x) => x.id === a.id)) throw new Error("duplicate activity id");
      s.activities.push({ ...a });
    },
    async setDone(id, doneAt, updatedAt) {
      const a = s.activities.find((x) => x.id === id);
      if (!a) throw new Error("aktivite yok");
      a.doneAt = doneAt;
      a.updatedAt = updatedAt;
    },
    async remove(id) {
      s.activities = s.activities.filter((a) => a.id !== id);
      unlinkCompleted(new Set([id]));
    },
    async findByLegacyId(legacyId) {
      const a = s.activities.find((x) => x.legacyId === legacyId);
      return a ? { ...a } : undefined;
    },
    async removeAutoCreatedByChange(changeId) {
      const removed = new Set(
        s.activities.filter((a) => a.autoCreated && a.createdByChangeId === changeId).map((a) => a.id),
      );
      s.activities = s.activities.filter((a) => !removed.has(a.id));
      unlinkCompleted(removed);
      return removed.size;
    },
  };
  const contactLogs: ContactLogRepository = {
    async insert(log) {
      if (s.contactLogs.some((x) => x.id === log.id)) throw new Error("duplicate contact log id");
      s.contactLogs.push({ ...log });
    },
    async findById(id) {
      const l = s.contactLogs.find((x) => x.id === id);
      return l ? { ...l } : undefined;
    },
    async remove(id) {
      s.contactLogs = s.contactLogs.filter((l) => l.id !== id);
      // DB: activities.log_id / next_of_log_id ON DELETE SET NULL.
      for (const a of s.activities) {
        if (a.logId === id) a.logId = null;
        if (a.nextOfLogId === id) a.nextOfLogId = null;
      }
    },
  };
  let outboxSeq = 0;
  const outbox: OutboxWriter = {
    async enqueue(stageEventId, provider, notBefore) {
      s.outbox.push({
        id: `ob-${++outboxSeq}`,
        stageEventId,
        provider,
        status: "pending",
        skipReason: null,
        nextAttemptAt: notBefore,
      });
    },
    async skipForEvents(ids, reason) {
      for (const r of s.outbox) {
        if (ids.includes(r.stageEventId) && r.status === "pending") {
          r.status = "skipped";
          r.skipReason = reason;
        }
      }
    },
  };
  const territories: TerritoryRuleSource = { all: async () => s.territories.map((t) => ({ ...t })) };
  const lostReasons: LostReasonSource = { activeCodes: async () => [...s.lostReasons] };
  return { leads, persons, organizations, stageEvents, activities, contactLogs, outbox, territories, lostReasons };
}

export class InMemoryUnitOfWork implements UnitOfWork {
  constructor(public state: MemoryState = emptyState()) {}
  /** Çalışma kopyası üzerinde çalışır; başarıda kopya kalıcı olur, hatada atılır (ROLLBACK). */
  async run<T>(fn: (repos: Repositories) => Promise<T>): Promise<T> {
    const working = structuredClone(this.state);
    const out = await fn(reposFor(working));
    this.state = working;
    return out;
  }
}

export class RecordingPublisher implements DomainEventPublisher {
  published: DomainEvent[] = [];
  async publish(events: readonly DomainEvent[]) {
    this.published.push(...events);
  }
}

export class StaticPlatforms implements PlatformRegistry {
  constructor(private providers: string[] = []) {}
  enabledProviders() {
    return this.providers;
  }
}

export interface TestHarness extends UseCaseDeps {
  uow: InMemoryUnitOfWork;
  clock: FixedClock;
  ids: SequentialIdGenerator;
  events: RecordingPublisher;
  platforms: StaticPlatforms;
}

export function testDeps(
  over: Partial<{ providers: string[]; state: MemoryState; undoWindowMs: number }> = {},
): TestHarness {
  return {
    uow: new InMemoryUnitOfWork(over.state ?? emptyState()),
    clock: new FixedClock("2026-03-01T10:00:00Z"),
    ids: new SequentialIdGenerator("id"),
    platforms: new StaticPlatforms(over.providers ?? []),
    events: new RecordingPublisher(),
    logger: silentLogger,
    undoWindowMs: over.undoWindowMs ?? 10 * 60_000,
  };
}
