/**
 * Eski JSON verisini (server/data/crm.json) yeni pipeline'a taşır (ADR-0006, Faz 1 adım 9).
 * Aynı komutlar kullanılır (CreateLead, ChangeLeadStage): doğrulama, mükerrer kişi ve
 * yalnız-ileri kuralı aynen geçerli. Yeniden çalıştırmak güvenlidir: kaynak "import" +
 * eski kimlik (platform_lead_id) UNIQUE olduğu için ikinci kez açılmaz.
 *
 * Eşleme (ADR-0006, seçenek 3):
 *   form lead'i status new → NEW, qualified → QUALIFIED (sorular "evet" varsayılır), discarded → LOST (unqualified)
 *   fırsat: contacted → CONTACTED, interested → QUALIFIED, proforma_sent / site_visit → PROPOSAL,
 *           won_at dolu → WON (tutar + para birimi), lost → LOST (neden metni koda eşlenir)
 * Geriye hareket içeren eski geçmiş yeniden oynatılmaz; son aşama tek adımda yazılır, atlananlar
 * auto_fill olur. Eski geçmiş `extraAnswers.legacy` altında saklanır.
 *
 * Faz 6d: kuruluşlar `organizations` tablosuna (legacy_id ile; aynı ad+ülke varsa ona bağlanır), kişi ve fırsat
 * kuruluşa bağlanır; eski aktiviteler fırsatın lead'ine `activities` olarak (legacy_id ile) taşınır.
 */
import type { Db } from "../modules/shared/db";
import { FixedClock, silentLogger, uuidGenerator, type Logger } from "../modules/shared/kernel";
import { createSalesPipeline, type SalesPipeline } from "../modules/sales-pipeline/application";
import {
  isActivityType,
  isOrganizationType,
  type Activity,
  type Organization,
  type StageCode,
} from "../modules/sales-pipeline/domain";
import { PgUnitOfWork } from "../modules/sales-pipeline/infrastructure";

export interface LegacySnapshot {
  organizations: {
    id: string;
    name: string;
    country: string;
    type?: string;
    website?: string;
    notes?: string;
    created_at?: string;
  }[];
  contacts: {
    id: string;
    name: string;
    email: string;
    phone: string;
    organization_id: string | null;
    country: string;
  }[];
  leads: {
    id: string;
    source: string;
    status: "new" | "qualified" | "discarded";
    contact_id: string;
    campaign: string;
    product: string;
    court_count: string;
    urgency: string;
    location: string;
    owner: string;
    form_answers: string;
    created_at: string;
    deal_id: string | null;
  }[];
  deals: {
    id: string;
    title: string;
    organization_id: string | null;
    contact_id: string | null;
    stage: "contacted" | "interested" | "proforma_sent" | "site_visit" | "lost";
    value: number;
    currency: string;
    court_count: number;
    court_model: string;
    owner: string;
    lost_reason: string | null;
    notes: string;
    created_at: string;
    stage_entered_at: string;
    won_at: string | null;
    lost_at: string | null;
  }[];
  stageChanges: { id: string; deal_id: string; from_stage: string | null; to_stage: string; changed_at: string }[];
  /** Eski panodaki aktiviteler (Faz 6d); eski dışa aktarımlarda olmayabilir. */
  activities?: {
    id: string;
    type: string;
    subject: string;
    due_at: string;
    done: boolean;
    done_at: string | null;
    deal_id: string;
    notes: string;
    auto_created: boolean;
    created_at: string;
  }[];
}

export interface MigrateOptions {
  /** Eski sorumlu adı → kullanıcı kimliği (KullaniciID). Eşleşmeyen ad havuza düşer ve raporlanır. */
  ownerIds: Record<string, string>;
  logger?: Logger;
}

export interface MigrateReport {
  organizations: { created: number; existing: number };
  leads: { created: number; existing: number; skipped: { id: string; reason: string }[] };
  deals: {
    created: number;
    existing: number;
    skipped: { id: string; reason: string }[];
    stageErrors: { id: string; reason: string }[];
  };
  activities: { created: number; existing: number; skipped: { id: string; reason: string }[] };
  unknownOwners: string[];
}

/** Eski aktivite türü → yeni; proforma_sent → proposal_sent. */
const ACTIVITY_TYPE: Record<string, Activity["type"]> = { proforma_sent: "proposal_sent" };

const DEAL_STAGE: Record<string, StageCode> = {
  contacted: "CONTACTED",
  interested: "QUALIFIED",
  proforma_sent: "PROPOSAL",
  site_visit: "PROPOSAL",
  lost: "LOST",
};

/** Eski serbest metin nedeni → sabit kod (db/migrations/0002). */
export function mapLostReason(text: string | null): string {
  const t = (text ?? "").toLocaleLowerCase("tr");
  if (/fiyat/.test(t)) return "price_too_high";
  if (/rakip/.test(t)) return "competitor";
  if (/ertelen|iptal/.test(t)) return "postponed";
  if (/bütçe|finansman/.test(t)) return "no_budget";
  if (/yanıt/.test(t)) return "no_response";
  if (/arsa|izin/.test(t)) return "site_permit";
  return "unqualified";
}

const YES = { budget_approved: true, site_known: true, install_within_12m: true };

export async function migrateLegacy(db: Db, snap: LegacySnapshot, opts: MigrateOptions): Promise<MigrateReport> {
  const logger = opts.logger ?? silentLogger;
  const clock = new FixedClock();
  const uow = new PgUnitOfWork(db, uuidGenerator);
  const sp: SalesPipeline = createSalesPipeline({
    uow,
    clock,
    ids: uuidGenerator,
    platforms: { enabledProviders: () => [] }, // taşıma platformlara olay üretmez
    events: { publish: async () => {} },
    logger,
    undoWindowMs: 0,
  });
  const report: MigrateReport = {
    organizations: { created: 0, existing: 0 },
    leads: { created: 0, existing: 0, skipped: [] },
    deals: { created: 0, existing: 0, skipped: [], stageErrors: [] },
    activities: { created: 0, existing: 0, skipped: [] },
    unknownOwners: [],
  };
  const unknown = new Set<string>();
  const ownerId = (name: string): string | null => {
    if (!name) return null;
    const id = opts.ownerIds[name];
    if (!id) unknown.add(name);
    return id ?? null;
  };
  const contacts = new Map(snap.contacts.map((c) => [c.id, c]));
  const orgs = new Map(snap.organizations.map((o) => [o.id, o]));
  const ACTOR = { userId: "migration", isAdmin: true };

  // Kuruluşlar: eski kimlik → yeni kimlik. Aynı ad + ülke zaten varsa ona bağlanır (ikinci kayıt açılmaz).
  const orgIds = new Map<string, string>();
  for (const o of snap.organizations) {
    const name = o.name.trim();
    if (!name) continue;
    const country = /^[A-Za-z]{2}$/.test(o.country ?? "") ? o.country.toUpperCase() : null;
    const found = await uow.run(
      async (r) => (await r.organizations.findByLegacyId(o.id)) ?? r.organizations.findByName(name, country),
    );
    if (found) {
      orgIds.set(o.id, found.id);
      report.organizations.existing++;
      continue;
    }
    const at = o.created_at ? new Date(o.created_at) : new Date();
    const organization: Organization = {
      id: uuidGenerator.next(),
      name,
      type: isOrganizationType(o.type) ? o.type : "club",
      country,
      website: (o.website ?? "").trim().slice(0, 200),
      notes: (o.notes ?? "").trim().slice(0, 4000),
      legacyId: o.id,
      createdAt: at,
      updatedAt: at,
    };
    await uow.run((r) => r.organizations.insert(organization));
    orgIds.set(o.id, organization.id);
    report.organizations.created++;
  }
  const orgIdOf = (legacy: string | null | undefined) => (legacy ? (orgIds.get(legacy) ?? null) : null);
  /** Kişi kuruluşsuzsa bağlar (ilk gelen kazanır). */
  const linkPerson = async (personId: string, organizationId: string | null) => {
    if (!organizationId) return;
    await uow.run(async (r) => {
      const p = await r.persons.findById(personId);
      if (p && !p.organizationId) await r.persons.update(personId, { organizationId });
    });
  };

  /** Geçersiz telefonla kayıt kaybetmemek için: önce ikisiyle, olmazsa yalnız e-postayla dener. */
  const createWithFallback = async (input: Parameters<SalesPipeline["createLead"]["execute"]>[0]) => {
    const first = await sp.createLead.execute(input);
    if (first.ok || !first.error.code.startsWith("phone")) return first;
    return sp.createLead.execute({ ...input, phone: null });
  };

  for (const l of snap.leads) {
    const c = contacts.get(l.contact_id);
    if (!c) {
      report.leads.skipped.push({ id: l.id, reason: "kişi yok" });
      continue;
    }
    clock.set(l.created_at);
    const r = await createWithFallback({
      source: "import",
      platformLeadId: l.id,
      fullName: c.name,
      email: c.email || null,
      phone: c.phone || null,
      country: c.country || null,
      city: l.location,
      productInterest: l.product,
      courtCount: /^\d+$/.test(l.court_count) ? Number(l.court_count) : null,
      organizationId: orgIdOf(c.organization_id),
      campaign: { campaignName: l.campaign || null },
      assignedUserId: ownerId(l.owner),
      extraAnswers: { legacy: { source: l.source, urgency: l.urgency, formAnswers: l.form_answers, status: l.status } },
    });
    if (!r.ok) {
      report.leads.skipped.push({ id: l.id, reason: r.error.code });
      continue;
    }
    await linkPerson(r.value.lead.personId, orgIdOf(c.organization_id));
    if (!r.value.created) {
      report.leads.existing++;
      continue;
    }
    report.leads.created++;
    if (l.status === "qualified") {
      await sp.changeLeadStage.execute({
        leadId: r.value.lead.id,
        target: "QUALIFIED",
        actor: ACTOR,
        qualificationAnswers: YES,
      });
    } else if (l.status === "discarded") {
      await sp.changeLeadStage.execute({
        leadId: r.value.lead.id,
        target: "LOST",
        actor: ACTOR,
        lostReasonCode: "unqualified",
      });
    }
  }

  for (const d of snap.deals) {
    const c = d.contact_id ? contacts.get(d.contact_id) : undefined;
    const org = d.organization_id ? orgs.get(d.organization_id) : undefined;
    const history = snap.stageChanges
      .filter((s) => s.deal_id === d.id)
      .map((s) => ({ from: s.from_stage, to: s.to_stage, at: s.changed_at }));
    if (!c?.email && !c?.phone) {
      report.deals.skipped.push({ id: d.id, reason: "kişide e-posta/telefon yok" });
      continue;
    }
    clock.set(d.created_at);
    const r = await createWithFallback({
      source: "import",
      platformLeadId: d.id,
      fullName: c.name || d.title,
      email: c.email || null,
      phone: c.phone || null,
      country: c.country || org?.country || null,
      company: org?.name ?? "",
      productInterest: d.court_model,
      courtCount: d.court_count || null,
      courtModel: d.court_model,
      organizationId: orgIdOf(d.organization_id) ?? orgIdOf(c.organization_id),
      notes: d.notes,
      assignedUserId: ownerId(d.owner),
      extraAnswers: {
        legacy: {
          dealId: d.id,
          title: d.title,
          stage: d.stage,
          value: d.value,
          currency: d.currency,
          stageHistory: history,
        },
      },
    });
    if (!r.ok) {
      report.deals.skipped.push({ id: d.id, reason: r.error.code });
      continue;
    }
    await linkPerson(r.value.lead.personId, orgIdOf(d.organization_id) ?? orgIdOf(c.organization_id));
    if (!r.value.created) {
      report.deals.existing++;
      continue;
    }
    report.deals.created++;

    const target: StageCode = d.won_at ? "WON" : (DEAL_STAGE[d.stage] ?? "CONTACTED");
    clock.set(d.won_at ?? d.lost_at ?? d.stage_entered_at);
    const s = await sp.changeLeadStage.execute({
      leadId: r.value.lead.id,
      target,
      actor: ACTOR,
      value: target === "WON" ? { amount: d.value, currency: d.currency } : null,
      lostReasonCode: target === "LOST" ? mapLostReason(d.lost_reason) : null,
      qualificationAnswers: target === "QUALIFIED" ? YES : null,
    });
    if (!s.ok) report.deals.stageErrors.push({ id: d.id, reason: s.error.code });
  }

  // Aktiviteler: fırsatın lead'ine (platform_lead_id = eski fırsat kimliği) bağlanır; legacy_id ile tekrar açılmaz.
  for (const a of snap.activities ?? []) {
    const existing = await uow.run((r) => r.activities.findByLegacyId(a.id));
    if (existing) {
      report.activities.existing++;
      continue;
    }
    const lead = await uow.run((r) => r.leads.findByPlatformId("import", a.deal_id));
    if (!lead) {
      report.activities.skipped.push({ id: a.id, reason: "fırsat taşınmamış" });
      continue;
    }
    const type = ACTIVITY_TYPE[a.type] ?? a.type;
    if (!isActivityType(type)) {
      report.activities.skipped.push({ id: a.id, reason: `bilinmeyen tür: ${a.type}` });
      continue;
    }
    const dueAt = new Date(a.due_at);
    if (Number.isNaN(dueAt.getTime())) {
      report.activities.skipped.push({ id: a.id, reason: "tarih yok" });
      continue;
    }
    const createdAt = a.created_at ? new Date(a.created_at) : dueAt;
    const doneAt = a.done ? new Date(a.done_at ?? a.due_at) : null;
    const activity: Activity = {
      id: uuidGenerator.next(),
      leadId: lead.id,
      type,
      subject: (a.subject ?? "").trim().slice(0, 200),
      dueAt,
      doneAt,
      notes: (a.notes ?? "").trim().slice(0, 4000),
      autoCreated: !!a.auto_created,
      createdByChangeId: null,
      createdByUserId: null,
      legacyId: a.id,
      createdAt: Number.isNaN(createdAt.getTime()) ? dueAt : createdAt,
      updatedAt: doneAt ?? (Number.isNaN(createdAt.getTime()) ? dueAt : createdAt),
    };
    await uow.run((r) => r.activities.insert(activity));
    report.activities.created++;
  }

  report.unknownOwners = [...unknown].sort();
  return report;
}
