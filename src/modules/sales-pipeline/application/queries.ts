import { NotFoundError, RuleError, err, ok, type Result } from "../../shared/kernel";
import {
  allowedTransitions,
  columnStats,
  planUndo,
  stageSummary,
  summarizeActivities,
  type Activity,
  type ActivitySummary,
  type ColumnStats,
  type Lead,
  type LeadAttribution,
  type Organization,
  type LeadConsent,
  type LeadSource,
  type Repositories,
  type StageCode,
  type StageEvent,
  type StageEventOrigin,
  type StageSummary,
} from "../domain";
import type { Actor, UseCaseDeps } from "./types";
import { canSee, territoriesOf } from "./visibility";

/**
 * Liste ve detaydaki lead: aktivite özeti (açık sayısı, sonraki, takipsiz) ve aşama özeti
 * (aşamaya giriş anı, son geçerli tutar) ile.
 */
export interface LeadListItem extends Lead, ActivitySummary, StageSummary {}

export async function withSummaries(repos: Repositories, leads: readonly Lead[]): Promise<LeadListItem[]> {
  const ids = leads.map((l) => l.id);
  const [open, events] = await Promise.all([repos.activities.listOpenByLeads(ids), repos.stageEvents.listByLeads(ids)]);
  const actsByLead = new Map<string, Activity[]>();
  for (const a of open) actsByLead.set(a.leadId, [...(actsByLead.get(a.leadId) ?? []), a]);
  const eventsByLead = new Map<string, StageEvent[]>();
  for (const e of events) eventsByLead.set(e.leadId, [...(eventsByLead.get(e.leadId) ?? []), e]);
  return leads.map((l) => ({
    ...l,
    ...summarizeActivities(l.currentStage, actsByLead.get(l.id) ?? []),
    ...stageSummary(l, eventsByLead.get(l.id) ?? []),
  }));
}

/** Pano: filtrelenmiş lead'ler ve aynı kümeden hesaplanan kolon istatistikleri (kural 4). */
export interface Board {
  leads: LeadListItem[];
  columns: ColumnStats[];
}

export interface BoardInput {
  actor: Actor;
  /** Sorumlu kimliği; null = ortak havuz; undefined = hepsi. */
  owner?: string | null | undefined;
  country?: string | undefined;
  /** true: yalnız takipsiz lead'ler (kural 1). */
  rotting?: boolean | undefined;
  /** Lead kaynağı (Faz 7). */
  source?: LeadSource | undefined;
  includeTest?: boolean | undefined;
}

export interface LeadDetail {
  lead: LeadListItem;
  /** Bağlı kuruluş (Faz 6d); yoksa null. */
  organization: Organization | null;
  events: StageEvent[];
  /** Açık ve bitmiş aktiviteler, vade sırasıyla. */
  activities: Activity[];
  /** Arayüz aşama kuralını tekrar yazmaz; izinli geçişleri buradan okur. */
  allowedTransitions: readonly StageCode[];
  undo: { available: boolean; reason?: string; untilIso?: string };
}

export interface ListLeadsInput {
  actor: Actor;
  stage?: StageCode | undefined;
  /** Sorumlu kimliği; null = ortak havuz; undefined = hepsi. */
  owner?: string | null | undefined;
  country?: string | undefined;
  organizationId?: string | undefined;
  personId?: string | undefined;
  source?: LeadSource | undefined;
  search?: string | undefined;
  includeTest?: boolean | undefined;
  limit?: number | undefined;
}

/**
 * Giden olay dağıtıcısının (ad-feedback) bir aşama olayını platforma çevirmek için gereken her şey.
 * Modüller arası tek kapı: dağıtıcı sales-pipeline tablolarını okumaz, bu DTO'yu alır.
 */
export interface OutboundStageEvent {
  stageEventId: string;
  leadId: string;
  stageCode: StageCode;
  occurredAt: Date;
  undoneAt: Date | null;
  origin: StageEventOrigin;
  value: { amount: number; currency: string } | null;
  lead: {
    source: LeadSource;
    platformLeadId: string | null;
    /** Normalize e-posta (küçük harf, boşluksuz) ya da null. */
    email: string | null;
    /** E.164 ("+90…") ya da null. */
    phoneE164: string | null;
    isTest: boolean;
    country: string | null;
    /**
     * Lead'in CRM'e düştüğü an; tıklama zamanı bilinmiyorsa platform pencerelerinin tabanı. İsteğe bağlı:
     * Faz 5'te eklendi, önceki adaptörlerin test bağlamları alanı taşımaz (Meta koduna dokunulmadı).
     */
    createdAt?: Date;
  };
  attribution: LeadAttribution | null;
  consents: LeadConsent[];
}

export class LeadQueries {
  constructor(private readonly deps: UseCaseDeps) {}

  /** Geriye doldurma (Faz 4): kaynaklardaki test olmayan lead'lerin geri alınmamış olayları, `since` sonrası. */
  async stageEventsSince(
    since: Date,
    sources: readonly LeadSource[],
  ): Promise<{ stageEventId: string; leadId: string; occurredAt: Date }[]> {
    return this.deps.uow.run(async (repos) =>
      (await repos.stageEvents.listSince(since, sources)).map((e) => ({
        stageEventId: e.id,
        leadId: e.leadId,
        occurredAt: e.occurredAt,
      })),
    );
  }

  /** Aşama olayı kimlikleri → dağıtım bağlamı; bulunamayan olay ya da lead atlanır. */
  async outboundContext(stageEventIds: readonly string[]): Promise<OutboundStageEvent[]> {
    if (!stageEventIds.length) return [];
    return this.deps.uow.run(async (repos) => {
      const events = await repos.stageEvents.findByIds(stageEventIds);
      const leadIds = [...new Set(events.map((e) => e.leadId))];
      const leads = new Map<string, Lead>();
      const attributions = new Map<string, LeadAttribution | undefined>();
      const consents = new Map<string, LeadConsent[]>();
      for (const id of leadIds) {
        const lead = await repos.leads.findById(id);
        if (!lead) continue;
        leads.set(id, lead);
        attributions.set(id, await repos.leads.findAttribution(id));
        consents.set(id, await repos.leads.findConsents(id));
      }
      const out: OutboundStageEvent[] = [];
      for (const e of events) {
        const lead = leads.get(e.leadId);
        if (!lead) continue;
        out.push({
          stageEventId: e.id,
          leadId: lead.id,
          stageCode: e.stageCode,
          occurredAt: e.occurredAt,
          undoneAt: e.undoneAt,
          origin: e.origin,
          value: e.value,
          lead: {
            source: lead.source,
            platformLeadId: lead.platformLeadId,
            email: lead.email,
            phoneE164: lead.phoneE164,
            isTest: lead.isTest,
            country: lead.country,
            createdAt: lead.createdAt,
          },
          attribution: attributions.get(lead.id) ?? null,
          consents: consents.get(lead.id) ?? [],
        });
      }
      return out;
    });
  }

  async list(input: ListLeadsInput): Promise<LeadListItem[]> {
    return this.deps.uow.run(async (repos) => {
      const visibleTo = input.actor.isAdmin
        ? undefined
        : { userId: input.actor.userId, countries: territoriesOf(input.actor.userId, await repos.territories.all()) };
      const leads = await repos.leads.list({
        visibleTo,
        stage: input.stage,
        owner: input.owner,
        country: input.country,
        organizationId: input.organizationId,
        personId: input.personId,
        source: input.source,
        search: input.search,
        includeTest: input.includeTest,
        limit: input.limit,
      });
      return withSummaries(repos, leads);
    });
  }

  /** Kanban verisi: görünürlük + sorumlu · ülke · kaynak · takipsiz filtreleri; istatistikler filtrelenmiş kümeden. */
  async board(input: BoardInput): Promise<Board> {
    return this.deps.uow.run(async (repos) => {
      const visibleTo = input.actor.isAdmin
        ? undefined
        : { userId: input.actor.userId, countries: territoriesOf(input.actor.userId, await repos.territories.all()) };
      const leads = await withSummaries(
        repos,
        await repos.leads.list({
          visibleTo,
          owner: input.owner,
          country: input.country,
          source: input.source,
          includeTest: input.includeTest,
        }),
      );
      const filtered = input.rotting ? leads.filter((l) => l.rotting) : leads;
      return { leads: filtered, columns: columnStats(filtered, this.deps.clock.now(), this.deps.eurRates) };
    });
  }

  /** Tıklama kimlikleri; yoksa undefined. Yalnız iç kullanım ve testler (erişim denetimi `get` ile). */
  async attribution(leadId: string): Promise<LeadAttribution | undefined> {
    return this.deps.uow.run((repos) => repos.leads.findAttribution(leadId));
  }

  /** Onay kayıtları; iç kullanım ve testler. */
  async consents(leadId: string): Promise<LeadConsent[]> {
    return this.deps.uow.run((repos) => repos.leads.findConsents(leadId));
  }

  async get(leadId: string, actor: Actor): Promise<Result<LeadDetail, RuleError>> {
    return this.deps.uow.run(async (repos) => {
      const lead = await repos.leads.findById(leadId);
      if (!lead) return err(new NotFoundError("Lead", leadId));
      const myCountries = actor.isAdmin ? [] : territoriesOf(actor.userId, await repos.territories.all());
      if (!canSee(lead, actor, myCountries)) return err(new NotFoundError("Lead", leadId));
      const events = await repos.stageEvents.listByLead(lead.id);
      const activities = await repos.activities.listByLead(lead.id);
      const organization = lead.organizationId ? await repos.organizations.findById(lead.organizationId) : undefined;
      const now = this.deps.clock.now();
      const undo = planUndo({
        events,
        now,
        windowMs: this.deps.undoWindowMs,
        actorUserId: actor.userId,
        actorIsAdmin: actor.isAdmin,
      });
      const last = events.filter((e) => !e.undoneAt).sort((a, b) => b.sequence - a.sequence)[0];
      return ok({
        lead: { ...lead, ...summarizeActivities(lead.currentStage, activities), ...stageSummary(lead, events) },
        events,
        organization: organization ?? null,
        activities,
        allowedTransitions: allowedTransitions(lead.currentStage),
        undo: undo.ok
          ? {
              available: true,
              untilIso: new Date((last?.occurredAt.getTime() ?? 0) + this.deps.undoWindowMs).toISOString(),
            }
          : { available: false, reason: undo.error.code },
      });
    });
  }
}
