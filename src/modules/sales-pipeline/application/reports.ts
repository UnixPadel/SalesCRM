import type { RuleError, Result } from "../../shared/kernel";
import { ok } from "../../shared/kernel";
import {
  DEFAULT_TIME_ZONE,
  buildReport,
  buildTrackingReport,
  isLeadSource,
  leadTracking,
  type ContactAggregateRow,
  type Lead,
  type Report,
  type StageEvent,
  type TrackingReport,
} from "../domain";
import { parseDayRange } from "./contactQueries";
import { currentEurRates, type Actor, type UseCaseDeps } from "./types";
import { territoriesOf } from "./visibility";

export interface ReportInputDto {
  actor: Actor;
  /** 1–36; verilmezse 12. */
  months?: number | undefined;
}

export interface TrackingReportInput {
  actor: Actor;
  /** YYYY-MM-DD, lead oluşturma günü (İstanbul), dahil. */
  from?: string | undefined;
  to?: string | undefined;
  source?: string | undefined;
  campaign?: string | undefined;
  /** Kullanıcı kimliği ya da "pool". */
  owner?: string | undefined;
  scope?: "excel" | undefined;
}

export interface TrackingReportResult extends TrackingReport {
  scope: {
    from: string | null;
    to: string | null;
    source: string | null;
    campaign: string | null;
    owner: string | null;
    scope: "excel" | null;
    /** Satışçı: yalnız kendi ve görebildiği havuz. */
    repScoped: boolean;
    counts: { all: number; excel: number };
  };
  /** Görünür lead'lerdeki farklı kampanya adları (süzgeç seçenekleri). */
  campaigns: string[];
}

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
 * Raporlar (Faz 6c): görünür lead'ler ve aşama olaylarından saf `buildReport` ile. Test lead'leri dışarıda.
 * Görünürlük pano ile aynı: satışçı kendi + havuz, admin hepsi. Faz 7g: Excel ÖZET RAPOR (`tracking`).
 */
export class ReportQueries {
  constructor(private readonly deps: UseCaseDeps) {}

  async summary(input: ReportInputDto): Promise<Report> {
    const months = Math.min(36, Math.max(1, Math.floor(input.months ?? 12)));
    const rates = await currentEurRates(this.deps);
    return this.deps.uow.run(async (repos) => {
      const visibleTo = input.actor.isAdmin
        ? undefined
        : { userId: input.actor.userId, countries: territoriesOf(input.actor.userId, await repos.territories.all()) };
      const leads = await repos.leads.list({ visibleTo, includeTest: false });
      const events = await repos.stageEvents.listByLeads(leads.map((l) => l.id));
      return buildReport({
        leads,
        events,
        now: this.deps.clock.now(),
        months,
        timeZone: this.deps.timeZone,
        rates,
      });
    });
  }

  /**
   * Özet rapor (Faz 7g, D8): Excel ÖZET RAPOR'un beş bölümü. Tek işlemde lead'ler, olaylar ve temas toplamları;
   * sonra saf `buildTrackingReport`. Satır listesi ekip dizininden (aktif satış kullanıcıları); dizin yoksa yalnız
   * lead'i olan sahipler. Tarih süzgeci lead oluşturma gününe (İstanbul) bakar.
   */
  async tracking(input: TrackingReportInput): Promise<Result<TrackingReportResult, RuleError>> {
    const tz = this.deps.timeZone ?? DEFAULT_TIME_ZONE;
    const range = parseDayRange(input.from, input.to, tz, "report.range");
    if (!range.ok) return range;
    const teamIds = input.actor.isAdmin ? ((await this.deps.team?.activeSalesUserIds()) ?? null) : null;
    const now = this.deps.clock.now();
    return this.deps.uow.run(async (repos) => {
      const visibleTo = input.actor.isAdmin
        ? undefined
        : { userId: input.actor.userId, countries: territoriesOf(input.actor.userId, await repos.territories.all()) };
      const visible = await repos.leads.list({ visibleTo, includeTest: false });
      const owner =
        input.owner === undefined || input.owner === "" ? undefined : input.owner === "pool" ? null : input.owner;
      const source = isLeadSource(input.source) ? input.source : undefined;
      const inScope = (l: Lead) =>
        (!range.value.from || l.createdAt >= range.value.from) &&
        (!range.value.to || l.createdAt < range.value.to) &&
        (!source || l.source === source) &&
        (!input.campaign || l.campaign.campaignName === input.campaign) &&
        (owner === undefined || l.assignedUserId === owner);
      const isExcel = (l: Lead) => "excel_no" in l.extraAnswers;
      const filtered = visible.filter((l) => inScope(l) && (input.scope !== "excel" || isExcel(l)));
      const ids = filtered.map((l) => l.id);
      const [events, aggregates] = await Promise.all([
        repos.stageEvents.listByLeads(ids),
        repos.activities.contactAggregatesByLeads(ids),
      ]);
      const evByLead = groupByLead<StageEvent>(events);
      const aggByLead = groupByLead<ContactAggregateRow>(aggregates);
      const items = filtered.map((lead) => ({
        lead,
        t: leadTracking(lead, evByLead.get(lead.id) ?? [], aggByLead.get(lead.id) ?? [], tz),
      }));
      // Sahip süzgeci verilmişse diğer ekip satırları gösterilmez.
      const rows = owner === undefined ? teamIds : null;
      const report = buildTrackingReport({ items, teamIds: rows, now, timeZone: tz });
      const scoped = visible.filter(inScope);
      return ok({
        ...report,
        scope: {
          from: input.from ?? null,
          to: input.to ?? null,
          source: source ?? null,
          campaign: input.campaign ?? null,
          owner: input.owner || null,
          scope: input.scope ?? null,
          repScoped: !input.actor.isAdmin,
          counts: { all: scoped.length, excel: scoped.filter(isExcel).length },
        },
        campaigns: [...new Set(visible.map((l) => l.campaign.campaignName).filter((c): c is string => !!c))].sort(
          (a, b) => a.localeCompare(b, "tr"),
        ),
      });
    });
  }
}
