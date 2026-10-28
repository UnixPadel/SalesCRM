/**
 * Bellek içi sahte uygulamalar (Genel plan kural 2: testler sahte uygulamayla çalışır).
 * `InMemoryUnitOfWork` gerçek transaction gibi davranır: fn fırlatırsa hiçbir yazma kalmaz.
 */
import { FixedClock, SequentialIdGenerator, silentLogger } from "../../shared/kernel";
import type {
  DomainEvent,
  DomainEventPublisher,
  Lead,
  LeadListFilter,
  LeadRepository,
  LostReasonSource,
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
  events: StageEvent[];
  outbox: OutboxRow[];
  territories: TerritoryRule[];
  lostReasons: string[];
  /** Test: bu aşama kodunda olay eklemesi veritabanı hatasıyla patlar (transaction testi). */
  poisonStage?: StageCode;
}

export const emptyState = (): MemoryState => ({
  leads: [],
  persons: [],
  events: [],
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
      if (f.stage) rows = rows.filter((l) => l.currentStage === f.stage);
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
  };
  const persons: PersonRepository = {
    async findByEmailOrPhone(email, phone) {
      const p = s.persons.find((x) => (email && x.emailNormalized === email) || (phone && x.phoneE164 === phone));
      return p ? { ...p } : undefined;
    },
    async insert(p) {
      s.persons.push({ ...p });
    },
  };
  const stageEvents: StageEventRepository = {
    async listByLead(leadId) {
      return s.events.filter((e) => e.leadId === leadId).map((e) => ({ ...e }));
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
  return { leads, persons, stageEvents, outbox, territories, lostReasons };
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
