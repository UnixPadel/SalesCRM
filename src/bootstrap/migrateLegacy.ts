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
 */
import type { Db } from "../modules/shared/db";
import { FixedClock, silentLogger, uuidGenerator, type Logger } from "../modules/shared/kernel";
import { createSalesPipeline, type SalesPipeline } from "../modules/sales-pipeline/application";
import type { StageCode } from "../modules/sales-pipeline/domain";
import { PgUnitOfWork } from "../modules/sales-pipeline/infrastructure";

export interface LegacySnapshot {
  organizations: { id: string; name: string; country: string }[];
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
}

export interface MigrateOptions {
  /** Eski sorumlu adı → kullanıcı kimliği (KullaniciID). Eşleşmeyen ad havuza düşer ve raporlanır. */
  ownerIds: Record<string, string>;
  logger?: Logger;
}

export interface MigrateReport {
  leads: { created: number; existing: number; skipped: { id: string; reason: string }[] };
  deals: {
    created: number;
    existing: number;
    skipped: { id: string; reason: string }[];
    stageErrors: { id: string; reason: string }[];
  };
  unknownOwners: string[];
}

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
  const sp: SalesPipeline = createSalesPipeline({
    uow: new PgUnitOfWork(db, uuidGenerator),
    clock,
    ids: uuidGenerator,
    platforms: { enabledProviders: () => [] }, // taşıma platformlara olay üretmez
    events: { publish: async () => {} },
    logger,
    undoWindowMs: 0,
  });
  const report: MigrateReport = {
    leads: { created: 0, existing: 0, skipped: [] },
    deals: { created: 0, existing: 0, skipped: [], stageErrors: [] },
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
      productInterest: [l.product, l.court_count && `${l.court_count} kort`].filter(Boolean).join(" · "),
      campaign: { campaignName: l.campaign || null },
      assignedUserId: ownerId(l.owner),
      extraAnswers: { legacy: { source: l.source, urgency: l.urgency, formAnswers: l.form_answers, status: l.status } },
    });
    if (!r.ok) {
      report.leads.skipped.push({ id: l.id, reason: r.error.code });
      continue;
    }
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
      productInterest: [d.court_model, d.court_count ? `${d.court_count} kort` : ""].filter(Boolean).join(" · "),
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

  report.unknownOwners = [...unknown].sort();
  return report;
}
