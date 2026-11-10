import { calendarDay } from "./activity";
import { summarizeContacts, type ContactAggregateRow, type ContactSummary } from "./contact";
import { dataWarnings, type DataWarning } from "./dataQuality";
import type { Lead, StageEvent } from "./lead";
import {
  CUSTOMER_STATUSES,
  INSTALL_TIMELINES,
  isHotLead,
  type CustomerStatus,
  type InstallTimeline,
} from "./leadProfile";
import { round2 } from "./numbers";
import { COURT_PRODUCTS, courtTotal, productQty, roofAreaM2, type ProductCode } from "./products";
import { reachedStage } from "./reports";
import type { StageCode } from "./stage";

/**
 * Özet rapor (Faz 7g, D8, iş emri §3.3.7): Excel ÖZET RAPOR'un formülleri. Saf kod; liste, pano, Bugün ve rapor
 * lead başına aynı türetmeyi (`leadTracking`) kullanır, rapor yalnız sayar. Oranlar ham orandır (yuvarlanmaz):
 * ekran "%56,9" için bir ondalık gösterir, Excel'in önbellek değeriyle (0,56875) karşılaştırılabilir kalır.
 */

export interface ProposalFacts {
  given: boolean;
  at: Date | null;
  /** `at`'in kaynağı; aşamaya ulaşılmış ama olay zamanı yoksa "stage". */
  via: "stage" | "contact" | null;
}

/**
 * Teklif verildi mi (D3): geri alınmamış PROPOSAL aşama olayı (auto_fill dahil; `reachedStage` ile aynı tanım) ya da
 * sonucu/türü "Teklif gönderildi" olan temas. `at` = ikisinden erken olanı.
 */
export function proposalFacts(
  current: StageCode,
  liveEvents: readonly StageEvent[],
  contact: ContactSummary,
): ProposalFacts {
  const byStage = reachedStage("PROPOSAL", current, liveEvents);
  const stageAt =
    liveEvents
      .filter((e) => e.stageCode === "PROPOSAL" && !e.undoneAt)
      .map((e) => e.occurredAt)
      .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
  const contactAt = contact.proposalContactAt;
  if (stageAt && (!contactAt || stageAt.getTime() <= contactAt.getTime())) {
    return { given: true, at: stageAt, via: "stage" };
  }
  if (contactAt) return { given: true, at: contactAt, via: "contact" };
  return byStage ? { given: true, at: null, via: "stage" } : { given: false, at: null, via: null };
}

/** Lead başına türetilen izleme bilgisi: liste, pano, Bugün ve rapor için tek türetme yolu. */
export interface LeadTracking {
  contact: ContactSummary;
  proposal: ProposalFacts;
  /** Bütün uyarılar; izleyene göre süzme `visibleWarnings` ile DTO'da yapılır. */
  warnings: DataWarning[];
  hot: boolean;
  /** Ürünlerden kort toplamı; ürün yoksa null (gösterim sırası §3.4). */
  courtTotal: number | null;
  roofAreaM2: number | null;
}

/** `rows` bu lead'in temas toplamıdır (başka lead'in satırları yok sayılır). */
export function leadTracking(
  lead: Lead,
  liveEvents: readonly StageEvent[],
  rows: readonly ContactAggregateRow[],
  timeZone: string,
): LeadTracking {
  const contact = summarizeContacts(
    rows.filter((r) => r.leadId === lead.id),
    lead.contactHistoryUnknown,
  );
  const total = courtTotal(lead.products);
  return {
    contact,
    proposal: proposalFacts(
      lead.currentStage,
      liveEvents.filter((e) => e.leadId === lead.id && !e.undoneAt),
      contact,
    ),
    warnings: dataWarnings(lead, contact, timeZone),
    hot: isHotLead(lead),
    courtTotal: total > 0 ? total : null,
    roofAreaM2: roofAreaM2(lead.products),
  };
}

/** Bugün şeridi ve `hot=1&contact=never` listesi aynı tanımı kullanır [K-I8]. */
export const isHotUncontacted = (lead: Lead, t: LeadTracking): boolean =>
  isHotLead(lead) && t.contact.state === "never";

export interface TrackingCounts {
  lead: number;
  mailSent: number;
  whatsappSent: number;
  neverReached: number;
  legacyNoContact: number;
  contacted: number;
  replied: number;
  proposalGiven: number;
  buyers: number;
  /** contacted / (lead − legacy); payda 0 ise null. */
  reachRate: number | null;
  /** replied / contacted; payda 0 ise null. */
  replyRate: number | null;
  /** proposalGiven / lead; lead 0 ise null. */
  proposalRate: number | null;
}

export interface TrackingOwnerRow extends TrackingCounts {
  /** null = ortak havuz. */
  ownerId: string | null;
}

export interface TrackingPoolRow extends TrackingCounts {
  /** Excel'deki sorumlu etiketi (`extraAnswers.excel_owner`); null = "Excel'de sorumlu yok". */
  excelOwner: string | null;
}

export type StatusKey = CustomerStatus | "none";
export const STATUS_KEYS: readonly StatusKey[] = [...CUSTOMER_STATUSES, "none"];

export interface TrackingStatusRow {
  ownerId: string | null;
  counts: Record<StatusKey, number>;
  total: number;
}

export interface TrackingProductRow {
  code: ProductCode;
  /** Kort: adet > 0; Kapatma: `roof.wanted`. */
  preferred: number;
  amongProposals: number;
  /** amongProposals / toplam teklif; teklif yoksa null. */
  shareOfProposals: number | null;
  amongBuyers: number;
  /** Kortlarda Σ adet; Kapatma'da null. */
  totalQty: number | null;
  /** Kapatma'da Σ çatı alanı (ölçüsü eksik olan atlanır); kortlarda null. */
  totalAreaM2: number | null;
}

export interface TrackingTimelineRow {
  /** null = "Belirtilmemiş" (yalnız lead > 0 ise). */
  timeline: InstallTimeline | null;
  lead: number;
  neverReached: number;
  legacyNoContact: number;
  replied: number;
  proposalGiven: number;
  /** never / (lead − legacy); payda 0 ise null. */
  neverRate: number | null;
}

export type ShareKey = "mailSent" | "whatsappSent" | "neverReached" | "replied" | "proposalGiven" | "buyers";

export interface TrackingReport {
  header: { firstLeadAt: Date | null; lastLeadAt: Date | null; reportDate: string };
  basics: {
    total: number;
    mailSent: number;
    whatsappSent: number;
    neverReached: number;
    legacyNoContact: number;
    replied: number;
    proposalGiven: number;
    buyers: number;
    /** x / total; toplam 0 ise 0 (Excel `IF(B7=0,0,…)`). */
    share: Record<ShareKey, number>;
  };
  byOwner: TrackingOwnerRow[];
  byOwnerTotal: TrackingCounts;
  poolBreakdown: TrackingPoolRow[];
  statusByOwner: TrackingStatusRow[];
  statusTotal: { counts: Record<StatusKey, number>; total: number };
  products: TrackingProductRow[];
  /** Kurulum yeri "Tam kapalı / çatılı kort" olan lead sayısı (Excel C46). */
  closingPotential: number;
  byInstallTimeline: TrackingTimelineRow[];
}

export interface TrackingItem {
  lead: Lead;
  t: LeadTracking;
}

const ratio = (num: number, den: number): number | null => (den > 0 ? num / den : null);

type RawCounts = Omit<TrackingCounts, "reachRate" | "replyRate" | "proposalRate">;

const ZERO: RawCounts = {
  lead: 0,
  mailSent: 0,
  whatsappSent: 0,
  neverReached: 0,
  legacyNoContact: 0,
  contacted: 0,
  replied: 0,
  proposalGiven: 0,
  buyers: 0,
};

function withRates(c: RawCounts): TrackingCounts {
  return {
    ...c,
    reachRate: ratio(c.contacted, c.lead - c.legacyNoContact),
    replyRate: ratio(c.replied, c.contacted),
    proposalRate: ratio(c.proposalGiven, c.lead),
  };
}

function rawCounts(items: readonly TrackingItem[]): RawCounts {
  const c = { ...ZERO };
  for (const { lead, t } of items) {
    c.lead++;
    if ((t.contact.channels.email?.count ?? 0) > 0) c.mailSent++;
    if ((t.contact.channels.whatsapp?.count ?? 0) > 0) c.whatsappSent++;
    if (t.contact.state === "never") c.neverReached++;
    if (t.contact.state === "legacy") c.legacyNoContact++;
    if (t.contact.state === "contacted") c.contacted++;
    if (t.contact.replied) c.replied++;
    if (t.proposal.given) c.proposalGiven++;
    if (lead.customerStatus === "buyer_ready") c.buyers++;
  }
  return c;
}

const counts = (items: readonly TrackingItem[]): TrackingCounts => withRates(rawCounts(items));

function statusCounts(items: readonly TrackingItem[]): { counts: Record<StatusKey, number>; total: number } {
  const out = Object.fromEntries(STATUS_KEYS.map((k) => [k, 0])) as Record<StatusKey, number>;
  for (const { lead } of items) out[lead.customerStatus ?? "none"]++;
  return { counts: out, total: items.length };
}

function groupBy<K>(items: readonly TrackingItem[], key: (i: TrackingItem) => K): Map<K, TrackingItem[]> {
  const by = new Map<K, TrackingItem[]>();
  for (const i of items) {
    const k = key(i);
    const list = by.get(k);
    if (list) list.push(i);
    else by.set(k, [i]);
  }
  return by;
}

const excelOwnerOf = (lead: Lead): string | null => {
  const v = lead.extraAnswers?.excel_owner;
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
};

/**
 * Özet rapor hesabı. `items` kapsamdaki lead'ler (görünürlük ve süzgeçler sorguda uygulanır; test lead'leri burada da
 * dışarıda kalır). `teamIds` = aktif satış kullanıcıları: lead'i olmasa da satırları her zaman çıkar; null (dizin
 * bilinmiyor) ise yalnız lead'i olan sahipler. Satır sırası: `teamIds` sırası, sonra lead'i olan diğer sahipler (id
 * sırasıyla), havuz en sonda; ada göre sıralama arayüzdedir [K-M3].
 */
export function buildTrackingReport(i: {
  items: readonly TrackingItem[];
  teamIds: readonly string[] | null;
  now: Date;
  timeZone: string;
}): TrackingReport {
  const items = i.items.filter((x) => !x.lead.isTest);
  const all = rawCounts(items);
  const share = (n: number) => (all.lead > 0 ? n / all.lead : 0);

  // Başlık: filtrelenmiş kümede ilk / son lead tarihi; rapor tarihi bugün (saat dilimi).
  let firstLeadAt: Date | null = null;
  let lastLeadAt: Date | null = null;
  for (const { lead } of items) {
    if (!firstLeadAt || lead.createdAt.getTime() < firstLeadAt.getTime()) firstLeadAt = lead.createdAt;
    if (!lastLeadAt || lead.createdAt.getTime() > lastLeadAt.getTime()) lastLeadAt = lead.createdAt;
  }

  // Sorumlu satırları (§2, §3 aynı satırlar ve sıra).
  const byOwnerItems = groupBy(items, (x) => x.lead.assignedUserId);
  const pool = byOwnerItems.get(null) ?? [];
  const team = i.teamIds ?? [];
  const others = [...byOwnerItems.keys()]
    .filter((k): k is string => k !== null && !team.includes(k))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const ownerIds: (string | null)[] = [...new Set(team), ...others];
  if (i.teamIds !== null || pool.length > 0) ownerIds.push(null);
  const ownerItems = (id: string | null) => byOwnerItems.get(id) ?? [];
  const byOwner: TrackingOwnerRow[] = ownerIds.map((ownerId) => ({ ownerId, ...counts(ownerItems(ownerId)) }));
  const rowSum = byOwner.reduce<RawCounts>(
    (s, r) => {
      const out = { ...s };
      for (const k of Object.keys(ZERO) as (keyof RawCounts)[]) out[k] += r[k];
      return out;
    },
    { ...ZERO },
  );

  // Havuz alt kırılımı: Excel'deki sorumlu etiketine göre; lead sayısı azalan, sonra etiket, "yok" en sonda.
  const poolBreakdown: TrackingPoolRow[] = [...groupBy(pool, (x) => excelOwnerOf(x.lead)).entries()]
    .map(([excelOwner, list]) => ({ excelOwner, ...counts(list) }))
    .sort(
      (a, b) =>
        b.lead - a.lead ||
        Number(a.excelOwner === null) - Number(b.excelOwner === null) ||
        (a.excelOwner ?? "").localeCompare(b.excelOwner ?? "", "tr"),
    );

  // Ürünler (§4): 3 kort + Kapatma.
  const proposals = all.proposalGiven;
  const productRow = (code: ProductCode, preferredOf: (l: Lead) => boolean): TrackingProductRow => {
    const pref = items.filter((x) => preferredOf(x.lead));
    const amongProposals = pref.filter((x) => x.t.proposal.given).length;
    const isRoof = code === "roof";
    return {
      code,
      preferred: pref.length,
      amongProposals,
      shareOfProposals: ratio(amongProposals, proposals),
      amongBuyers: pref.filter((x) => x.lead.customerStatus === "buyer_ready").length,
      totalQty: isRoof ? null : pref.reduce((s, x) => s + (productQty(x.lead.products, code) ?? 0), 0),
      totalAreaM2: isRoof ? round2(pref.reduce((s, x) => s + (roofAreaM2(x.lead.products) ?? 0), 0)) : null,
    };
  };
  const products: TrackingProductRow[] = [
    ...COURT_PRODUCTS.map((code) => productRow(code, (l) => (productQty(l.products, code) ?? 0) > 0)),
    productRow("roof", (l) => l.products.roof.wanted),
  ];

  // Kurulum zamanı (§5): 4 kod sabit sırada, "Belirtilmemiş" yalnız lead > 0 ise.
  const byTimelineItems = groupBy(items, (x) => x.lead.installTimeline);
  const timelineRow = (timeline: InstallTimeline | null): TrackingTimelineRow => {
    const c = rawCounts(byTimelineItems.get(timeline) ?? []);
    return {
      timeline,
      lead: c.lead,
      neverReached: c.neverReached,
      legacyNoContact: c.legacyNoContact,
      replied: c.replied,
      proposalGiven: c.proposalGiven,
      neverRate: ratio(c.neverReached, c.lead - c.legacyNoContact),
    };
  };
  const byInstallTimeline = INSTALL_TIMELINES.map(timelineRow);
  const unspecified = timelineRow(null);
  if (unspecified.lead > 0) byInstallTimeline.push(unspecified);

  return {
    header: { firstLeadAt, lastLeadAt, reportDate: calendarDay(i.now, i.timeZone) },
    basics: {
      total: all.lead,
      mailSent: all.mailSent,
      whatsappSent: all.whatsappSent,
      neverReached: all.neverReached,
      legacyNoContact: all.legacyNoContact,
      replied: all.replied,
      proposalGiven: all.proposalGiven,
      buyers: all.buyers,
      share: {
        mailSent: share(all.mailSent),
        whatsappSent: share(all.whatsappSent),
        neverReached: share(all.neverReached),
        replied: share(all.replied),
        proposalGiven: share(all.proposalGiven),
        buyers: share(all.buyers),
      },
    },
    byOwner,
    byOwnerTotal: withRates(rowSum),
    poolBreakdown,
    statusByOwner: ownerIds.map((ownerId) => ({ ownerId, ...statusCounts(ownerItems(ownerId)) })),
    statusTotal: statusCounts(items),
    products,
    closingPotential: items.filter((x) => x.lead.installSite === "covered_court").length,
    byInstallTimeline,
  };
}
