/**
 * Excel satış takip listesinin CRM'e aktarımı (Faz 7g, D10 ve D7; iş emri §6). Gerçek komutlar kullanılır
 * (CreateLead, ChangeLeadStage, AssignLead, UpdateLeadFields, SetCustomerStatus); temaslar aktivite deposuna
 * eski kimlikle (legacy id) yazılır. Platformlara olay üretmez (`enabledProviders: () => []`). İdempotenttir:
 * lead `excel_no` ile, temas ve takip tohumu legacy id ile bulunur, alanlar yalnız boşsa yazılır, aşama yalnız ileri
 * gider. Kişisel veri rapora yazılmaz: yalnız sayılar, lead kimlikleri, Excel No, ekip etiketleri ve kodlar.
 */
import type { Db } from "../modules/shared/db";
import { DAY, FixedClock, MINUTE, silentLogger, uuidGenerator, type Logger } from "../modules/shared/kernel";
import { Email, PhoneNumber } from "../modules/shared/normalization";
import { fold, normalizeFormAnswers } from "../modules/lead-intake/application";
import { createSalesPipeline, localDayStart, type SalesPipeline } from "../modules/sales-pipeline/application";
import {
  DEFAULT_SUBJECTS,
  DEFAULT_TIME_ZONE,
  FOLLOW_UP_SUBJECTS,
  NO_CONTACT_FIELDS,
  calendarDay,
  hasAnyProduct,
  isReply,
  isTerminal,
  parseProductPrefs,
  stageIndex,
  type Activity,
  type ActivityOutcome,
  type ActivityType,
  type CustomerStatus,
  type Lead,
  type ProductPrefs,
  type StageCode,
} from "../modules/sales-pipeline/domain";
import { PgUnitOfWork } from "../modules/sales-pipeline/infrastructure";
import { parseExcelCountry, type ExcelContactRow, type ExcelLeadRow, type ExcelSnapshot } from "./excelSnapshot";
import { labelParts, matchTeamLabel, UNASSIGNED_LABEL, type DirectoryEntry, type TeamMatch } from "./teamMatch";

export const IMPORT_ACTOR = { userId: "import", isAdmin: true } as const;
const PLATFORM_PREFIX = "excel:satis:";

export interface ImportExcelOptions {
  /** Kullanıcı tablosu; null = okunamadı (yalnız `overrides` çalışır). */
  directory: readonly DirectoryEntry[] | null;
  /** Etiket (ad kısmı ya da tam etiket) → KullaniciID ya da null (havuz). */
  overrides?: Readonly<Record<string, string | null>>;
  applyToPool?: boolean;
  /** Varsayılan açık (iş emri §8 soru 6). */
  seedFollowUps?: boolean;
  /** "Şimdi" (rapor ve takip tohumu); testler sabit verir. */
  now?: Date;
  timeZone?: string;
  logger?: Logger;
}

export interface ImportExcelReport {
  rows: number;
  contactRows: number;
  territoryRows: number;
  owners: { label: string; name: string; count: number; match: TeamMatch }[];
  territory: { written: string[]; existing: number; skipped: number; conflicts: string[] };
  leads: {
    created: number;
    enriched: { leadId: string; no: string }[];
    rerun: number;
    personConflicts: string[];
    renumbered: string[];
    noIdentity: string[];
    failed: { no: string; code: string }[];
  };
  /** Bu koşuda yapılan aşama değişiklikleri (hedef aşamaya göre). */
  stages: Partial<Record<StageCode, number>>;
  /** Yeni lead'lerin son aşaması. */
  newLeadStages: Partial<Record<StageCode, number>>;
  contacts: { mailSent: number; waSent: number; mailReply: number; waReply: number; temas: number; next: number };
  fields: { status: number; products: number; formAnswers: number; platform: number; campaign: number };
  fieldConflicts: number;
  issues: Record<string, number>;
  issueLeads: number;
  hints: string[];
  phoneUnreadable: number;
  seeds: Record<string, number>;
  seedDays: Record<string, number>;
  pool: { open: number; assigned: Record<string, number> };
  candidates: { won: string[]; lost: string[] };
  /** Toplam yazma sayısı; ikinci koşuda 0 ("değişiklik yok"). */
  changes: number;
}

const CHANNELS: Record<string, ActivityType> = {
  telefon: "call",
  whatsapp: "whatsapp",
  "e posta": "email",
  toplanti: "meeting",
  diger: "other",
};
const OUTCOMES: Record<string, ActivityOutcome> = {
  "donus alindi": "reply_received",
  "donus bekleniyor": "awaiting_reply",
  "teklif gonderildi": "proposal_sent",
  "takip edilecek": "follow_up",
  olumsuz: "negative",
  "anlasma saglandi": "agreed",
};
const STATUSES: Record<string, CustomerStatus> = {
  ilgili: "interested",
  ilgisiz: "not_interested",
  "proje asamasinda": "project_phase",
  "fiyat toplama asamasi": "collecting_prices",
  "alici proje hazir": "buyer_ready",
};
/** Reklam yüzeyi: eşleme yalnız burada (platform adları modüllere girmez). */
const SURFACES: Record<string, string> = { instagram: "ig", facebook: "fb", ig: "ig", fb: "fb" };

export const statusFromExcel = (raw: string): CustomerStatus | null | "unknown" =>
  raw.trim() ? (STATUSES[fold(raw)] ?? "unknown") : null;

const MIN_DAY = "2024-01-01";

/** Excel satırının ürünleri ve sorunları (iş emri §6.3, P–X). */
export function productsFromRow(r: ExcelLeadRow): { products: unknown; issues: string[]; any: boolean } {
  const issues: string[] = [];
  const qty = (c: { tick: boolean; qty: number | null }): number | null => {
    const q = c.qty !== null && c.qty > 0 ? Math.round(c.qty) : null;
    if (c.tick && q === null) {
      issues.push("tick_without_qty");
      return 1;
    }
    if (!c.tick && q !== null) issues.push("qty_without_tick");
    return q;
  };
  const w = r.roof.widthM !== null && r.roof.widthM > 0 ? r.roof.widthM : null;
  const l = r.roof.lengthM !== null && r.roof.lengthM > 0 ? r.roof.lengthM : null;
  if (!r.roof.tick && (w !== null || l !== null)) issues.push("roof_dims_without_tick");
  const products = {
    standard: qty(r.standard),
    panoramic: qty(r.panoramic),
    fullPanoramic: qty(r.fullPanoramic),
    roof: { wanted: r.roof.tick || w !== null || l !== null, widthM: w, lengthM: l },
  };
  const any =
    products.standard !== null ||
    products.panoramic !== null ||
    products.fullPanoramic !== null ||
    products.roof.wanted;
  return { products, issues: [...new Set(issues)], any };
}

/** AJ metninden köken bilgisi (iş emri §6.3). */
export function provenanceFromWarning(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!text.trim()) return out;
  if (fold(text).includes("ulke telefon kodundan atandi")) out["country_source"] = "phone";
  const m = /Telefonda ülke kodu yoktu,\s*\+(\d{1,4}) eklendi/i.exec(text);
  if (m) out["dial_code_assumed"] = `+${m[1]}`;
  return out;
}

interface RowContact {
  legacyId: string;
  type: ActivityType;
  outcome: ActivityOutcome;
  at: Date;
  estimated: boolean;
  note: string;
  kind: keyof ImportExcelReport["contacts"];
}

/** Excel satırı → temaslar, ilk dönüş, teklif zamanı ve sorunlar (H–M ve TEMAS GEÇMİŞİ). */
export function contactsFromRow(
  r: ExcelLeadRow,
  temas: readonly ExcelContactRow[],
  tz: string,
): {
  contacts: RowContact[];
  next: { legacyId: string; type: ActivityType; dueAt: Date } | null;
  issues: string[];
  hints: string[];
  firstReplyAt: Date | null;
  proposalAt: Date | null;
} {
  const issues: string[] = [];
  const hints: string[] = [];
  const day = r.leadDate;
  const at = (ymd: string, h: number, m = 0) =>
    new Date(localDayStart(ymd, 0, tz)!.getTime() + h * 3600_000 + m * MINUTE);
  const base = day ?? "2024-01-01";
  const contacts: RowContact[] = [];
  const temasRows = temas.map((t, i) => ({
    t,
    i,
    type: CHANNELS[fold(t.channel)] ?? "other",
    outcome: OUTCOMES[fold(t.outcome)] ?? ("follow_up" as ActivityOutcome),
  }));
  const temasHas = (type: ActivityType, replyOnly: boolean) =>
    temasRows.some((x) => x.type === type && (!replyOnly || isReply(x.outcome, false)));

  if (r.mailSent && !temasHas("email", false)) {
    contacts.push({
      legacyId: `excel:${r.no}:mail_sent`,
      type: "email",
      outcome: "awaiting_reply",
      at: at(base, 9),
      estimated: true,
      note: "",
      kind: "mailSent",
    });
  }
  if (r.waSent && !temasHas("whatsapp", false)) {
    contacts.push({
      legacyId: `excel:${r.no}:wa_sent`,
      type: "whatsapp",
      outcome: "awaiting_reply",
      at: at(base, 9),
      estimated: true,
      note: "",
      kind: "waSent",
    });
  }
  const reply = (
    flag: boolean,
    when: string | null,
    rawBad: boolean,
    type: ActivityType,
    key: "mail_reply" | "wa_reply",
    noFlagIssue: string,
    kind: "mailReply" | "waReply",
  ) => {
    if (!flag) {
      if (when || rawBad) {
        issues.push(noFlagIssue);
        if (when && day) {
          const [y, mo, d] = when.split("-");
          const swapped = `${y}-${d}-${mo}`;
          if (Number(d) <= 12 && swapped >= day && swapped <= calendarDay(new Date(), tz)) {
            hints.push(`No ${r.no}: ${key === "mail_reply" ? "K" : "M"} gün/ay ters girilmiş olabilir`);
          }
        }
      }
      return;
    }
    if (temasHas(type, true)) return;
    let t = at(base, 9, 1);
    let estimated = true;
    if (when && when >= MIN_DAY && (!day || when >= day)) {
      t = at(when, 9);
      estimated = false;
    } else if (when && day && when < day) issues.push("reply_before_lead");
    contacts.push({
      legacyId: `excel:${r.no}:${key}`,
      type,
      outcome: "reply_received",
      at: t,
      estimated,
      note: "",
      kind,
    });
  };
  reply(r.mailReply, r.mailReplyAt, r.mailReplyRaw, "email", "mail_reply", "k_without_j", "mailReply");
  reply(r.waReply, r.waReplyAt, r.waReplyRaw, "whatsapp", "wa_reply", "m_without_l", "waReply");

  const seq = new Map<string, number>();
  for (const x of temasRows) {
    const dayKey = (x.t.at ?? base).replace(/-/g, "");
    const k = `${dayKey}:${x.type}:${x.outcome}`;
    const n = (seq.get(k) ?? 0) + 1;
    seq.set(k, n);
    contacts.push({
      legacyId: `excel:temas:${r.no}:${k}:${n}`,
      type: x.type,
      outcome: x.outcome,
      at: at(x.t.at ?? base, 12),
      estimated: !x.t.at,
      note: x.t.note.slice(0, 4000),
      kind: "temas",
    });
  }
  // Sonraki takip: yalnız en son TEMAS satırından (tarih, sonra satır sırası).
  const latest = [...temasRows].sort((a, b) => (a.t.at ?? "").localeCompare(b.t.at ?? "") || a.i - b.i).pop();
  const next =
    latest && latest.t.nextAt
      ? {
          legacyId: `excel:temas:${r.no}:${(latest.t.at ?? base).replace(/-/g, "")}:${latest.type}:${latest.outcome}:next`,
          type: latest.type,
          dueAt: at(latest.t.nextAt, 9),
        }
      : null;

  const replies = contacts.filter((c) => isReply(c.outcome, false)).map((c) => c.at.getTime());
  const proposals = contacts.filter((c) => c.outcome === "proposal_sent").map((c) => c.at.getTime());
  return {
    contacts,
    next,
    issues,
    hints,
    firstReplyAt: replies.length ? new Date(Math.min(...replies)) : null,
    proposalAt: proposals.length ? new Date(Math.min(...proposals)) : r.proposal ? at(base, 9) : null,
  };
}

/** Ertesi iş günü (hafta içi), yerel 09:00. */
function nextBusinessDay(from: Date, tz: string, offset: number): Date {
  let d = from;
  let left = offset + 1;
  while (left > 0) {
    d = new Date(d.getTime() + DAY);
    const wd = new Date(`${calendarDay(d, tz)}T12:00:00Z`).getUTCDay();
    if (wd !== 0 && wd !== 6) left--;
  }
  return new Date(localDayStart(calendarDay(d, tz), 0, tz)!.getTime() + 9 * 3600_000);
}

export async function importExcel(db: Db, snap: ExcelSnapshot, opts: ImportExcelOptions): Promise<ImportExcelReport> {
  const tz = opts.timeZone ?? DEFAULT_TIME_ZONE;
  const now = opts.now ?? new Date();
  const logger = opts.logger ?? silentLogger;
  const clock = new FixedClock(now);
  const uow = new PgUnitOfWork(db, uuidGenerator);
  const sp: SalesPipeline = createSalesPipeline({
    uow,
    clock,
    ids: uuidGenerator,
    platforms: { enabledProviders: () => [] },
    events: { publish: async () => {} },
    logger,
    undoWindowMs: 0,
    timeZone: tz,
  });
  const directory = opts.directory ?? [];
  const overrides = opts.overrides ?? {};
  const activeSales = new Set(directory.filter((u) => u.active && u.role !== "viewer").map((u) => u.id));
  const report: ImportExcelReport = {
    rows: snap.rows.length,
    contactRows: snap.contacts.length,
    territoryRows: snap.territories.length,
    owners: [],
    territory: { written: [], existing: 0, skipped: 0, conflicts: [] },
    leads: { created: 0, enriched: [], rerun: 0, personConflicts: [], renumbered: [], noIdentity: [], failed: [] },
    stages: {},
    newLeadStages: {},
    contacts: { mailSent: 0, waSent: 0, mailReply: 0, waReply: 0, temas: 0, next: 0 },
    fields: { status: 0, products: 0, formAnswers: 0, platform: 0, campaign: 0 },
    fieldConflicts: 0,
    issues: {},
    issueLeads: 0,
    hints: [],
    phoneUnreadable: 0,
    seeds: {},
    seedDays: {},
    pool: { open: 0, assigned: {} },
    candidates: { won: [], lost: [] },
    changes: 0,
  };
  const change = () => report.changes++;

  // ---- Sorumlu etiketleri (E ve LİSTELER I) bir kez çözülür.
  const matches = new Map<string, TeamMatch>();
  const matchOf = (label: string): TeamMatch => {
    const key = label.trim();
    let m = matches.get(key);
    if (!m) {
      m = key ? matchTeamLabel(key, directory, overrides) : { kind: "pool", via: "unassigned" };
      matches.set(key, m);
    }
    return m;
  };
  const ownerCounts = new Map<string, number>();
  for (const r of snap.rows) ownerCounts.set(r.owner.trim(), (ownerCounts.get(r.owner.trim()) ?? 0) + 1);
  for (const [label, count] of ownerCounts) {
    report.owners.push({ label, name: labelParts(label).name, count, match: matchOf(label) });
  }

  // ---- Bölge kuralları: yalnız eksik ülke yazılır; farklı mevcut kural çakışmadır.
  for (const t of snap.territories) {
    const cc = parseExcelCountry(t.country);
    const m = matchOf(t.owner);
    if (!cc || m.kind !== "user") {
      report.territory.skipped++;
      continue;
    }
    const existing = await db.query<{ assigned_user_id: string }>(
      "SELECT assigned_user_id FROM territory_rules WHERE country_code = $1",
      [cc],
    );
    if (existing[0]) {
      if (existing[0].assigned_user_id === m.userId) report.territory.existing++;
      else report.territory.conflicts.push(cc);
      continue;
    }
    await db.query(
      "INSERT INTO territory_rules (country_code, assigned_user_id, fallback_user_id) VALUES ($1, $2, NULL)",
      [cc, m.userId],
    );
    report.territory.written.push(cc);
    change();
  }

  const temasByNo = new Map<string, ExcelContactRow[]>();
  for (const c of snap.contacts) temasByNo.set(c.no, [...(temasByNo.get(c.no) ?? []), c]);

  const importedIds: { leadId: string; no: string; row: ExcelLeadRow }[] = [];
  const bump = (rec: Record<string, number>, k: string) => (rec[k] = (rec[k] ?? 0) + 1);

  for (const r of snap.rows) {
    const temas = temasByNo.get(r.no) ?? [];
    const derived = contactsFromRow(r, temas, tz);
    const prod = productsFromRow(r);
    const statusR = statusFromExcel(r.status);
    const issues = [...derived.issues, ...prod.issues];
    if (statusR === "unknown") issues.push("status_unknown");
    if (r.warning.trim()) issues.push("excel_warning");
    report.hints.push(...derived.hints);
    const m = matchOf(r.owner);
    const ownerId = m.kind === "user" ? m.userId : null;
    const ownerName = labelParts(r.owner).name;
    const excelOwner = ownerName && fold(ownerName) !== fold(UNASSIGNED_LABEL) ? ownerName : null;
    const answers = normalizeFormAnswers({
      install_site: r.installSite || undefined,
      install_timeline: r.installTimeline || undefined,
      customer_profile: r.profile || undefined,
      court_count: r.courtCount || undefined,
    });
    const surface = r.platform ? (SURFACES[fold(r.platform)] ?? null) : null;
    const extra: Record<string, unknown> = {
      excel_no: r.no,
      ...(excelOwner ? { excel_owner: excelOwner } : {}),
      ...(r.warning.trim() ? { excel_warning: r.warning.trim().slice(0, 500) } : {}),
      ...(issues.length ? { import_issues: [...new Set(issues)] } : {}),
      ...provenanceFromWarning(r.warning),
      ...(answers.unmatched.length ? { unmatched_answers: answers.unmatched } : {}),
    };
    const createdAt = r.leadDate ? new Date(localDayStart(r.leadDate, 0, tz)!.getTime() + 9 * 3600_000) : now;

    // ---- Eşleştirme (§6.4).
    const emailR = r.email ? Email.parse(r.email) : null;
    const email = emailR && emailR.ok ? emailR.value.value : null;
    const phoneR = r.phone ? PhoneNumber.parse(r.phone, parseExcelCountry(r.country) ?? undefined) : null;
    const phone = phoneR && phoneR.ok ? phoneR.value.e164 : null;
    if (!email && !phone) {
      report.leads.noIdentity.push(r.no);
      continue;
    }
    if (r.phone && !phone) report.phoneUnreadable++;

    let lead: Lead | undefined = await uow.run((repos) =>
      repos.leads.findByPlatformId("import", `${PLATFORM_PREFIX}${r.no}`),
    );
    if (!lead) {
      const byNo = await db.query<{ id: string }>(
        "SELECT id FROM leads WHERE extra_answers->>'excel_no' = $1 LIMIT 1",
        [r.no],
      );
      if (byNo[0]) lead = await uow.run((repos) => repos.leads.findById(byNo[0]!.id));
    }
    let mode: "rerun" | "enrich" | "create";
    if (lead) {
      const same = (email !== null && lead.email === email) || (phone !== null && lead.phoneE164 === phone);
      if (!same) {
        report.leads.renumbered.push(r.no);
        continue;
      }
      mode = "rerun";
    } else {
      const [pe, pp] = await uow.run(async (repos) => [
        email ? await repos.persons.findByEmailOrPhone(email, null) : undefined,
        phone ? await repos.persons.findByEmailOrPhone(null, phone) : undefined,
      ]);
      if (pe && pp && pe.id !== pp.id) {
        report.leads.personConflicts.push(r.no);
        continue;
      }
      const person = pe ?? pp;
      const open = person
        ? (await uow.run((repos) => repos.leads.list({ personId: person.id, includeTest: true }))).filter(
            (l) => !isTerminal(l.currentStage),
          )
        : [];
      if (open[0]) {
        lead = open[0];
        mode = "enrich";
        report.leads.enriched.push({ leadId: lead.id, no: r.no });
      } else mode = "create";
    }

    if (mode === "create") {
      clock.set(now);
      const created = await sp.createLead.execute({
        source: "import",
        platformLeadId: `${PLATFORM_PREFIX}${r.no}`,
        fullName: r.fullName || `Excel ${r.no}`,
        email,
        phone: r.phone || null,
        country: parseExcelCountry(r.country),
        notes: r.notes,
        campaign: { campaignName: r.campaign || null },
        customerStatus: statusR === "unknown" ? null : statusR,
        ...(prod.any ? { products: prod.products } : {}),
        installSite: answers.installSite,
        installTimeline: answers.installTimeline,
        customerProfile: answers.customerProfile,
        courtCountBand: answers.courtCountBand,
        adSurface: surface,
        extraAnswers: extra,
        createdAt,
        assignedUserId: ownerId,
        actor: IMPORT_ACTOR,
        parseMode: "lenient",
        invalidPhone: "drop",
      });
      if (!created.ok) {
        report.leads.failed.push({ no: r.no, code: created.error.code });
        continue;
      }
      lead = created.value.lead;
      report.leads.created++;
      change();
      if (statusR && statusR !== "unknown") report.fields.status++;
      if (prod.any) report.fields.products++;
      if (answers.installSite || answers.installTimeline || answers.customerProfile || answers.courtCountBand)
        report.fields.formAnswers++;
      if (surface) report.fields.platform++;
      if (r.campaign) report.fields.campaign++;
    } else {
      // Zenginleştirme ve yeniden çalıştırma: yalnız boş alanlar, dolu ve farklı değer çakışmadır.
      const l = lead!;
      if (mode === "rerun") report.leads.rerun++;
      const fill: Record<string, unknown> = {};
      const conflict = (cur: unknown, want: unknown) => {
        if (cur !== null && cur !== "" && want !== null && want !== "" && cur !== want) report.fieldConflicts++;
      };
      for (const [k, want] of [
        ["installSite", answers.installSite],
        ["installTimeline", answers.installTimeline],
        ["customerProfile", answers.customerProfile],
        ["courtCountBand", answers.courtCountBand],
        ["adSurface", surface],
      ] as const) {
        const cur = l[k];
        if (cur === null && want) fill[k] = want;
        else conflict(cur, want);
      }
      if (prod.any && !hasAnyProduct(l.products)) {
        const p = parseProductPrefs(prod.products);
        if (p.ok && !samePrefs(p.value, l.products)) fill["products"] = p.value;
      }
      if (!l.notes && r.notes) fill["notes"] = r.notes;
      if (Object.keys(fill).length) {
        const u = await sp.updateLeadFields.execute({ leadId: l.id, fields: fill, actor: IMPORT_ACTOR });
        if (u.ok) change();
      }
      if (l.customerStatus === null && statusR && statusR !== "unknown") {
        await sp.setCustomerStatus.execute({ leadId: l.id, status: statusR, actor: IMPORT_ACTOR });
        change();
      } else conflict(l.customerStatus, statusR === "unknown" ? null : statusR);
      if (!l.campaign.campaignName && r.campaign) {
        await db.query("UPDATE leads SET campaign_name = $2 WHERE id = $1 AND campaign_name IS NULL", [
          l.id,
          r.campaign,
        ]);
        change();
      }
      const missing = Object.fromEntries(
        Object.entries(extra).filter(([k, v]) => JSON.stringify(l.extraAnswers[k]) !== JSON.stringify(v)),
      );
      if (Object.keys(missing).length) {
        await uow.run((repos) => repos.leads.mergeExtraAnswers(l.id, missing, now));
        change();
      }
      if (
        ownerId &&
        l.assignedUserId !== ownerId &&
        (l.assignedUserId === null || !activeSales.has(l.assignedUserId))
      ) {
        const a = await sp.assignLead.execute({ leadId: l.id, toUserId: ownerId, actor: IMPORT_ACTOR });
        if (a.ok) change();
      }
      lead = (await uow.run((repos) => repos.leads.findById(l.id))) ?? l;
    }
    const l = lead!;
    importedIds.push({ leadId: l.id, no: r.no, row: r });
    if (issues.length) report.issueLeads++;
    for (const i of new Set(issues)) bump(report.issues, i);

    // ---- Temaslar (legacy id ile; yeniden çalıştırmada eklenmez).
    const doneBy = l.assignedUserId;
    for (const c of derived.contacts) {
      const added = await uow.run(async (repos) => {
        if (await repos.activities.findByLegacyId(c.legacyId)) return false;
        const a: Activity = {
          id: uuidGenerator.next(),
          leadId: l.id,
          type: c.type,
          subject: DEFAULT_SUBJECTS[c.type],
          dueAt: c.at,
          doneAt: c.at,
          notes: "",
          autoCreated: false,
          createdByChangeId: null,
          createdByUserId: IMPORT_ACTOR.userId,
          legacyId: c.legacyId,
          ...NO_CONTACT_FIELDS,
          outcome: c.outcome,
          resultNote: c.note,
          doneByUserId: doneBy,
          dateEstimated: c.estimated,
          createdAt: now,
          updatedAt: now,
        };
        await repos.activities.insert(a);
        return true;
      });
      if (added) {
        report.contacts[c.kind]++;
        change();
      }
    }
    if (derived.next) {
      const n = derived.next;
      const added = await uow.run(async (repos) => {
        if (await repos.activities.findByLegacyId(n.legacyId)) return false;
        await repos.activities.insert({
          id: uuidGenerator.next(),
          leadId: l.id,
          type: n.type,
          subject: FOLLOW_UP_SUBJECTS[n.type],
          dueAt: n.dueAt,
          doneAt: null,
          notes: "",
          autoCreated: false,
          createdByChangeId: null,
          createdByUserId: IMPORT_ACTOR.userId,
          legacyId: n.legacyId,
          ...NO_CONTACT_FIELDS,
          createdAt: now,
          updatedAt: now,
        });
        return true;
      });
      if (added) {
        report.contacts.next++;
        change();
      }
    }

    // ---- Aşama (§6.5): teklif → PROPOSAL; dönüş → CONTACTED; yalnız ileri. Otomatik LOST/WON yok.
    const target: StageCode | null = derived.proposalAt ? "PROPOSAL" : derived.firstReplyAt ? "CONTACTED" : null;
    const when = derived.proposalAt ?? derived.firstReplyAt;
    if (target && when && !isTerminal(l.currentStage) && stageIndex(l.currentStage) < stageIndex(target)) {
      clock.set(when.getTime() <= now.getTime() ? when : now);
      const moved = await sp.changeLeadStage.execute({
        leadId: l.id,
        target,
        actor: IMPORT_ACTOR,
        skipFollowUp: when.getTime() + 3 * DAY < now.getTime(),
      });
      clock.set(now);
      if (moved.ok) {
        bump(report.stages, target);
        change();
      } else report.leads.failed.push({ no: r.no, code: moved.error.code });
    }
    const final = await uow.run((repos) => repos.leads.findById(l.id));
    if (mode === "create" && final) bump(report.newLeadStages, final.currentStage);
    const st = statusR === "unknown" ? null : statusR;
    if (fold(temas.at(-1)?.outcome ?? "") === "anlasma saglandi" || st === "buyer_ready")
      report.candidates.won.push(r.no);
    if (st === "not_interested" || fold(temas.at(-1)?.outcome ?? "") === "olumsuz") report.candidates.lost.push(r.no);
  }

  // ---- Havuz atama (--apply-to-pool): kurallı ülkelerin açık havuz lead'leri; Excel'de sorumlusu olan atlanır.
  const rules = await db.query<{ country_code: string; assigned_user_id: string; fallback_user_id: string | null }>(
    "SELECT country_code, assigned_user_id, fallback_user_id FROM territory_rules",
  );
  const pool = (await sp.queries.list({ actor: IMPORT_ACTOR, owner: null, limit: 5000 })).filter(
    (l) => !isTerminal(l.currentStage),
  );
  report.pool.open = pool.length;
  if (opts.applyToPool) {
    for (const l of pool) {
      if (typeof l.extraAnswers["excel_owner"] === "string") continue;
      const rule = rules.find((x) => x.country_code.trim() === (l.country ?? ""));
      if (!rule) continue;
      const to =
        activeSales.size === 0 || activeSales.has(rule.assigned_user_id)
          ? rule.assigned_user_id
          : rule.fallback_user_id;
      if (!to) continue;
      const a = await sp.assignLead.execute({ leadId: l.id, toUserId: to, actor: IMPORT_ACTOR });
      if (a.ok) {
        bump(report.pool.assigned, to);
        change();
      }
    }
  }

  // ---- Takip tohumu (§6.3, soru 6): atanmış, açık, açık aktivitesi olmayan Excel lead'ine bir takip.
  if (opts.seedFollowUps !== false) {
    const items = await sp.queries.list({ actor: IMPORT_ACTOR, scope: "excel", limit: 5000 });
    const byNo = new Map(importedIds.map((x) => [x.leadId, x]));
    const candidates = items.filter(
      (l) => l.assignedUserId !== null && !isTerminal(l.currentStage) && l.openActivities === 0 && byNo.has(l.id),
    );
    const rank = (l: (typeof items)[number]) =>
      l.hot && l.contact.state === "never" ? 0 : l.contact.state === "never" ? 1 : l.hot ? 2 : 3;
    candidates.sort((a, b) => rank(a) - rank(b) || a.createdAt.getTime() - b.createdAt.getTime());
    const perRep = new Map<string, number>();
    for (const l of candidates) {
      const rep = l.assignedUserId!;
      const no = byNo.get(l.id)!.no;
      const legacyId = `excel:seed:${no}`;
      const k = perRep.get(rep) ?? 0;
      const dueAt = nextBusinessDay(now, tz, Math.floor(k / 10));
      const lastType = l.contact.lastType;
      const type: ActivityType = lastType === "email" || lastType === "whatsapp" ? lastType : "call";
      const added = await uow.run(async (repos) => {
        if (await repos.activities.findByLegacyId(legacyId)) return false;
        await repos.activities.insert({
          id: uuidGenerator.next(),
          leadId: l.id,
          type,
          subject: FOLLOW_UP_SUBJECTS[type],
          dueAt,
          doneAt: null,
          notes: "",
          autoCreated: true,
          createdByChangeId: null,
          createdByUserId: IMPORT_ACTOR.userId,
          legacyId,
          ...NO_CONTACT_FIELDS,
          createdAt: now,
          updatedAt: now,
        });
        return true;
      });
      if (added) {
        perRep.set(rep, k + 1);
        bump(report.seeds, rep);
        report.seedDays[rep] = Math.floor(k / 10) + 1;
        change();
      }
    }
  }
  return report;
}

function samePrefs(a: ProductPrefs, b: ProductPrefs): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
