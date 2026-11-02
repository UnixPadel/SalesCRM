import { buildReport, type Report } from "../domain";
import type { Actor, UseCaseDeps } from "./types";
import { territoriesOf } from "./visibility";

export interface ReportInputDto {
  actor: Actor;
  /** 1–36; verilmezse 12. */
  months?: number | undefined;
}

/**
 * Raporlar (Faz 6c): görünür lead'ler ve aşama olaylarından saf `buildReport` ile. Test lead'leri dışarıda.
 * Görünürlük pano ile aynı: satışçı kendi + havuz, admin hepsi.
 */
export class ReportQueries {
  constructor(private readonly deps: UseCaseDeps) {}

  async summary(input: ReportInputDto): Promise<Report> {
    const months = Math.min(36, Math.max(1, Math.floor(input.months ?? 12)));
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
        rates: this.deps.eurRates,
      });
    });
  }
}
