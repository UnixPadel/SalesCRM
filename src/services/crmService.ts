// Use-cases. Every behaviour rule that mutates data lives here, so it holds no matter
// which screen triggers it (drag-and-drop, customer drawer, keyboard...).
import { STAGE, languageFor, normalizeOwner } from "../domain/constants";
import { addDays, localDate } from "../domain/rules";
import type {
  Activity,
  ActivityType,
  Contact,
  Currency,
  Deal,
  ID,
  Lead,
  Organization,
  OrgType,
  StageKey,
} from "../domain/types";
import { newId, type CrmRepository } from "../data/repository";

export class RuleError extends Error {}

const iso = () => new Date().toISOString();

/** 09:00 local time, N days from now — the default slot for auto-created follow-ups. */
function morningIn(days: number) {
  const d = addDays(new Date(), days);
  d.setHours(9, 0, 0, 0);
  return d.toISOString();
}

export interface MoveResult {
  deal: Deal;
  followUp?: Activity;
}

/**
 * Moves a customer between board columns.
 *  Rule 2 — entering "Proforma gönderildi" creates a follow-up call due in 3 days.
 *  Rule 3 — entering "Red line" is refused without a reason.
 */
export async function moveDealToStage(
  repo: CrmRepository,
  dealId: ID,
  to: StageKey,
  opts: { lostReason?: string } = {},
): Promise<MoveResult> {
  return repo.transaction(async (tx) => {
    const deal = await tx.deals.get(dealId);
    if (!deal) throw new RuleError("Müşteri bulunamadı.");
    if (deal.stage === to) return { deal };

    const reason = opts.lostReason?.trim() ?? "";
    if (to === "lost" && !reason) {
      throw new RuleError("Red line'a taşımak için olumsuz sonuç nedeni zorunlu.");
    }

    const at = iso();
    const updated = await tx.deals.update(dealId, {
      stage: to,
      stage_entered_at: at,
      lost_reason: to === "lost" ? reason : null,
      lost_at: to === "lost" ? at : null,
      // A sale cannot stay "sold" once it is moved to the red line.
      won_at: to === "lost" ? null : deal.won_at,
    });
    await tx.stageChanges.insert({
      id: newId("sc"),
      deal_id: dealId,
      from_stage: deal.stage,
      to_stage: to,
      changed_at: at,
    });

    let followUp: Activity | undefined;
    if (to === "proforma_sent") {
      followUp = await tx.activities.insert({
        id: newId("act"),
        type: "call",
        subject: "Proforma takibi — müşteri dönüşü",
        due_at: morningIn(3),
        done: false,
        done_at: null,
        deal_id: dealId,
        notes: `"${deal.title}" için proforma gönderildi; 3 gün sonra otomatik takip.`,
        auto_created: true,
        created_at: at,
      });
    }
    return { deal: updated, followUp };
  });
}

export type StageSnapshot = Pick<Deal, "stage" | "stage_entered_at" | "won_at" | "lost_at" | "lost_reason">;

/**
 * True undo of the last column move: restores the previous stage fields (including the
 * original stage_entered_at), drops the change-log entry and any auto-created follow-up.
 */
export async function undoStageMove(repo: CrmRepository, dealId: ID, prev: StageSnapshot, followUpId?: ID) {
  return repo.transaction(async (tx) => {
    await tx.deals.update(dealId, prev);
    const last = (await tx.stageChanges.list())
      .filter((c) => c.deal_id === dealId)
      .sort((a, b) => b.changed_at.localeCompare(a.changed_at))[0];
    if (last && last.from_stage === prev.stage) await tx.stageChanges.remove(last.id);
    if (followUpId && (await tx.activities.get(followUpId))) await tx.activities.remove(followUpId);
  });
}

/** Marks the sale as closed (or reopens it). The card keeps its column. */
export async function setWon(repo: CrmRepository, dealId: ID, won: boolean) {
  const deal = await repo.deals.get(dealId);
  if (!deal) throw new RuleError("Müşteri bulunamadı.");
  if (won && deal.stage === "lost") throw new RuleError("Red line'daki bir müşteri satıldı olarak işaretlenemez.");
  return repo.deals.update(dealId, { won_at: won ? iso() : null });
}

/** Takes a customer from the shared pool (or hands it to another rep). */
export async function assignDeal(repo: CrmRepository, dealId: ID, owner: string) {
  const deal = await repo.deals.get(dealId);
  if (!deal) throw new RuleError("Müşteri bulunamadı.");
  const updated = await repo.deals.update(dealId, { owner });
  if (deal.lead_id && (await repo.leads.get(deal.lead_id))) await repo.leads.update(deal.lead_id, { owner });
  return updated;
}

export interface NewDealInput {
  title: string;
  organization: { id: ID } | { name: string; country: string; type: OrgType };
  contact: { id: ID } | { name: string; email: string; phone: string; role: string } | null;
  stage: StageKey;
  value: number;
  currency: Currency;
  court_count: number;
  court_model: string;
  expected_close_date: string | null;
  owner: string;
  lead_id?: ID | null;
  lostReason?: string;
}

export async function createDeal(repo: CrmRepository, input: NewDealInput): Promise<Deal> {
  if (!input.title.trim()) throw new RuleError("Müşteri adı zorunlu.");
  if (input.stage === "lost" && !input.lostReason?.trim())
    throw new RuleError("Red line'da müşteri açmak için olumsuz sonuç nedeni zorunlu.");

  return repo.transaction(async (tx) => {
    const at = iso();
    let orgId: ID;
    let country = "";
    if ("id" in input.organization) {
      orgId = input.organization.id;
      country = (await tx.organizations.get(orgId))?.country ?? "";
    } else {
      const org: Organization = {
        id: newId("org"),
        name: input.organization.name.trim(),
        country: input.organization.country,
        type: input.organization.type,
        website: "",
        notes: "",
        created_at: at,
      };
      await tx.organizations.insert(org);
      orgId = org.id;
      country = org.country;
    }

    let contactId: ID | null = null;
    if (input.contact && "id" in input.contact) {
      contactId = input.contact.id;
      const c = await tx.contacts.get(contactId);
      if (c && !c.organization_id) await tx.contacts.update(contactId, { organization_id: orgId });
    } else if (input.contact && input.contact.name.trim()) {
      const c: Contact = {
        id: newId("con"),
        name: input.contact.name.trim(),
        role: input.contact.role,
        email: input.contact.email.trim(),
        phone: input.contact.phone.trim(),
        organization_id: orgId,
        preferred_language: languageFor(country),
        country,
        created_at: at,
      };
      await tx.contacts.insert(c);
      contactId = c.id;
    }

    const deal: Deal = {
      id: newId("deal"),
      title: input.title.trim(),
      organization_id: orgId,
      contact_id: contactId,
      stage: "contacted",
      value: Math.max(0, input.value || 0),
      currency: input.currency,
      court_count: Math.max(0, input.court_count || 0),
      court_model: input.court_model,
      expected_close_date: input.expected_close_date,
      owner: input.owner,
      lost_reason: null,
      notes: "",
      lead_id: input.lead_id ?? null,
      created_at: at,
      stage_entered_at: at,
      won_at: null,
      lost_at: null,
    };
    await tx.deals.insert(deal);
    await tx.stageChanges.insert({
      id: newId("sc"),
      deal_id: deal.id,
      from_stage: null,
      to_stage: "contacted",
      changed_at: at,
    });
    // Route non-initial columns through the same rule engine (proforma follow-up, red-line reason).
    if (input.stage !== "contacted") {
      return (await moveDealToStage(tx, deal.id, input.stage, { lostReason: input.lostReason })).deal;
    }
    return deal;
  });
}

/**
 * Rule 5 — one click puts a form lead on the board as "İletişime geçildi".
 * The lead gets status "qualified" (= on the board). The converting rep becomes the owner
 * unless the lead was already tagged to someone.
 */
export async function convertLead(repo: CrmRepository, leadId: ID, by: string): Promise<Deal> {
  return repo.transaction(async (tx) => {
    const lead = await tx.leads.get(leadId);
    if (!lead) throw new RuleError("Form kaydı bulunamadı.");
    if (lead.deal_id) {
      const existing = await tx.deals.get(lead.deal_id);
      if (existing) return existing;
    }
    const contact = await tx.contacts.get(lead.contact_id);
    const name = contact?.name || "İsimsiz müşteri";
    const courts = parseInt(lead.court_count, 10) || 0;
    const product = lead.product.split(" + ")[0] || "Padel Court";
    const owner = normalizeOwner(lead.owner) || by;

    const deal = await createDeal(tx, {
      title: name,
      organization: contact?.organization_id
        ? { id: contact.organization_id }
        : { name: lead.location ? `${name} (${lead.location})` : name, country: contact?.country ?? "", type: "club" },
      contact: contact ? { id: contact.id } : null,
      stage: "contacted",
      value: 0,
      currency: "EUR",
      court_count: courts,
      court_model: /plate/i.test(product)
        ? "Plate Padel"
        : /canopy|kanopi/i.test(product)
          ? "Roof Top Kanopi"
          : "Panoramik",
      expected_close_date: null,
      owner,
      lead_id: lead.id,
    });
    if (lead.form_answers) await tx.deals.update(deal.id, { notes: `Form cevapları: ${lead.form_answers}` });
    await tx.leads.update(lead.id, { status: "qualified", deal_id: deal.id, owner });
    return (await tx.deals.get(deal.id))!;
  });
}

export async function updateDeal(
  repo: CrmRepository,
  id: ID,
  patch: Partial<Omit<Deal, "id" | "stage" | "stage_entered_at" | "won_at" | "lost_at">>,
) {
  const deal = await repo.deals.get(id);
  if (!deal) throw new RuleError("Müşteri bulunamadı.");
  if (deal.stage === "lost" && "lost_reason" in patch && !patch.lost_reason?.trim())
    throw new RuleError("Olumsuz sonuç nedeni boş bırakılamaz.");
  return repo.deals.update(id, patch);
}

export async function deleteDeal(repo: CrmRepository, id: ID) {
  return repo.transaction(async (tx) => {
    for (const a of (await tx.activities.list()).filter((a) => a.deal_id === id)) await tx.activities.remove(a.id);
    for (const c of (await tx.stageChanges.list()).filter((c) => c.deal_id === id)) await tx.stageChanges.remove(c.id);
    for (const l of (await tx.leads.list()).filter((l) => l.deal_id === id))
      await tx.leads.update(l.id, { deal_id: null, status: "new" });
    await tx.deals.remove(id);
  });
}

export interface NewActivityInput {
  deal_id: ID;
  type: ActivityType;
  subject: string;
  due_at: string;
  notes: string;
  done?: boolean;
}
export async function addActivity(repo: CrmRepository, input: NewActivityInput) {
  if (!input.due_at) throw new RuleError("Aktivite için tarih seçin.");
  const at = iso();
  return repo.activities.insert({
    id: newId("act"),
    type: input.type,
    subject: input.subject.trim() || defaultSubject(input.type),
    due_at: input.due_at,
    done: !!input.done,
    done_at: input.done ? at : null,
    deal_id: input.deal_id,
    notes: input.notes.trim(),
    auto_created: false,
    created_at: at,
  });
}
export const defaultSubject = (t: ActivityType) =>
  ({
    call: "Arama",
    email: "E-posta",
    meeting: "Toplantı",
    proforma_sent: "Proforma gönderimi",
    site_visit: "Saha ziyareti",
  })[t];

export async function setActivityDone(repo: CrmRepository, id: ID, done: boolean) {
  return repo.activities.update(id, { done, done_at: done ? iso() : null });
}
export async function updateActivity(repo: CrmRepository, id: ID, patch: Partial<Omit<Activity, "id">>) {
  return repo.activities.update(id, patch);
}
export async function deleteActivity(repo: CrmRepository, id: ID) {
  return repo.activities.remove(id);
}

export async function updateLead(repo: CrmRepository, id: ID, patch: Partial<Omit<Lead, "id">>) {
  return repo.leads.update(id, patch);
}
export async function updateContact(repo: CrmRepository, id: ID, patch: Partial<Omit<Contact, "id">>) {
  return repo.contacts.update(id, patch);
}
export async function updateOrganization(repo: CrmRepository, id: ID, patch: Partial<Omit<Organization, "id">>) {
  return repo.organizations.update(id, patch);
}

export const stageLabel = (k: StageKey) => STAGE[k].label;
export const dateOnly = (d: Date) => localDate(d);
