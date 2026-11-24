/**
 * Satışçının kişisel Excel takip dosyasını CRM'le eşitleme (2026-11-23, Amro ve Salah dosyaları). Mevcut içe aktarmadan
 * (importExcel) farkları:
 *  - Her dosya bir **liste**dir (`amro`, `salah`). Numaralar listeye aittir: yeni lead kimliği `excel:<liste>:<No>`,
 *    `excel_no` = `<liste>-<No>`. MDM ana listesinin `excel_no` 1–160 numaralarıyla karışmaz.
 *  - Mevcut lead **kişiyle** (e-posta, telefon) bulunur; Excel No ile değil.
 *  - **Kesim zamanı (`asOf`)**: Excel'in son düzenlenme zamanı. Lead'in CRM'deki son elle düzenlemesi bundan eskiyse
 *    Excel esastır (Excel'in tuttuğu alanlar Excel'deki değere çekilir); yeniyse CRM esastır (yalnız boş alan dolar).
 *
 * Excel esasta da: boş hücre CRM'deki değeri silmez; aşama yalnız ileri gider (LOST/WON/QUALIFIED geri alınmaz);
 * eski not silinmez, "Önceki not:" altında kalır; satışçının kaydettiği temaslar silinmez. Yalnız ilk içe aktarmanın
 * ana listeden açtığı, hiç dokunulmamış "mail atıldı" teması Excel "Mail ✘" diyorsa silinir.
 *
 * İki aşama: `planExcelSync` yalnız okur ve satır başına kararı çıkarır (kuru koşu bunu basar); `applyExcelSync`
 * aynı planı uygular ve işlemden önceki/sonraki satırları geri yükleme noktasına yazar (checkpoints.ts).
 * Kişisel veri rapora yazılmaz: liste, Excel No, lead kimliği, alan adları ve sayılar.
 */
import type { Db } from "../modules/shared/db";
import { DAY, FixedClock, silentLogger, uuidGenerator, type Logger } from "../modules/shared/kernel";
import { Email, PhoneNumber } from "../modules/shared/normalization";
import { fold, normalizeFormAnswers } from "../modules/lead-intake/application";
import { createSalesPipeline, localDayStart, type SalesPipeline } from "../modules/sales-pipeline/application";
import {
  DEFAULT_SUBJECTS,
  DEFAULT_TIME_ZONE,
  NO_CONTACT_FIELDS,
  calendarDay,
  isReply,
  isTerminal,
  parseProductPrefs,
  stageIndex,
  type Activity,
  type CustomerStatus,
  type Lead,
  type StageCode,
} from "../modules/sales-pipeline/domain";
import { PgUnitOfWork } from "../modules/sales-pipeline/infrastructure";
import { captureLeads, diffSnapshots, saveCheckpoint } from "./checkpoints";
import { parseExcelCountry, type ExcelLeadRow, type ExcelSnapshot } from "./excelSnapshot";
import { contactsFromRow, IMPORT_ACTOR, productsFromRow, statusFromExcel } from "./importExcel";
import { labelParts } from "./teamMatch";

export interface SyncList {
  /** Küçük harf, rakam ve tire (ör. "amro"). */
  name: string;
  /** Listenin sorumlusu (KullaniciID). */
  ownerId: string;
  snapshot: ExcelSnapshot;
}

export interface SyncExcelOptions {
  /** Excel'in son düzenlenme zamanı. */
  asOf: Date;
  now?: Date;
  timeZone?: string;
  logger?: Logger;
}

export type SyncMode = "excel" | "crm" | "create" | "skip";

type Contact = ReturnType<typeof contactsFromRow>["contacts"][number];

export interface RowPlan {
  list: string;
  no: string;
  mode: SyncMode;
  /** skip nedeni ya da notlar (kod). */
  reason?: string;
  leadId: string | null;
  lastEditAt: string | null;
  /** Değişecek alanların adları (rapor). */
  changes: string[];
  fields: Record<string, unknown>;
  status: CustomerStatus | null;
  campaign: string | null;
  ownerTo: string | null;
  extra: Record<string, unknown>;
  removeActivityIds: string[];
  addContacts: Contact[];
  stage: { target: StageCode; when: Date } | null;
  /** Aynı kişinin aynı anda açılmış kopyaları (gizlenir). */
  hideDuplicates: string[];
  dateFixes: string[];
  create: CreatePayload | null;
}

interface CreatePayload {
  fullName: string;
  email: string | null;
  phone: string | null;
  country: string | null;
  notes: string;
  campaign: string | null;
  status: CustomerStatus | null;
  products: { productId: number; qty: number }[] | null;
  answers: ReturnType<typeof normalizeFormAnswers>;
  adSurface: string | null;
  createdAt: Date;
}

export interface SyncReport {
  rows: number;
  counts: Record<SyncMode, number>;
  plans: RowPlan[];
  /** Uygulandıysa. */
  applied?: {
    checkpointId: string;
    created: number;
    updated: number;
    contactsAdded: number;
    contactsRemoved: number;
    stageMoves: Partial<Record<StageCode, number>>;
    hidden: number;
    failed: { list: string; no: string; code: string }[];
  };
}

const SURFACES: Record<string, string> = { instagram: "ig", facebook: "fb", ig: "ig", fb: "fb" };
const PREVIOUS_NOTE = "Önceki not:";
/** İlk içe aktarmanın ana listeden açtığı "mail atıldı" teması (`excel:<No>:mail_sent`). */
const MASTER_MAIL_SENT = /^excel:\d+:mail_sent$/;

/** Excel notu yazılır; farklı eski not silinmez, altına eklenir. */
export function mergedNote(current: string, excel: string): string | null {
  const want = excel.trim();
  const cur = current.trim();
  if (!want || cur === want || cur.startsWith(`${want}\n\n${PREVIOUS_NOTE}`) || cur.includes(want)) return null;
  return cur ? `${want}\n\n${PREVIOUS_NOTE}\n${cur}` : want;
}

/**
 * Dönüş tarihi lead tarihinden önceyse ve gün ile ay yer değiştirince lead tarihi ile bugün arasına düşüyorsa, ters
 * girilmiş kabul edilir (ör. 11.03 → 03.11).
 */
export function fixSwappedDates(r: ExcelLeadRow, today: string): { row: ExcelLeadRow; fixes: string[] } {
  const fixes: string[] = [];
  const row = { ...r };
  for (const k of ["mailReplyAt", "waReplyAt"] as const) {
    const v = row[k];
    if (!v || !row.leadDate || v >= row.leadDate) continue;
    const [y, m, d] = v.split("-");
    if (Number(d) > 12) continue;
    const swapped = `${y}-${d}-${m}`;
    if (swapped >= row.leadDate && swapped <= today) {
      row[k] = swapped;
      fixes.push(k === "mailReplyAt" ? "mail_reply_date_swapped" : "wa_reply_date_swapped");
    }
  }
  return { row, fixes };
}

/** CRM'de lead'in son elle düzenlenme zamanı (içe aktarma ve taşıma aktörleri sayılmaz; `updated_at` her yazımda artar). */
export async function lastHumanEdit(db: Db, leadId: string): Promise<Date | null> {
  const rows = await db.query<{ t: unknown }>(
    `SELECT GREATEST(
       (SELECT updated_at FROM leads WHERE id = $1),
       (SELECT max(occurred_at) FROM lead_stage_events
         WHERE lead_id = $1 AND actor_user_id IS NOT NULL AND actor_user_id NOT IN ('import', 'migration')),
       (SELECT max(GREATEST(created_at, updated_at)) FROM activities
         WHERE lead_id = $1 AND created_by_user_id IS DISTINCT FROM 'import'
           AND created_by_user_id IS DISTINCT FROM 'migration'),
       (SELECT max(updated_at) FROM activities WHERE lead_id = $1 AND updated_at > created_at + interval '1 second'),
       (SELECT max(created_at) FROM contact_logs WHERE lead_id = $1 AND actor_user_id NOT IN ('import', 'migration')),
       (SELECT max(uploaded_at) FROM lead_attachments WHERE lead_id = $1),
       (SELECT max(occurred_at) FROM user_action_logs WHERE lead_id = $1)
     ) AS t`,
    [leadId],
  );
  const t = rows[0]?.t;
  return t ? new Date(t as string) : null;
}

const sameProducts = (
  a: readonly { productId: number; qty: number }[],
  b: readonly { productId: number; qty: number }[],
) => {
  const k = (x: readonly { productId: number; qty: number }[]) =>
    JSON.stringify([...x].map((p) => [p.productId, p.qty]).sort((p, q) => p[0]! - q[0]!));
  return k(a) === k(b);
};

function pipeline(db: Db, clock: FixedClock, tz: string, logger: Logger): { sp: SalesPipeline; uow: PgUnitOfWork } {
  const uow = new PgUnitOfWork(db, uuidGenerator);
  const sp = createSalesPipeline({
    uow,
    clock,
    ids: uuidGenerator,
    platforms: { enabledProviders: () => [] },
    events: { publish: async () => {} },
    logger,
    undoWindowMs: 0,
    timeZone: tz,
  });
  return { sp, uow };
}

/** Yalnız okur: satır başına karar ve yapılacak değişiklikler. */
export async function planExcelSync(db: Db, lists: readonly SyncList[], opts: SyncExcelOptions): Promise<SyncReport> {
  const tz = opts.timeZone ?? DEFAULT_TIME_ZONE;
  const now = opts.now ?? new Date();
  const today = calendarDay(opts.asOf, tz);
  const { uow } = pipeline(db, new FixedClock(now), tz, opts.logger ?? silentLogger);
  const plans: RowPlan[] = [];
  const claimed = new Set<string>();

  for (const list of lists) {
    if (!/^[a-z0-9-]{1,32}$/.test(list.name)) throw new Error(`Liste adı geçersiz: ${list.name}`);
    for (const raw of list.snapshot.rows) {
      const { row: r, fixes } = fixSwappedDates(raw, today);
      const key = `${list.name}-${r.no}`;
      const plan: RowPlan = {
        list: list.name,
        no: r.no,
        mode: "skip",
        leadId: null,
        lastEditAt: null,
        changes: [],
        fields: {},
        status: null,
        campaign: null,
        ownerTo: null,
        extra: {},
        removeActivityIds: [],
        addContacts: [],
        stage: null,
        hideDuplicates: [],
        dateFixes: fixes,
        create: null,
      };
      plans.push(plan);

      const emailR = r.email ? Email.parse(r.email) : null;
      const email = emailR && emailR.ok ? emailR.value.value : null;
      const country = parseExcelCountry(r.country);
      const phoneR = r.phone ? PhoneNumber.parse(r.phone, country ?? undefined) : null;
      const phone = phoneR && phoneR.ok ? phoneR.value.e164 : null;
      if (!email && !phone) {
        plan.reason = "no_identity";
        continue;
      }

      // ---- Eşleştirme: önce bu listenin kimliği (yeniden çalıştırma), sonra kişi.
      const own = await uow.run((repos) => repos.leads.findByPlatformId("import", `excel:${list.name}:${r.no}`));
      type Candidate = {
        id: string;
        created_at: unknown;
        email: string | null;
        phone_e164: string | null;
        deleted: boolean;
      };
      const found: Candidate[] = own
        ? [
            {
              id: own.id,
              created_at: own.createdAt,
              email: own.email,
              phone_e164: own.phoneE164,
              deleted: !!own.deletion,
            },
          ]
        : await db.query<Candidate>(
            `SELECT id, created_at, email, phone_e164, deleted_at IS NOT NULL AS deleted FROM leads
              WHERE NOT is_test AND ((email IS NOT NULL AND lower(email) = $1) OR (phone_e164 IS NOT NULL AND phone_e164 = $2))
              ORDER BY created_at, id`,
            [email, phone],
          );
      // Yöneticinin sildiği lead (migration 0024): satır atlanır; ne güncellenir ne de yeniden açılır.
      if (found.some((c) => c.deleted)) {
        plan.reason = "lead_deleted";
        continue;
      }
      const candidates = found.filter((c) => !claimed.has(c.id));

      const derived = contactsFromRow({ ...r, no: key }, [], tz);
      const prod = productsFromRow(r);
      const statusR = statusFromExcel(r.status);
      const status = statusR === "unknown" ? null : statusR;
      if (statusR === "unknown") plan.reason = "status_unknown";
      const answers = normalizeFormAnswers({
        install_site: r.installSite || undefined,
        install_timeline: r.installTimeline || undefined,
        customer_profile: r.profile || undefined,
        court_count: r.courtCount || undefined,
      });
      const surface = r.platform ? (SURFACES[fold(r.platform)] ?? null) : null;
      const excelNote = [r.notes.trim(), prod.roofNote ?? ""].filter(Boolean).join("\n");
      const stageTarget: StageCode | null = derived.proposalAt ? "PROPOSAL" : derived.firstReplyAt ? "CONTACTED" : null;
      const stageWhen = derived.proposalAt ?? derived.firstReplyAt;
      const issues = [...new Set([...derived.issues, ...prod.issues, ...fixes])];
      plan.extra = {
        excel_list: list.name,
        excel_list_no: r.no,
        ...(labelParts(r.owner).name ? { excel_owner: labelParts(r.owner).name } : {}),
        ...(issues.length ? { excel_sync_issues: issues } : {}),
      };

      if (!candidates[0]) {
        plan.mode = "create";
        plan.create = {
          fullName: r.fullName || `Excel ${key}`,
          email,
          phone: r.phone || null,
          country,
          notes: excelNote,
          campaign: r.campaign || null,
          status,
          products: prod.any ? prod.products : null,
          answers,
          adSurface: surface,
          createdAt: r.leadDate ? new Date(localDayStart(r.leadDate, 0, tz)!.getTime() + 9 * 3600_000) : now,
        };
        plan.extra = { excel_no: key, ...plan.extra };
        plan.ownerTo = list.ownerId;
        plan.addContacts = derived.contacts;
        plan.stage = stageTarget && stageWhen ? { target: stageTarget, when: stageWhen } : null;
        plan.changes.push("lead");
        continue;
      }

      const primary = candidates[0];
      claimed.add(primary.id);
      const lead = (await uow.run((repos) => repos.leads.findById(primary.id)))!;
      plan.leadId = lead.id;
      // Aynı kişinin bir dakika içinde açılmış birebir kopyası (çift form çekimi).
      for (const c of candidates.slice(1)) {
        const dt = Math.abs(new Date(c.created_at as string).getTime() - lead.createdAt.getTime());
        if (dt <= 60_000 && c.email === lead.email && c.phone_e164 === lead.phoneE164) {
          plan.hideDuplicates.push(c.id);
          claimed.add(c.id);
        }
      }
      if (plan.hideDuplicates.length) plan.changes.push("duplicate_hidden");

      const last = await lastHumanEdit(db, lead.id);
      plan.lastEditAt = last ? last.toISOString() : null;
      const excelWins = !last || last.getTime() <= opts.asOf.getTime();
      plan.mode = excelWins ? "excel" : "crm";
      planExisting(plan, lead, {
        excelWins,
        answers,
        surface,
        prod,
        excelNote,
        status,
        campaign: r.campaign || null,
        ownerId: list.ownerId,
        contacts: derived.contacts,
        stageTarget,
        stageWhen,
      });

      const acts = await uow.run((repos) => repos.activities.listByLead(lead.id));
      if (excelWins && !r.mailSent) {
        plan.removeActivityIds = acts
          .filter(
            (a) =>
              a.type === "email" &&
              a.createdByUserId === IMPORT_ACTOR.userId &&
              a.legacyId !== null &&
              MASTER_MAIL_SENT.test(a.legacyId) &&
              a.updatedAt.getTime() - a.createdAt.getTime() <= 1000,
          )
          .map((a) => a.id);
        if (plan.removeActivityIds.length) plan.changes.push("contact_removed");
      }
      const keep = acts.filter((a) => !plan.removeActivityIds.includes(a.id) && a.doneAt !== null);
      const legacy = new Set(acts.map((a) => a.legacyId).filter(Boolean));
      plan.addContacts = plan.addContacts.filter((c) => {
        if (legacy.has(c.legacyId)) return false;
        const reply = isReply(c.outcome, false);
        return !keep.some((a) => a.type === c.type && (!reply || isReply(a.outcome, a.customerReplied)));
      });
      if (plan.addContacts.length) plan.changes.push("contact_added");
    }
  }
  const counts: Record<SyncMode, number> = { excel: 0, crm: 0, create: 0, skip: 0 };
  for (const p of plans) counts[p.mode]++;
  return { rows: plans.length, counts, plans };
}

function planExisting(
  plan: RowPlan,
  l: Lead,
  x: {
    excelWins: boolean;
    answers: ReturnType<typeof normalizeFormAnswers>;
    surface: string | null;
    prod: ReturnType<typeof productsFromRow>;
    excelNote: string;
    status: CustomerStatus | null;
    campaign: string | null;
    ownerId: string;
    contacts: Contact[];
    stageTarget: StageCode | null;
    stageWhen: Date | null;
  },
): void {
  const set = (k: string, v: unknown) => {
    plan.fields[k] = v;
    plan.changes.push(k);
  };
  const take = (cur: unknown, want: unknown) =>
    want !== null && want !== undefined && want !== "" && cur !== want && (x.excelWins || cur === null || cur === "");
  for (const [k, want] of [
    ["installSite", x.answers.installSite],
    ["installTimeline", x.answers.installTimeline],
    ["customerProfile", x.answers.customerProfile],
    ["courtCountBand", x.answers.courtCountBand],
    ["adSurface", x.surface],
  ] as const) {
    if (take(l[k], want)) set(k, want);
  }
  if (x.prod.any && (x.excelWins || l.products.length === 0) && !sameProducts(l.products, x.prod.products)) {
    const p = parseProductPrefs(x.prod.products);
    if (p.ok) set("products", p.value);
  }
  const note = x.excelWins ? mergedNote(l.notes, x.excelNote) : !l.notes.trim() && x.excelNote ? x.excelNote : null;
  if (note) set("notes", note);
  if (take(l.customerStatus, x.status)) {
    plan.status = x.status;
    plan.changes.push("customerStatus");
  }
  if (take(l.campaign.campaignName, x.campaign)) {
    plan.campaign = x.campaign;
    plan.changes.push("campaign");
  }
  if (l.assignedUserId !== x.ownerId && (x.excelWins || l.assignedUserId === null)) {
    plan.ownerTo = x.ownerId;
    plan.changes.push("owner");
  }
  const missing = Object.entries(plan.extra).filter(
    ([k, v]) => JSON.stringify(l.extraAnswers[k]) !== JSON.stringify(v),
  );
  plan.extra = Object.fromEntries(missing);
  if (missing.length) plan.changes.push("excel_list");
  plan.addContacts = x.contacts;
  if (
    x.excelWins &&
    x.stageTarget &&
    x.stageWhen &&
    !isTerminal(l.currentStage) &&
    stageIndex(l.currentStage) < stageIndex(x.stageTarget)
  ) {
    plan.stage = { target: x.stageTarget, when: x.stageWhen };
    plan.changes.push(`stage:${x.stageTarget}`);
  }
}

export interface ApplyExcelSyncOptions extends SyncExcelOptions {
  /** Geri yükleme noktasının adı ve işlemi yapan. */
  label: string;
  actorId: string;
}

/** Planı uygular; işlemden önceki ve sonraki satırlar geri yükleme noktasına yazılır (hata olsa da). */
export async function applyExcelSync(
  db: Db,
  report: SyncReport,
  opts: ApplyExcelSyncOptions,
): Promise<NonNullable<SyncReport["applied"]>> {
  const tz = opts.timeZone ?? DEFAULT_TIME_ZONE;
  const now = opts.now ?? new Date();
  const clock = new FixedClock(now);
  const { sp, uow } = pipeline(db, clock, tz, opts.logger ?? silentLogger);
  const existing = [...new Set(report.plans.flatMap((p) => [...(p.leadId ? [p.leadId] : []), ...p.hideDuplicates]))];
  const before = await captureLeads(db, existing);
  const created: string[] = [];
  const out: NonNullable<SyncReport["applied"]> = {
    checkpointId: "",
    created: 0,
    updated: 0,
    contactsAdded: 0,
    contactsRemoved: 0,
    stageMoves: {},
    hidden: 0,
    failed: [],
  };
  const fail = (p: RowPlan, code: string) => out.failed.push({ list: p.list, no: p.no, code });
  let error: unknown = null;
  try {
    for (const p of report.plans) {
      if (p.mode === "skip" || p.changes.length === 0) continue;
      let leadId = p.leadId;
      if (p.mode === "create" && p.create) {
        const c = p.create;
        clock.set(now);
        const res = await sp.createLead.execute({
          source: "import",
          platformLeadId: `excel:${p.list}:${p.no}`,
          fullName: c.fullName,
          email: c.email,
          phone: c.phone,
          country: c.country,
          notes: c.notes,
          campaign: { campaignName: c.campaign },
          customerStatus: c.status,
          ...(c.products ? { products: c.products } : {}),
          installSite: c.answers.installSite,
          installTimeline: c.answers.installTimeline,
          customerProfile: c.answers.customerProfile,
          courtCountBand: c.answers.courtCountBand,
          adSurface: c.adSurface,
          extraAnswers: p.extra,
          createdAt: c.createdAt,
          assignedUserId: p.ownerTo,
          actor: IMPORT_ACTOR,
          parseMode: "lenient",
          invalidPhone: "drop",
        });
        if (!res.ok) {
          fail(p, res.error.code);
          continue;
        }
        leadId = res.value.lead.id;
        created.push(leadId);
        out.created++;
      } else if (leadId) {
        if (Object.keys(p.fields).length) {
          const u = await sp.updateLeadFields.execute({ leadId, fields: p.fields, actor: IMPORT_ACTOR });
          if (!u.ok) fail(p, u.error.code);
        }
        if (p.status) {
          const s = await sp.setCustomerStatus.execute({ leadId, status: p.status, actor: IMPORT_ACTOR });
          if (!s.ok) fail(p, s.error.code);
        }
        if (p.campaign) {
          await db.query("UPDATE leads SET campaign_name = $2, updated_at = $3 WHERE id = $1", [
            leadId,
            p.campaign,
            now,
          ]);
        }
        if (p.ownerTo) {
          const a = await sp.assignLead.execute({ leadId, toUserId: p.ownerTo, actor: IMPORT_ACTOR });
          if (!a.ok) fail(p, a.error.code);
        }
        if (Object.keys(p.extra).length) {
          await uow.run((repos) => repos.leads.mergeExtraAnswers(leadId!, p.extra, now));
        }
        for (const id of p.removeActivityIds) {
          await uow.run((repos) => repos.activities.remove(id));
          out.contactsRemoved++;
        }
        for (const dup of p.hideDuplicates) {
          await db.query("UPDATE leads SET is_test = true, updated_at = $2 WHERE id = $1", [dup, now]);
          await uow.run((repos) => repos.leads.mergeExtraAnswers(dup, { duplicate_of: leadId }, now));
          out.hidden++;
        }
        out.updated++;
      }
      if (!leadId) continue;
      const doneBy = p.ownerTo ?? (await uow.run((repos) => repos.leads.findById(leadId!)))?.assignedUserId ?? null;
      for (const c of p.addContacts) {
        const added = await uow.run(async (repos) => {
          if (await repos.activities.findByLegacyId(c.legacyId)) return false;
          const a: Activity = {
            id: uuidGenerator.next(),
            leadId: leadId!,
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
        if (added) out.contactsAdded++;
      }
      if (p.stage) {
        const cur = await uow.run((repos) => repos.leads.findById(leadId!));
        if (cur && !isTerminal(cur.currentStage) && stageIndex(cur.currentStage) < stageIndex(p.stage.target)) {
          clock.set(p.stage.when.getTime() <= now.getTime() ? p.stage.when : now);
          const moved = await sp.changeLeadStage.execute({
            leadId,
            target: p.stage.target,
            actor: IMPORT_ACTOR,
            skipFollowUp: p.stage.when.getTime() + 3 * DAY < now.getTime(),
          });
          clock.set(now);
          if (moved.ok) out.stageMoves[p.stage.target] = (out.stageMoves[p.stage.target] ?? 0) + 1;
          else fail(p, moved.error.code);
        }
      }
    }
  } catch (e) {
    error = e;
  }
  const after = await captureLeads(db, [...existing, ...created]);
  const ops = diffSnapshots(before, after);
  const cp = await saveCheckpoint(db, {
    label: opts.label,
    source: "excel_sync",
    createdBy: opts.actorId,
    createdAt: now,
    leadIds: [...existing, ...created],
    ops,
    extra: {
      asOf: opts.asOf.toISOString(),
      lists: [...new Set(report.plans.map((p) => p.list))],
      counts: report.counts,
      ...(error ? { error: String((error as Error).message ?? error) } : {}),
    },
  });
  out.checkpointId = cp.id;
  if (error) throw Object.assign(new Error(`Eşitleme yarıda kaldı; geri yükleme noktası ${cp.id}`), { cause: error });
  return out;
}
