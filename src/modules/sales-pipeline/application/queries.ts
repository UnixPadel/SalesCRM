import { NotFoundError, RuleError, err, ok, type Result } from "../../shared/kernel";
import {
  DEFAULT_TIME_ZONE,
  aggregateContacts,
  allowedTransitions,
  columnStats,
  feedbackIdentity,
  leadTracking,
  planUndo,
  stageSummary,
  summarizeActivities,
  visibleWarnings,
  type ContactAggregateRow,
  type InstallTimeline,
  type LeadTracking,
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
import { currentEurRates, type Actor, type UseCaseDeps } from "./types";
import { canSee, territoriesOf } from "./visibility";

/** Sıcak lead ön süzgeci (SQL); kesin tanım `isHotLead` (açık aşama da ister). */
const hotTimelines: readonly InstallTimeline[] = ["m0_3"];

/**
 * Liste ve detaydaki lead: aktivite özeti (açık sayısı, sonraki, takipsiz), aşama özeti (aşamaya giriş anı, son
 * geçerli tutar) ve satış takip bilgisi (Faz 7g: temas özeti, teklif, uyarılar, sıcak, ürün toplamları) ile.
 */
export interface LeadListItem extends Lead, ActivitySummary, StageSummary, LeadTracking {}

function groupByLead<T extends { leadId: string }>(rows: readonly T[]): Map<string, T[]> {
  const by = new Map<string, T[]>();
  for (const r of rows) {
    const list = by.get(r.leadId);
    if (list) list.push(r);
    else by.set(r.leadId, [r]);
  }
  return by;
}

/**
 * Üç sorgu (açık aktiviteler, aşama olayları, temas toplamları) ve lead başına tek türetme yolu (`leadTracking`).
 * `isAdmin: false` verilirse uyarılar satışçıya göre süzülür (`visibleWarnings`); verilmezse hepsi kalır.
 */
export async function withSummaries(
  repos: Repositories,
  leads: readonly Lead[],
  opts: { isAdmin?: boolean | undefined; timeZone?: string | undefined } = {},
): Promise<LeadListItem[]> {
  const ids = leads.map((l) => l.id);
  const [open, events, aggregates] = await Promise.all([
    repos.activities.listOpenByLeads(ids),
    repos.stageEvents.listByLeads(ids),
    repos.activities.contactAggregatesByLeads(ids),
  ]);
  const actsByLead = groupByLead<Activity>(open);
  const eventsByLead = groupByLead<StageEvent>(events);
  const aggByLead = groupByLead<ContactAggregateRow>(aggregates);
  const tz = opts.timeZone ?? DEFAULT_TIME_ZONE;
  return leads.map((l) => {
    const evs = eventsByLead.get(l.id) ?? [];
    const t = leadTracking(l, evs, aggByLead.get(l.id) ?? [], tz);
    return {
      ...l,
      ...summarizeActivities(l.currentStage, actsByLead.get(l.id) ?? []),
      ...stageSummary(l, evs),
      ...t,
      warnings: opts.isAdmin === false ? visibleWarnings(t.warnings, false) : t.warnings,
    };
  });
}

/** Ortak lead süzgecinin temas değerleri (iş emri §4.2); `no_reply` = ulaşıldı ve dönüş yok. */
export const CONTACT_FILTERS = ["never", "legacy", "contacted", "no_reply", "replied"] as const;
export type ContactFilter = (typeof CONTACT_FILTERS)[number];
export const isContactFilter = (v: unknown): v is ContactFilter =>
  typeof v === "string" && (CONTACT_FILTERS as readonly string[]).includes(v);

/** Bellek içi süzgeçler: SQL'de olmayan, türetilen bilgiye bakanlar. */
export interface TrackingFilter {
  rotting?: boolean | undefined;
  contact?: ContactFilter | undefined;
  hot?: boolean | undefined;
  /** Kontrol edilmemiş "warn" uyarısı olanlar; yalnız yöneticide uygulanır. */
  warning?: boolean | undefined;
}

export function matchesTracking(item: LeadListItem, f: TrackingFilter, isAdmin: boolean): boolean {
  if (f.rotting && !item.rotting) return false;
  if (f.hot && !item.hot) return false;
  if (f.warning && isAdmin && !item.warnings.some((w) => w.severity === "warn" && !w.checked)) return false;
  switch (f.contact) {
    case undefined:
      return true;
    case "never":
    case "legacy":
    case "contacted":
      return item.contact.state === f.contact;
    case "no_reply":
      return item.contact.state === "contacted" && !item.contact.replied;
    case "replied":
      return item.contact.replied;
  }
}

/** Pano: filtrelenmiş lead'ler ve aynı kümeden hesaplanan kolon istatistikleri (kural 4). */
export interface Board {
  leads: LeadListItem[];
  columns: ColumnStats[];
}

/**
 * Ortak lead süzgeci (Faz 7g, iş emri §4.2): `/leads` ve `/board` aynı ayrıştırıcıyla (`parseLeadFilter`) gelir.
 * Sorumlu, ülke ve kaynak tek değer ya da liste alır; liste "bunlardan biri"dir.
 */
export interface LeadFilterInput extends TrackingFilter {
  /** Sorumlu kimliği; null = ortak havuz; undefined = hepsi. */
  owner?: string | null | readonly (string | null)[] | undefined;
  country?: string | readonly string[] | undefined;
  /** Lead kaynağı (Faz 7). */
  source?: LeadSource | readonly LeadSource[] | undefined;
  scope?: "excel" | undefined;
  campaign?: string | undefined;
  search?: string | undefined;
  includeTest?: boolean | undefined;
}

export interface BoardInput extends LeadFilterInput {
  actor: Actor;
}

export interface ContactLogRef {
  id: string;
  /** Kaydın tamamladığı ya da eklediği temas satırı. */
  activityId: string | null;
  createdAt: Date;
  undoUntil: Date;
  canUndo: boolean;
}

export interface LeadDetail {
  lead: LeadListItem;
  /** Geri alınabilir temas kayıtları (Faz 7g): satışçıya kendi kaydı pencere içinde, yöneticiye hepsi. */
  contactLogs: ContactLogRef[];
  /** Bağlı kuruluş (Faz 6d); yoksa null. */
  organization: Organization | null;
  events: StageEvent[];
  /** Açık ve bitmiş aktiviteler, vade sırasıyla. */
  activities: Activity[];
  /** Arayüz aşama kuralını tekrar yazmaz; izinli geçişleri buradan okur. */
  allowedTransitions: readonly StageCode[];
  /** `contactLogId`: son aşama değişikliği bir temas kaydıyla yapıldıysa o kayıt (Geri al ikisini birlikte alır). */
  undo: { available: boolean; reason?: string; untilIso?: string; contactLogId?: string | null };
}

export interface ListLeadsInput extends LeadFilterInput {
  actor: Actor;
  stage?: StageCode | readonly StageCode[] | undefined;
  organizationId?: string | undefined;
  personId?: string | undefined;
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
            // Benimsenen içe aktarım lead'i platforma reklam kaynağı ve kimliğiyle gider (feedbackIdentity).
            ...feedbackIdentity(lead),
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
        scope: input.scope,
        campaign: input.campaign,
        installTimeline: input.hot ? hotTimelines : undefined,
        limit: input.limit,
      });
      const items = await withSummaries(repos, leads, { isAdmin: input.actor.isAdmin, timeZone: this.deps.timeZone });
      return items.filter((l) => matchesTracking(l, input, input.actor.isAdmin));
    });
  }

  /** Kanban verisi: görünürlük + sorumlu · ülke · kaynak · takipsiz filtreleri; istatistikler filtrelenmiş kümeden. */
  async board(input: BoardInput): Promise<Board> {
    const rates = await currentEurRates(this.deps);
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
          search: input.search,
          includeTest: input.includeTest,
          scope: input.scope,
          campaign: input.campaign,
          installTimeline: input.hot ? hotTimelines : undefined,
        }),
        { isAdmin: input.actor.isAdmin, timeZone: this.deps.timeZone },
      );
      const filtered = leads.filter((l) => matchesTracking(l, input, input.actor.isAdmin));
      return { leads: filtered, columns: columnStats(filtered, this.deps.clock.now(), rates) };
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
      const logs = await repos.contactLogs.listByLead(lead.id);
      const contactLogs: ContactLogRef[] = logs
        .map((l) => {
          const undoUntil = new Date(l.createdAt.getTime() + this.deps.undoWindowMs);
          const canUndo = actor.isAdmin || (l.actorUserId === actor.userId && undoUntil.getTime() >= now.getTime());
          return {
            id: l.id,
            activityId: l.completedActivityId ?? activities.find((a) => a.logId === l.id)?.id ?? null,
            createdAt: l.createdAt,
            undoUntil,
            canUndo,
          };
        })
        .filter((l) => l.canUndo);
      const stageLog = last ? logs.find((l) => l.stageChangeId === last.changeId) : undefined;
      const tracking = leadTracking(
        lead,
        events,
        aggregateContacts(activities),
        this.deps.timeZone ?? DEFAULT_TIME_ZONE,
      );
      return ok({
        lead: {
          ...lead,
          ...summarizeActivities(lead.currentStage, activities),
          ...stageSummary(lead, events),
          ...tracking,
          warnings: actor.isAdmin ? tracking.warnings : visibleWarnings(tracking.warnings, false),
        },
        contactLogs,
        events,
        organization: organization ?? null,
        activities,
        allowedTransitions: allowedTransitions(lead.currentStage),
        undo: undo.ok
          ? {
              available: true,
              untilIso: new Date((last?.occurredAt.getTime() ?? 0) + this.deps.undoWindowMs).toISOString(),
              ...(stageLog ? { contactLogId: stageLog.id } : {}),
            }
          : { available: false, reason: undo.error.code },
      });
    });
  }
}
