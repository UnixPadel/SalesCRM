import { NotFoundError, RuleError, err, ok, type Result } from "../../shared/kernel";
import {
  DEFAULT_TIME_ZONE,
  NO_CONTACT_FIELDS,
  bucketOf,
  isHotLead,
  contactRecordMissing,
  summarizeContacts,
  validateActivity,
  validateContact,
  type Activity,
  type ActivityBucket,
  type ActivityPatch,
  type ActivityOutcome,
  type ActivityType,
  type Lead,
} from "../domain";
import { requireAdmin } from "./permissions";
import type { Actor, UseCaseDeps } from "./types";
import { loadActionableLead as visibleLead } from "./visibility";

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
      await this.deps.actions?.record({
        actor: input.actor,
        action: "activity.planned",
        lead: { id: outcome.value.leadId },
        details: { type: outcome.value.type },
      });
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
    let changed = false;
    const out = await uow.run(async (repos): Promise<Result<Activity, RuleError>> => {
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
      changed = input.done !== (activity.doneAt !== null);
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
    if (out.ok && changed) {
      await this.deps.actions?.record({
        actor: input.actor,
        action: input.done ? "activity.done" : "activity.reopened",
        lead: { id: out.value.leadId },
        details: { type: out.value.type },
      });
    }
    return out;
  }
}

export interface UpdateActivityInput {
  activityId: string;
  actor: Actor;
  /** Açık iş ve temas. */
  type?: unknown;
  /** Yalnız açık iş. */
  subject?: string | null | undefined;
  dueAt?: Date | null | undefined;
  notes?: string | null | undefined;
  /** Yalnız tamamlanmış temas. */
  outcome?: unknown;
  customerReplied?: boolean | undefined;
  resultNote?: string | null | undefined;
  doneAt?: Date | null | undefined;
}

const PLAN_FIELDS = ["subject", "dueAt", "notes"] as const;
const CONTACT_FIELDS = ["outcome", "customerReplied", "resultNote", "doneAt"] as const;
const sameTime = (a: Date | null, b: Date | null) => (a?.getTime() ?? null) === (b?.getTime() ?? null);

/**
 * Düzenleme (2026-11-25). Açık iş (tür, konu, vade, not): lead'inde iş açabilen herkes (kendi + havuz; yönetici
 * hepsi). Tamamlanmış temas (kanal, sonuç, "müşteri cevap verdi", görüşme notu, tarih): yalnız yönetici; temas
 * kuralları kayıttakiyle aynıdır (`validateContact`). Aşama, sonraki takip ve müşteri durumu değişmez: düzenleme
 * yalnız satırın kendisidir. Tarih değişince "≈" (tahmini) işareti kalkar.
 */
export class UpdateActivity {
  constructor(private readonly deps: UseCaseDeps) {}

  async execute(input: UpdateActivityInput): Promise<Result<Activity, RuleError>> {
    const { uow, clock } = this.deps;
    const tz = this.deps.timeZone ?? DEFAULT_TIME_ZONE;
    let changedFields: string[] = [];
    const out = await uow.run(async (repos): Promise<Result<Activity, RuleError>> => {
      const a = await repos.activities.findById(input.activityId);
      if (!a) return err(new NotFoundError("Activity", input.activityId));
      const lead = await visibleLead(repos, a.leadId, input.actor);
      if (!lead.ok) return lead;
      const now = clock.now();
      const done = a.doneAt !== null;
      const foreign = (done ? PLAN_FIELDS : CONTACT_FIELDS).filter((k) => input[k] !== undefined);
      if (foreign.length) {
        return err(
          new RuleError("activity.field_not_editable", "Bu alan bu satırda düzenlenemez.", {
            fields: foreign,
            done,
          }),
        );
      }

      const patch: ActivityPatch = {};
      if (!done) {
        const draft = validateActivity({
          type: input.type ?? a.type,
          subject: input.subject ?? a.subject,
          dueAt: input.dueAt === undefined ? a.dueAt : input.dueAt,
          notes: input.notes ?? a.notes,
        });
        if (!draft.ok) return draft;
        const d = draft.value;
        if (d.type !== a.type) patch.type = d.type;
        if (d.subject !== a.subject) patch.subject = d.subject;
        if (!sameTime(d.dueAt, a.dueAt)) patch.dueAt = d.dueAt;
        if (d.notes !== a.notes) patch.notes = d.notes;
      } else {
        const admin = requireAdmin(input.actor, "contact_edit");
        if (!admin.ok) return admin;
        if (input.doneAt === null) {
          return err(new RuleError("contact.occurred_invalid", "Temas zamanı geçersiz.", {}));
        }
        const newAt = input.doneAt === undefined || sameTime(input.doneAt, a.doneAt) ? null : input.doneAt;
        const contact = validateContact({
          type: input.type ?? a.type,
          outcome: input.outcome ?? a.outcome,
          customerReplied: input.customerReplied ?? a.customerReplied,
          // Tarih değişmiyorsa doğrulanmaz: eski (ör. 2024 öncesi aktarılmış) temas da düzenlenebilsin.
          occurredAt: newAt ?? now,
          now,
          note: input.resultNote ?? a.resultNote,
          completingType: a.type,
          timeZone: tz,
        });
        if (!contact.ok) return contact;
        const c = contact.value;
        if (c.type !== a.type) patch.type = c.type;
        if (c.outcome !== a.outcome) patch.outcome = c.outcome;
        if (c.customerReplied !== a.customerReplied) patch.customerReplied = c.customerReplied;
        if (c.note !== a.resultNote) patch.resultNote = c.note;
        if (newAt) {
          patch.doneAt = newAt;
          if (a.dateEstimated) patch.dateEstimated = false;
        }
      }
      changedFields = Object.keys(patch).filter((k) => k !== "dateEstimated");
      if (!changedFields.length) return ok(a);
      await repos.activities.update(a.id, patch, now);
      return ok({ ...a, ...patch, updatedAt: now });
    });
    if (out.ok && changedFields.length) {
      const done = out.value.doneAt !== null;
      await this.deps.actions?.record({
        actor: input.actor,
        action: done ? "contact.updated" : "activity.updated",
        lead: { id: out.value.leadId },
        details: {
          type: out.value.type,
          ...(done ? { outcome: out.value.outcome } : {}),
          fields: changedFields,
        },
      });
      this.deps.logger.info(done ? "temas düzenlendi" : "aktivite düzenlendi", {
        activityId: out.value.id,
        leadId: out.value.leadId,
        fields: changedFields,
        actorUserId: input.actor.userId,
      });
    }
    return out;
  }
}

export interface DeleteActivityInput {
  activityId: string;
  actor: Actor;
}

export class DeleteActivity {
  constructor(private readonly deps: UseCaseDeps) {}

  async execute(input: DeleteActivityInput): Promise<Result<{ id: string }, RuleError>> {
    let removed: Activity | null = null;
    const out = await this.deps.uow.run(async (repos): Promise<Result<{ id: string }, RuleError>> => {
      const activity = await repos.activities.findById(input.activityId);
      if (!activity) return err(new NotFoundError("Activity", input.activityId));
      const lead = await visibleLead(repos, activity.leadId, input.actor);
      if (!lead.ok) return lead;
      // Faz 7g (§4.1): tamamlanmış temas yalnız yöneticice silinir (geçmiş ve rapor ondan hesaplanır).
      if (activity.doneAt !== null) {
        const admin = requireAdmin(input.actor, "activity_done_delete");
        if (!admin.ok) return admin;
        // 2026-11-25: temas kaydına bağlı satır tek başına silinmez (kayıt, sonraki takip ve durum değişikliği yarım
        // kalırdı); `DeleteContactLog` hepsini birlikte geri çevirir.
        if (activity.logId !== null) {
          return err(
            new RuleError("contact.delete_logged", "Bu temas kaydı neden yazılarak silinir.", {
              activityId: activity.id,
              logId: activity.logId,
            }),
          );
        }
      }
      await repos.activities.remove(activity.id);
      removed = activity;
      return ok({ id: activity.id });
    });
    const gone = removed as Activity | null;
    if (out.ok && gone) {
      await this.deps.actions?.record({
        actor: input.actor,
        action: "activity.deleted",
        lead: { id: gone.leadId },
        details: { type: gone.type },
      });
    }
    return out;
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
      const visibleTo = actor.isAdmin ? undefined : { userId: actor.userId };
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
          contactRecordMissing(lead),
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
