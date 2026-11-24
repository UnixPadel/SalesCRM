import { NotFoundError, RuleError, err, ok, type Result } from "../../shared/kernel";
import {
  DEFAULT_SUBJECTS,
  DEFAULT_TIME_ZONE,
  NO_CONTACT_FIELDS,
  PROPOSAL_FOLLOW_UP,
  followUpFor,
  impliesContact,
  planStageChange,
  validateStageContact,
  type Activity,
  type DomainEvent,
  type Lead,
  type StageCode,
  type StageContactInput,
  type StageEvent,
  type ValidContact,
} from "../domain";
import type { Actor, UseCaseDeps } from "./types";
import { canAct, territoriesOf } from "./visibility";

export interface ChangeLeadStageInput {
  leadId: string;
  target: StageCode;
  actor: Actor;
  value?: { amount: number; currency: string } | null;
  lostReasonCode?: string | null;
  qualificationAnswers?: Partial<Record<string, boolean>> | null;
  /** Nitelikli ayrıntıları (ham); `requireQualificationDetails` ile zorunlu olur (arayüz isteği). */
  qualificationDetails?: unknown;
  requireQualificationDetails?: boolean;
  /** Eski kayıt taşıma: geçmişte gönderilmiş teklif için bugün bir takip aktivitesi açılmaz. */
  skipFollowUp?: boolean;
  /**
   * Aşama kapısı (arayüz isteği): hiç temas kaydı olmayan lead temas gerektiren aşamaya geçerken `contact` zorunlu
   * olur ve temas aynı işlemde yazılır. İçe aktarma ve "Temas kaydet" bunu istemez (temaslarını kendileri yazar).
   */
  requireContact?: boolean;
  contact?: StageContactInput | null;
}

export interface ChangeLeadStageResult {
  lead: Lead;
  changeId: string;
  events: StageEvent[];
  /** Havuzdaki lead'i değiştiren satışçı onu üstlenmiş olur. */
  assignedTo: string | null;
  /** Kural 2: Teklif gönderildi'ye girişte açılan takip aktivitesi; başka aşamada null. */
  followUp: Activity | null;
  /** Aşama kapısının yazdığı temas; kapı çalışmadıysa null. */
  contact: Activity | null;
}

/**
 * Aşama sistemde yalnız buradan değişir (Genel plan): UI, API, toplu işlem hepsi bu komutu çağırır.
 * Tek transaction: current_stage + aşama olayları + etkin platform başına outbox satırı birlikte
 * yazılır; biri başarısızsa hiçbiri yazılmaz.
 */
export class ChangeLeadStage {
  constructor(private readonly deps: UseCaseDeps) {}

  async execute(input: ChangeLeadStageInput): Promise<Result<ChangeLeadStageResult, RuleError>> {
    const { uow, clock, ids, platforms, undoWindowMs } = this.deps;

    const outcome = await uow.run(
      async (repos): Promise<Result<ChangeLeadStageResult & { domainEvents: DomainEvent[] }, RuleError>> => {
        const lead = await repos.leads.findById(input.leadId);
        if (!lead) return err(new NotFoundError("Lead", input.leadId));

        const myCountries = input.actor.isAdmin ? [] : territoriesOf(input.actor.userId, await repos.territories.all());
        if (!canAct(lead, input.actor, myCountries)) {
          return err(new RuleError("lead.forbidden", "Bu lead başka bir satışçıya ait.", { leadId: lead.id }));
        }

        const plan = planStageChange({
          currentStage: lead.currentStage,
          target: input.target,
          value: input.value ?? null,
          lostReasonCode: input.lostReasonCode ?? null,
          qualificationAnswers: input.qualificationAnswers ?? null,
          qualificationDetails: input.qualificationDetails ?? null,
          requireQualificationDetails: input.requireQualificationDetails === true,
          knownLostReasons: await repos.lostReasons.activeCodes(),
        });
        if (!plan.ok) return plan;

        const now = clock.now();
        // Aşama kapısı: yazmadan önce doğrulanır.
        let stageContact: ValidContact | null = null;
        if (input.requireContact && impliesContact(plan.value.to)) {
          const hasContact = (await repos.activities.listByLead(lead.id)).some((a) => a.doneAt !== null);
          if (!hasContact) {
            const valid = validateStageContact(
              input.contact,
              plan.value.to,
              now,
              this.deps.timeZone ?? DEFAULT_TIME_ZONE,
            );
            if (!valid.ok) return valid;
            stageContact = valid.value;
          }
        }
        const changeId = ids.next();
        let sequence = await repos.stageEvents.nextSequence(lead.id);
        const events: StageEvent[] = [];
        const notBefore = new Date(now.getTime() + undoWindowMs);
        for (const draft of plan.value.events) {
          const event: StageEvent = {
            id: ids.next(),
            leadId: lead.id,
            changeId,
            stageCode: draft.stageCode,
            occurredAt: now,
            sequence: sequence++,
            actorUserId: input.actor.userId,
            origin: draft.origin,
            value: draft.value,
            lostReasonCode: draft.lostReasonCode,
            qualificationAnswers: draft.qualificationAnswers,
            qualificationDetails: draft.qualificationDetails,
            undoneAt: null,
          };
          await repos.stageEvents.insert(event);
          if (!lead.isTest) {
            for (const provider of platforms.enabledProviders())
              await repos.outbox.enqueue(event.id, provider, notBefore);
          }
          events.push(event);
        }
        await repos.leads.updateStage(lead.id, plan.value.to, now);

        // Kural 2: takip aktivitesi aynı transaction'da, aynı changeId ile (geri al onu da siler).
        const follow = input.skipFollowUp
          ? null
          : followUpFor(plan.value.to, now, {
              ...PROPOSAL_FOLLOW_UP,
              timeZone: this.deps.timeZone ?? PROPOSAL_FOLLOW_UP.timeZone,
            });
        let followUp: Activity | null = null;
        if (follow) {
          followUp = {
            id: ids.next(),
            leadId: lead.id,
            ...follow,
            doneAt: null,
            notes: "",
            autoCreated: true,
            createdByChangeId: changeId,
            createdByUserId: input.actor.userId,
            legacyId: null,
            ...NO_CONTACT_FIELDS,
            createdAt: now,
            updatedAt: now,
          };
          await repos.activities.insert(followUp);
        }

        // Aşama kapısının teması: aynı changeId ile (geri al onu da siler).
        let contact: Activity | null = null;
        if (stageContact) {
          contact = {
            id: ids.next(),
            leadId: lead.id,
            type: stageContact.type,
            subject: DEFAULT_SUBJECTS[stageContact.type],
            dueAt: stageContact.occurredAt,
            doneAt: stageContact.occurredAt,
            notes: "",
            autoCreated: false,
            createdByChangeId: changeId,
            createdByUserId: input.actor.userId,
            legacyId: null,
            ...NO_CONTACT_FIELDS,
            outcome: stageContact.outcome,
            doneByUserId: input.actor.userId,
            createdAt: now,
            updatedAt: now,
          };
          await repos.activities.insert(contact);
        }

        const domainEvents: DomainEvent[] = [
          {
            type: "LeadStageChanged",
            leadId: lead.id,
            changeId,
            from: plan.value.from,
            to: plan.value.to,
            actorUserId: input.actor.userId,
            occurredAt: now,
          },
        ];
        let assignedTo = lead.assignedUserId;
        if (lead.assignedUserId === null && !input.actor.isAdmin) {
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
          lead: { ...lead, currentStage: plan.value.to, assignedUserId: assignedTo, updatedAt: now },
          changeId,
          events,
          assignedTo,
          followUp,
          contact,
          domainEvents,
        });
      },
    );

    if (!outcome.ok) return outcome;
    await this.deps.events.publish(outcome.value.domainEvents);
    const moved = outcome.value.domainEvents.find((e) => e.type === "LeadStageChanged");
    await this.deps.actions?.record({
      actor: input.actor,
      action: "stage.changed",
      lead: outcome.value.lead,
      details: { from: moved?.type === "LeadStageChanged" ? moved.from : null, to: outcome.value.lead.currentStage },
    });
    this.deps.logger.info("aşama değişti", {
      leadId: outcome.value.lead.id,
      changeId: outcome.value.changeId,
      to: outcome.value.lead.currentStage,
      events: outcome.value.events.length,
      actorUserId: input.actor.userId,
    });
    const { domainEvents: _d, ...result } = outcome.value;
    return ok(result);
  }
}
