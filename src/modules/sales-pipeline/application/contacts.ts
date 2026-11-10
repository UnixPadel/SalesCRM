import { NotFoundError, RuleError, err, ok, type Result } from "../../shared/kernel";
import {
  ACTIVITY_OUTCOMES,
  CONTACT_CHANNELS,
  CONTACT_RULES,
  DEFAULT_SUBJECTS,
  DEFAULT_TIME_ZONE,
  NO_CONTACT_FIELDS,
  NO_NEXT_TARGETS,
  aggregateContacts,
  isCustomerStatus,
  isOpenActivity,
  isTerminal,
  pickCompletable,
  stageLine,
  suggestNext,
  summarizeContacts,
  validateActivity,
  validateContact,
  type Activity,
  type ActivityOutcome,
  type ActivityType,
  type ContactLog,
  type CustomerStatus,
  type DomainEvent,
  type Lead,
  type StageCode,
  type StageLineMode,
} from "../domain";
import { ADMIN_ONLY } from "./permissions";
import type { Actor, UseCaseDeps } from "./types";
import type { ChangeLeadStage } from "./changeLeadStage";
import type { UndoStageChange } from "./undoStageChange";
import { loadActionableLead } from "./visibility";

/**
 * "Temas kaydet" (Faz 7g, iş emri §4.1): Excel'de 3–4 yere elle yazılan olgu (✔, Evet + tarih, TEMAS GEÇMİŞİ satırı,
 * sonraki takip) tek kayıttır. Aşama yalnız `ChangeLeadStage` ile değişir; temas yazımı hata verirse aşama telafi
 * edilir (tek istekte ya ikisi birden kalır ya hiçbiri). Log'a yalnız kimlikler yazılır.
 */

export interface LogContactInput {
  leadId: string;
  actor: Actor;
  /** Tamamlanacak plan (bu lead'in açık aktivitesi); yoksa yeni tamamlanmış satır açılır. */
  activityId?: string | null | undefined;
  type: unknown;
  outcome: unknown;
  customerReplied?: boolean | undefined;
  /** Verilmezse şimdi. */
  occurredAt?: Date | null | undefined;
  note?: string | null | undefined;
  next?: { type: unknown; dueAt: Date | null; subject?: string | null; notes?: string | null } | null | undefined;
  /** Çubuktaki "Evet, kaydet" / "Açmadı, kaydet": plan ve takip sunucu varsayılanıyla; durum ve aşama yok sayılır. */
  quick?: boolean | undefined;
  /** undefined = dokunma; null = "Durum girilmedi". */
  customerStatus?: unknown;
  stage?:
    | { target: StageCode; value?: { amount: number; currency: string } | null; lostReasonCode?: string | null }
    | null
    | undefined;
}

export interface LogContactResult {
  logId: string;
  activity: Activity;
  next: Activity | null;
  stage: { changeId: string } | null;
  assignedTo: string | null;
  undoUntil: Date;
  lead: Lead;
}

export interface ContactFormDefaults {
  next: { type: ActivityType; dueAt: Date; subject: string } | null;
  stage: { target: StageCode; mode: StageLineMode } | null;
}

/** Diyaloğun ihtiyaç duyduğu her şey: arayüz kural yazmaz, varsayılanları buradan okur [M-B1]. */
export interface ContactForm {
  lead: Lead;
  openActivities: Activity[];
  completableId: string | null;
  channels: ActivityType[];
  defaultType: ActivityType;
  defaults: Partial<Record<ActivityType, Record<ActivityOutcome, ContactFormDefaults>>>;
  canSetStatus: boolean;
  assignsOnSave: boolean;
  now: Date;
  timeZone: string;
}

const NEXT_PAST_TOLERANCE_MS = CONTACT_RULES.futureToleranceMinutes * 60_000;

/** Lead için izinli aşama hedefleri: sonuçtan önerilen satır, ayrıca durum "İlgisiz" ise Kaybedildi. */
function allowedTargets(outcome: ActivityOutcome, current: StageCode, status: CustomerStatus | null): StageCode[] {
  const line = stageLine({ outcome, current });
  const out: StageCode[] = line ? [line.target] : [];
  if (
    status !== null &&
    (CONTACT_RULES.statusSuggestsLost as readonly string[]).includes(status) &&
    !isTerminal(current) &&
    !out.includes("LOST")
  ) {
    out.push("LOST");
  }
  return out;
}

const badStatus = (v: unknown) =>
  new RuleError("lead.customer_status", "Müşteri durumu listede yok.", { customerStatus: v });

export class LogContact {
  constructor(
    private readonly deps: UseCaseDeps,
    private readonly stages: { change: ChangeLeadStage; undo: UndoStageChange },
  ) {}

  async execute(input: LogContactInput): Promise<Result<LogContactResult, RuleError>> {
    const { uow, clock, ids, undoWindowMs } = this.deps;
    const tz = this.deps.timeZone ?? DEFAULT_TIME_ZONE;
    const now = clock.now();

    // 1–3. Okuma ve doğrulama: hiçbir şey yazılmadan.
    const checked = await uow.run(async (repos) => {
      const lead = await loadActionableLead(repos, input.leadId, input.actor);
      if (!lead.ok) return lead;
      const open = (await repos.activities.listByLead(lead.value.id)).filter(isOpenActivity);
      return ok({ lead: lead.value, open });
    });
    if (!checked.ok) return checked;
    const { lead, open } = checked.value;

    const quick = input.quick === true;
    let activityId = input.activityId ?? null;
    if (quick && activityId === null && typeof input.type === "string") {
      activityId = pickCompletable(open, input.type as ActivityType, now, tz)?.id ?? null;
    }
    const completing = activityId === null ? null : (open.find((a) => a.id === activityId) ?? null);
    if (activityId !== null && !completing) {
      return err(
        new RuleError("contact.activity_not_open", "Tamamlanacak iş bu lead'in açık işi değil.", { activityId }),
      );
    }

    const contact = validateContact({
      type: input.type,
      outcome: input.outcome,
      customerReplied: input.customerReplied === true,
      occurredAt: input.occurredAt ?? now,
      now,
      note: input.note ?? "",
      completingType: completing?.type ?? null,
      timeZone: tz,
    });
    if (!contact.ok) return contact;
    const c = contact.value;

    let statusAfter = lead.customerStatus;
    if (!quick && input.customerStatus !== undefined) {
      if (input.customerStatus !== null && !isCustomerStatus(input.customerStatus)) {
        return err(badStatus(input.customerStatus));
      }
      statusAfter = input.customerStatus;
    }

    const stage = quick ? null : (input.stage ?? null);
    const line = stageLine({ outcome: c.outcome, current: lead.currentStage });
    if (stage) {
      if (!allowedTargets(c.outcome, lead.currentStage, statusAfter).includes(stage.target)) {
        return err(
          new RuleError("contact.stage_not_allowed", "Bu sonuçla bu aşamaya geçilemez.", {
            target: stage.target,
            outcome: c.outcome,
          }),
        );
      }
    } else if (line?.mode === "fixed") {
      return err(
        new RuleError("contact.proposal_stage_required", "Teklif gönderildiyse aşama 'Teklif' olmalı.", {
          target: line.target,
        }),
      );
    }

    let nextDraft: { type: ActivityType; dueAt: Date; subject: string; notes: string } | null = null;
    if (quick) {
      const s = suggestNext({
        outcome: c.outcome,
        type: c.type,
        now,
        current: lead.currentStage,
        stageTarget: null,
        timeZone: tz,
      });
      nextDraft = s ? { ...s, notes: "" } : null;
    } else if (input.next) {
      if (stage && NO_NEXT_TARGETS.includes(stage.target)) {
        return err(
          new RuleError("contact.next_with_stage", "Bu aşamada sonraki takip ayrıca planlanmaz.", {
            target: stage.target,
          }),
        );
      }
      const d = validateActivity(input.next);
      if (!d.ok) return d;
      if (d.value.dueAt.getTime() < now.getTime() - NEXT_PAST_TOLERANCE_MS) {
        return err(new RuleError("contact.next_past", "Sonraki takip geçmiş bir zamana planlanamaz.", {}));
      }
      nextDraft = d.value;
    }

    // 4. Aşama: kendi işlemiyle, mevcut bütün kurallar ve platform olaylarıyla.
    let changeId: string | null = null;
    if (stage) {
      const changed = await this.stages.change.execute({
        leadId: lead.id,
        target: stage.target,
        actor: input.actor,
        value: stage.value ?? null,
        lostReasonCode: stage.lostReasonCode ?? null,
      });
      if (!changed.ok) return changed;
      changeId = changed.value.changeId;
    }

    // 5. Temas, plan, takip, durum ve atama tek işlemde.
    const compensate = async () => {
      if (changeId === null) return;
      const undone = await this.stages.undo.execute({ leadId: lead.id, actor: input.actor, changeId });
      if (!undone.ok) {
        this.deps.logger.warn("temas telafisi: aşama geri alınamadı", { leadId: lead.id, code: undone.error.code });
      }
    };
    let written: Result<LogContactResult & { domainEvents: DomainEvent[] }, RuleError>;
    try {
      written = await uow.run(async (repos) => {
        const fresh = await repos.leads.findById(lead.id);
        if (!fresh) return err(new NotFoundError("Lead", lead.id));
        let planned: Activity | null = null;
        if (completing) {
          const a = await repos.activities.findById(completing.id);
          if (!a || a.doneAt !== null) {
            return err(
              new RuleError("contact.activity_not_open", "Tamamlanacak iş bu lead'in açık işi değil.", {
                activityId: completing.id,
              }),
            );
          }
          planned = a;
        }
        const assigns = fresh.assignedUserId === null && !input.actor.isAdmin;
        const logId = ids.next();
        const log: ContactLog = {
          id: logId,
          leadId: lead.id,
          actorUserId: input.actor.userId,
          createdAt: now,
          completedActivityId: planned?.id ?? null,
          prevType: planned?.type ?? null,
          prevSubject: planned?.subject ?? null,
          statusChanged: statusAfter !== fresh.customerStatus,
          statusBefore: fresh.customerStatus,
          statusAfter,
          stageChangeId: changeId,
          assignedOnLog: assigns,
        };
        await repos.contactLogs.insert(log);

        let activity: Activity;
        if (planned) {
          const completion = {
            doneAt: c.occurredAt,
            type: c.type,
            outcome: c.outcome,
            customerReplied: c.customerReplied,
            resultNote: c.note,
            doneByUserId: input.actor.userId,
            logId,
            dateEstimated: false,
          };
          await repos.activities.complete(planned.id, completion, now);
          activity = { ...planned, ...completion, updatedAt: now };
        } else {
          activity = {
            id: ids.next(),
            leadId: lead.id,
            type: c.type,
            subject: DEFAULT_SUBJECTS[c.type],
            dueAt: c.occurredAt,
            doneAt: c.occurredAt,
            notes: "",
            autoCreated: false,
            createdByChangeId: null,
            createdByUserId: input.actor.userId,
            legacyId: null,
            ...NO_CONTACT_FIELDS,
            outcome: c.outcome,
            customerReplied: c.customerReplied,
            resultNote: c.note,
            doneByUserId: input.actor.userId,
            logId,
            createdAt: now,
            updatedAt: now,
          };
          await repos.activities.insert(activity);
        }

        let next: Activity | null = null;
        if (nextDraft) {
          next = {
            id: ids.next(),
            leadId: lead.id,
            ...nextDraft,
            doneAt: null,
            autoCreated: false,
            createdByChangeId: null,
            createdByUserId: input.actor.userId,
            legacyId: null,
            ...NO_CONTACT_FIELDS,
            nextOfLogId: logId,
            createdAt: now,
            updatedAt: now,
          };
          await repos.activities.insert(next);
        }

        if (log.statusChanged) await repos.leads.setCustomerStatus(lead.id, statusAfter, now);
        const domainEvents: DomainEvent[] = [];
        let assignedTo = fresh.assignedUserId;
        if (assigns) {
          assignedTo = input.actor.userId;
          await repos.leads.updateAssignee(lead.id, assignedTo, now);
          domainEvents.push({
            type: "LeadAssigned",
            leadId: lead.id,
            from: null,
            to: assignedTo,
            actorUserId: input.actor.userId,
            occurredAt: now,
          });
        }
        return ok({
          logId,
          activity,
          next,
          stage: changeId === null ? null : { changeId },
          assignedTo,
          undoUntil: new Date(now.getTime() + undoWindowMs),
          lead: { ...fresh, customerStatus: statusAfter, assignedUserId: assignedTo, updatedAt: now },
          domainEvents,
        });
      });
    } catch (e) {
      await compensate();
      throw e;
    }
    if (!written.ok) {
      await compensate();
      return written;
    }
    const { domainEvents, ...result } = written.value;
    if (domainEvents.length) await this.deps.events.publish(domainEvents);
    this.deps.logger.info("temas kaydedildi", {
      leadId: lead.id,
      logId: result.logId,
      activityId: result.activity.id,
      type: result.activity.type,
      outcome: result.activity.outcome,
      stageChangeId: changeId,
      actorUserId: input.actor.userId,
    });
    return ok(result);
  }
}

export interface UndoLogContactInput {
  logId: string;
  actor: Actor;
}

/**
 * Temas kaydını geri al: satışçı kendi kaydını 10 dakika içinde, yönetici her zaman. Aşama yalnız hâlâ son değişiklikse
 * ve süresi dolmamışsa geri döner (`stageUndone`); temas her durumda geri alınır. Atama geri alınmaz.
 */
export class UndoLogContact {
  constructor(
    private readonly deps: UseCaseDeps,
    private readonly undoStage: UndoStageChange,
  ) {}

  async execute(input: UndoLogContactInput): Promise<Result<{ undone: true; stageUndone: boolean }, RuleError>> {
    const { uow, clock, undoWindowMs } = this.deps;
    const now = clock.now();
    const found = await uow.run(async (repos) => {
      const log = await repos.contactLogs.findById(input.logId);
      if (!log) return err(new NotFoundError("ContactLog", input.logId));
      return ok(log);
    });
    if (!found.ok) return found;
    const log = found.value;
    if (!input.actor.isAdmin) {
      if (log.actorUserId !== input.actor.userId) {
        return err(new RuleError(ADMIN_ONLY, "Başkasının temas kaydını yalnız yönetici geri alabilir.", {}));
      }
      if (log.createdAt.getTime() + undoWindowMs < now.getTime()) {
        return err(
          new RuleError("contact.undo_expired", "Geri alma süresi doldu.", {
            windowMinutes: Math.round(undoWindowMs / 60_000),
          }),
        );
      }
    }

    let stageUndone = false;
    if (log.stageChangeId) {
      const undone = await this.undoStage.execute({
        leadId: log.leadId,
        actor: input.actor,
        changeId: log.stageChangeId,
      });
      stageUndone = undone.ok;
    }

    await uow.run(async (repos) => {
      await repos.activities.removeCreatedByLog(log.id, log.completedActivityId);
      await repos.activities.removeOpenNextOfLog(log.id);
      if (log.completedActivityId) {
        const planned = await repos.activities.findById(log.completedActivityId);
        if (planned) {
          await repos.activities.reopen(
            planned.id,
            { type: log.prevType ?? planned.type, subject: log.prevSubject ?? planned.subject },
            now,
          );
        }
      }
      if (log.statusChanged) {
        const lead = await repos.leads.findById(log.leadId);
        if (lead && lead.customerStatus === log.statusAfter) {
          await repos.leads.setCustomerStatus(lead.id, log.statusBefore, now);
        }
      }
      await repos.contactLogs.remove(log.id);
    });
    this.deps.logger.info("temas kaydı geri alındı", {
      leadId: log.leadId,
      logId: log.id,
      stageUndone,
      actorUserId: input.actor.userId,
    });
    return ok({ undone: true, stageUndone });
  }
}

/** Diyalog verisi (sorgu): açık işler, tamamlanacak plan, (tür × sonuç) varsayılanları, izinler. */
export class ContactFormQuery {
  constructor(private readonly deps: UseCaseDeps) {}

  async get(leadId: string, actor: Actor): Promise<Result<ContactForm, RuleError>> {
    const tz = this.deps.timeZone ?? DEFAULT_TIME_ZONE;
    const now = this.deps.clock.now();
    return this.deps.uow.run(async (repos): Promise<Result<ContactForm, RuleError>> => {
      const loaded = await loadActionableLead(repos, leadId, actor);
      if (!loaded.ok) return loaded;
      const lead = loaded.value;
      const all = await repos.activities.listByLead(lead.id);
      const open = all.filter(isOpenActivity).sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
      const summary = summarizeContacts(aggregateContacts(all), lead.contactHistoryUnknown);
      const lastChannel =
        summary.lastType && (CONTACT_CHANNELS as readonly string[]).includes(summary.lastType)
          ? summary.lastType
          : null;
      const completable = pickCompletable(open, lastChannel ?? "call", now, tz);
      const defaultType: ActivityType = completable?.type ?? lastChannel ?? "call";
      const channels: ActivityType[] = [...CONTACT_CHANNELS];
      for (const a of open) {
        if ((a.type === "proposal_sent" || a.type === "site_visit") && !channels.includes(a.type))
          channels.push(a.type);
      }
      const defaults: ContactForm["defaults"] = {};
      for (const type of channels) {
        const perOutcome = {} as Record<ActivityOutcome, ContactFormDefaults>;
        for (const outcome of ACTIVITY_OUTCOMES) {
          const line = stageLine({ outcome, current: lead.currentStage });
          const repliedDefault = (CONTACT_RULES.repliedDefaultTypes as readonly string[]).includes(type);
          const preselected =
            line !== null &&
            (line.mode === "fixed" ||
              line.mode === "checked" ||
              (line.mode === "checked_if_replied" && repliedDefault));
          perOutcome[outcome] = {
            stage: line,
            next: suggestNext({
              outcome,
              type,
              now,
              current: lead.currentStage,
              stageTarget: preselected ? line.target : null,
              timeZone: tz,
            }),
          };
        }
        defaults[type] = perOutcome;
      }
      return ok({
        lead,
        openActivities: open,
        completableId: completable?.id ?? null,
        channels,
        defaultType,
        defaults,
        canSetStatus: true,
        assignsOnSave: lead.assignedUserId === null && !actor.isAdmin,
        now,
        timeZone: tz,
      });
    });
  }
}
