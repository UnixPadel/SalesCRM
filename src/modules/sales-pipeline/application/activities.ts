import { NotFoundError, RuleError, err, ok, type Result } from "../../shared/kernel";
import {
  DEFAULT_TIME_ZONE,
  NO_CONTACT_FIELDS,
  bucketOf,
  isHotLead,
  summarizeContacts,
  validateActivity,
  type Activity,
  type ActivityBucket,
  type ActivityOutcome,
  type ActivityType,
  type Lead,
} from "../domain";
import { requireAdmin } from "./permissions";
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
      if (!input.done && activity.doneAt !== null) {
        // Faz 7g (§4.1): yeniden açma yalnız yönetici ve yalnız temas kaydı olmayan satırda.
        const admin = requireAdmin(input.actor, "activity_reopen");
        if (!admin.ok) return admin;
        if (activity.logId !== null) {
          return err(
            new RuleError("contact.reopen_logged", "Temas kaydını yeniden açmak yerine geri alın ya da silin.", {
              activityId: activity.id,
            }),
          );
        }
      }
      const now = clock.now();
      const doneAt = input.done ? now : null;
      await repos.activities.setDone(activity.id, doneAt, now);
      return ok(
        doneAt === null
          ? {
              ...activity,
              doneAt,
              outcome: null,
              customerReplied: false,
              resultNote: "",
              doneByUserId: null,
              dateEstimated: false,
              updatedAt: now,
            }
          : { ...activity, doneAt, updatedAt: now },
      );
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
      // Faz 7g (§4.1): tamamlanmış temas yalnız yöneticice silinir (geçmiş ve rapor ondan hesaplanır).
      if (activity.doneAt !== null) {
        const admin = requireAdmin(input.actor, "activity_done_delete");
        if (!admin.ok) return admin;
      }
      await repos.activities.remove(activity.id);
      return ok({ id: activity.id });
    });
  }
}

export interface ActivityWithLead {
  activity: Activity;
  lead: Lead;
  /** Lead'in son temasının sonucu ve kanalı (Faz 7g; satırdaki "Son: …"). */
  lastOutcome?: ActivityOutcome | null;
  lastType?: ActivityType | null;
}

export type TodayList = Record<ActivityBucket, ActivityWithLead[]>;
/** Faz 7g: hiç ulaşılmamış sıcak lead sayısı (Bugün şeridi). */
export type TodayResult = TodayList & { hotUncontacted: number };

export class ActivityQueries {
  constructor(private readonly deps: UseCaseDeps) {}

  /**
   * "Bugün" sayfası: görünür lead'lerin açık aktiviteleri gecikmiş / bugün / yaklaşan kümelerinde, vade sırasıyla.
   * Görünürlük lead listesinin kuralıdır (kendi + havuz; admin hepsi).
   */
  async today(actor: Actor): Promise<TodayResult> {
    return this.deps.uow.run(async (repos) => {
      const visibleTo = actor.isAdmin
        ? undefined
        : { userId: actor.userId, countries: territoriesOf(actor.userId, await repos.territories.all()) };
      const leads = await repos.leads.list({ visibleTo, includeTest: true });
      const byId = new Map(leads.map((l) => [l.id, l]));
      const open = await repos.activities.listOpenByLeads([...byId.keys()]);
      const now = this.deps.clock.now();
      const tz = this.deps.timeZone ?? DEFAULT_TIME_ZONE;
      // Faz 7g: şerit sayısı = `/leads?hot=1&contact=never` uzunluğu (aynı tanım, `isHotUncontacted`) [K-I8].
      const hotCandidates = leads.filter((l) => !l.isTest && isHotLead(l));
      const ids = [...new Set([...open.map((a) => a.leadId), ...hotCandidates.map((l) => l.id)])];
      const aggregates = await repos.activities.contactAggregatesByLeads(ids);
      const summaryOf = (lead: Lead) =>
        summarizeContacts(
          aggregates.filter((r) => r.leadId === lead.id),
          lead.contactHistoryUnknown,
        );
      const out: TodayResult = { overdue: [], today: [], upcoming: [], hotUncontacted: 0 };
      for (const lead of hotCandidates) if (summaryOf(lead).state === "never") out.hotUncontacted++;
      const lastOf = new Map<string, { lastOutcome: ActivityOutcome | null; lastType: ActivityType | null }>();
      for (const activity of open) {
        const lead = byId.get(activity.leadId);
        if (!lead) continue;
        let last = lastOf.get(lead.id);
        if (!last) {
          const s = summaryOf(lead);
          last = { lastOutcome: s.lastOutcome, lastType: s.lastType };
          lastOf.set(lead.id, last);
        }
        out[bucketOf(activity.dueAt, now, tz)].push({ activity, lead, ...last });
      }
      return out;
    });
  }
}
