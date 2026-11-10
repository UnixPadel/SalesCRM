import { NotFoundError, RuleError, err, ok, type Result } from "../../shared/kernel";
import {
  NO_CONTACT_FIELDS,
  bucketOf,
  validateActivity,
  type Activity,
  type ActivityBucket,
  type Lead,
} from "../domain";
import type { Actor, UseCaseDeps } from "./types";
import { loadActionableLead as visibleLead, territoriesOf } from "./visibility";

/**
 * Aktiviteler (Faz 6a). Aşamayı değiştirmezler; yalnız lead'in yapılacaklarını tutarlar. Yetki lead'inkiyle
 * aynı: satışçı kendi ve havuzdaki lead'in aktivitesini açar/kapatır, admin hepsini.
 */

export interface AddActivityInput {
  leadId: string;
  type: unknown;
  subject?: string | null;
  dueAt: Date | null;
  notes?: string | null;
  actor: Actor;
}

export class AddActivity {
  constructor(private readonly deps: UseCaseDeps) {}

  async execute(input: AddActivityInput): Promise<Result<Activity, RuleError>> {
    const draft = validateActivity(input);
    if (!draft.ok) return draft;
    const { uow, clock, ids } = this.deps;
    const outcome = await uow.run(async (repos): Promise<Result<Activity, RuleError>> => {
      const lead = await visibleLead(repos, input.leadId, input.actor);
      if (!lead.ok) return lead;
      const now = clock.now();
      const activity: Activity = {
        id: ids.next(),
        leadId: lead.value.id,
        ...draft.value,
        doneAt: null,
        autoCreated: false,
        createdByChangeId: null,
        createdByUserId: input.actor.userId,
        legacyId: null,
        ...NO_CONTACT_FIELDS,
        createdAt: now,
        updatedAt: now,
      };
      await repos.activities.insert(activity);
      return ok(activity);
    });
    if (outcome.ok) {
      this.deps.logger.info("aktivite eklendi", {
        activityId: outcome.value.id,
        leadId: outcome.value.leadId,
        type: outcome.value.type,
        actorUserId: input.actor.userId,
      });
    }
    return outcome;
  }
}

export interface SetActivityDoneInput {
  activityId: string;
  done: boolean;
  actor: Actor;
}

/** Tamamla / yeniden aç. Tamamlanan aktivite silinmez; zaman çizelgesinde kalır. */
export class SetActivityDone {
  constructor(private readonly deps: UseCaseDeps) {}

  async execute(input: SetActivityDoneInput): Promise<Result<Activity, RuleError>> {
    const { uow, clock } = this.deps;
    return uow.run(async (repos): Promise<Result<Activity, RuleError>> => {
      const activity = await repos.activities.findById(input.activityId);
      if (!activity) return err(new NotFoundError("Activity", input.activityId));
      const lead = await visibleLead(repos, activity.leadId, input.actor);
      if (!lead.ok) return lead;
      const now = clock.now();
      const doneAt = input.done ? now : null;
      await repos.activities.setDone(activity.id, doneAt, now);
      return ok({ ...activity, doneAt, updatedAt: now });
    });
  }
}

export interface DeleteActivityInput {
  activityId: string;
  actor: Actor;
}

export class DeleteActivity {
  constructor(private readonly deps: UseCaseDeps) {}

  async execute(input: DeleteActivityInput): Promise<Result<{ id: string }, RuleError>> {
    return this.deps.uow.run(async (repos): Promise<Result<{ id: string }, RuleError>> => {
      const activity = await repos.activities.findById(input.activityId);
      if (!activity) return err(new NotFoundError("Activity", input.activityId));
      const lead = await visibleLead(repos, activity.leadId, input.actor);
      if (!lead.ok) return lead;
      await repos.activities.remove(activity.id);
      return ok({ id: activity.id });
    });
  }
}

export interface ActivityWithLead {
  activity: Activity;
  lead: Lead;
}

export type TodayList = Record<ActivityBucket, ActivityWithLead[]>;

export class ActivityQueries {
  constructor(private readonly deps: UseCaseDeps) {}

  /**
   * "Bugün" sayfası: görünür lead'lerin açık aktiviteleri gecikmiş / bugün / yaklaşan kümelerinde, vade sırasıyla.
   * Görünürlük lead listesinin kuralıdır (kendi + havuz; admin hepsi).
   */
  async today(actor: Actor): Promise<TodayList> {
    return this.deps.uow.run(async (repos) => {
      const visibleTo = actor.isAdmin
        ? undefined
        : { userId: actor.userId, countries: territoriesOf(actor.userId, await repos.territories.all()) };
      const leads = await repos.leads.list({ visibleTo, includeTest: true });
      const byId = new Map(leads.map((l) => [l.id, l]));
      const open = await repos.activities.listOpenByLeads([...byId.keys()]);
      const now = this.deps.clock.now();
      const out: TodayList = { overdue: [], today: [], upcoming: [] };
      for (const activity of open) {
        const lead = byId.get(activity.leadId);
        if (!lead) continue;
        out[bucketOf(activity.dueAt, now, this.deps.timeZone)].push({ activity, lead });
      }
      return out;
    });
  }
}
