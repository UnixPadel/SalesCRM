/**
 * Lead listesi sütunları (Faz 7g, iş emri §5.4): Excel SATIŞ TAKİP'in sütun grupları. Her sütun satırdan bir ya da
 * daha çok "değer anahtarı" üretir (başlık menüsündeki sayılı liste ve URL süzgeci aynı anahtarı kullanır), bir
 * sıralama anahtarı ve CSV metni. Saf: React yok; çeviri `t` ve takvim günü `day` dışarıdan gelir.
 */
import type { LeadListDto } from "../../modules/sales-pipeline/api/dto";
import { courtLine, productLine, roofArea, type T } from "../contact/trackingView";

export type GroupId = "lead" | "reach" | "reply" | "customer" | "proposal" | "products" | "follow" | "form" | "check";

export const GROUPS: { id: GroupId; label: string; adminOnly?: boolean }[] = [
  { id: "lead", label: "list.group.lead" },
  { id: "reach", label: "list.group.reach" },
  { id: "reply", label: "list.group.reply" },
  { id: "customer", label: "list.group.customer" },
  { id: "proposal", label: "list.group.proposal" },
  { id: "products", label: "list.group.products" },
  { id: "follow", label: "list.group.follow" },
  { id: "form", label: "list.group.form" },
  { id: "check", label: "list.group.check", adminOnly: true },
];

export type FilterKind = "values" | "text";

export interface Ctx {
  t: T;
  lang: string;
  /** ISO → takvim günü YYYY-MM-DD (`/reference.timeZone`). */
  day: (iso: string) => string;
  nameOf: (userId: string | null) => string;
  stageName: (code: string) => string;
  countryName: (code: string) => string;
  sourceName: (source: string) => string;
  now: number;
}

export interface ColumnDef {
  id: string;
  group: GroupId;
  label: string;
  /** URL anahtarı (başlık süzgeci). */
  param: string;
  kind: FilterKind;
  /** Varsayılan gizli (Excel No, Kaynak). */
  hidden?: boolean;
  /** Satırın değer anahtarları (değer listesi süzgeci). */
  values?: (l: LeadListDto, c: Ctx) => string[];
  /** Değer anahtarının etiketi. */
  valueLabel?: (v: string, c: Ctx) => string;
  /** Değer listesinin sabit sırası (yoksa etikete göre). */
  order?: string[];
  /** Metin süzgeci için aranacak metin. */
  text?: (l: LeadListDto, c: Ctx) => string;
  sort: (l: LeadListDto, c: Ctx) => string | number;
  /** CSV hücresi (Excel'in sembolleriyle). */
  csv: (l: LeadListDto, c: Ctx) => string;
}

const YES = "yes";
const NO = "no";
const LEGACY = "legacy";
const NONE = "none";
const yn = (b: boolean) => (b ? YES : NO);
const tick = (b: boolean) => (b ? "✔" : "✘");
const evet = (b: boolean, c: Ctx) => (b ? c.t("common.yes") : c.t("common.no"));
const ynLabel = (v: string, c: Ctx) =>
  v === YES
    ? `✔ ${c.t("common.yes")}`
    : v === NO
      ? `✘ ${c.t("common.no")}`
      : v === LEGACY
        ? c.t("summary.legacyShort")
        : v;
const month = (iso: string, c: Ctx) => c.day(iso).slice(0, 7);
const monthLabel = (v: string, c: Ctx) =>
  v === "never"
    ? c.t("summary.never")
    : v === LEGACY
      ? c.t("summary.legacyShort")
      : new Date(`${v}-15T12:00:00Z`).toLocaleDateString(c.lang === "tr" ? "tr-TR" : "en-GB", {
          month: "long",
          year: "numeric",
        });
const ddmm = (iso: string, c: Ctx) => {
  const [y, m, d] = c.day(iso).split("-");
  return `${d}.${m}.${y}`;
};
const channelSent = (l: LeadListDto, k: "email" | "whatsapp") => (l.contact.channels[k]?.count ?? 0) > 0;
const OTHER = ["call", "meeting", "site_visit", "proposal_sent", "other"] as const;
const otherCount = (l: LeadListDto) => OTHER.reduce((s, k) => s + (l.contact.channels[k]?.count ?? 0), 0);
const otherReply = (l: LeadListDto) =>
  OTHER.map((k) => l.contact.channels[k]?.firstReplyAt ?? null)
    .filter((x): x is string => !!x)
    .sort()[0] ?? null;
const reach = (l: LeadListDto, k: "email" | "whatsapp") =>
  l.contact.state === "legacy" && !channelSent(l, k) ? LEGACY : yn(channelSent(l, k));
const excelNo = (l: LeadListDto) => String(l.extraAnswers?.["excel_no"] ?? "");
const excelOwner = (l: LeadListDto) =>
  typeof l.extraAnswers?.["excel_owner"] === "string" ? String(l.extraAnswers["excel_owner"]) : "";

export const COLUMNS: ColumnDef[] = [
  {
    id: "createdAt",
    group: "lead",
    label: "list.col.createdAt",
    param: "f_created",
    kind: "values",
    values: (l, c) => [month(l.createdAt, c)],
    valueLabel: monthLabel,
    sort: (l) => l.createdAt,
    csv: (l, c) => ddmm(l.createdAt, c),
  },
  {
    id: "name",
    group: "lead",
    label: "list.col.name",
    param: "f_name",
    kind: "text",
    text: (l) => `${l.fullName} ${excelNo(l)} ${l.company}`,
    sort: (l) => l.fullName.toLocaleLowerCase("tr"),
    csv: (l) => l.fullName,
  },
  {
    id: "excelNo",
    group: "lead",
    label: "list.col.excelNo",
    param: "f_excelNo",
    kind: "text",
    hidden: true,
    text: (l) => excelNo(l),
    sort: (l) => Number(excelNo(l)) || 0,
    csv: (l) => excelNo(l),
  },
  {
    id: "country",
    group: "lead",
    label: "list.col.country",
    param: "country",
    kind: "values",
    values: (l) => [l.country ?? NONE],
    valueLabel: (v, c) => (v === NONE ? "—" : `${c.countryName(v)} (${v})`),
    sort: (l, c) => (l.country ? c.countryName(l.country) : "~"),
    csv: (l, c) => (l.country ? `${c.countryName(l.country)} (${l.country})` : ""),
  },
  {
    id: "owner",
    group: "lead",
    label: "list.col.owner",
    param: "owner",
    kind: "values",
    values: (l) => [l.assignedUserId ?? "pool"],
    valueLabel: (v, c) => (v === "pool" ? c.t("common.pool") : c.nameOf(v)),
    sort: (l, c) => (l.assignedUserId ? c.nameOf(l.assignedUserId).toLocaleLowerCase("tr") : "~"),
    csv: (l, c) => (l.assignedUserId ? c.nameOf(l.assignedUserId) : c.t("common.pool")),
  },
  {
    id: "excelOwner",
    group: "lead",
    label: "list.col.excelOwner",
    param: "f_excelOwner",
    kind: "values",
    hidden: true,
    values: (l) => [excelOwner(l) || NONE],
    valueLabel: (v) => (v === NONE ? "—" : v),
    sort: (l) => excelOwner(l),
    csv: (l) => excelOwner(l),
  },
  {
    id: "source",
    group: "lead",
    label: "list.col.source",
    param: "source",
    kind: "values",
    hidden: true,
    values: (l) => [l.source],
    valueLabel: (v, c) => c.sourceName(v),
    sort: (l) => l.source,
    csv: (l, c) => c.sourceName(l.source),
  },
  {
    id: "phone",
    group: "lead",
    label: "list.col.phone",
    param: "f_phone",
    kind: "values",
    values: (l) => [yn(!!l.phoneE164)],
    valueLabel: (v, c) => (v === YES ? c.t("list.has") : c.t("list.hasNot")),
    order: [YES, NO],
    sort: (l) => l.phoneE164 ?? "~",
    csv: (l) => l.phoneE164 ?? "",
  },
  {
    id: "email",
    group: "lead",
    label: "list.col.email",
    param: "f_email",
    kind: "values",
    values: (l) => [yn(!!l.email)],
    valueLabel: (v, c) => (v === YES ? c.t("list.has") : c.t("list.hasNot")),
    order: [YES, NO],
    sort: (l) => l.email ?? "~",
    csv: (l) => l.email ?? "",
  },
  {
    id: "mail",
    group: "reach",
    label: "list.col.mail",
    param: "f_mail",
    kind: "values",
    values: (l) => [reach(l, "email")],
    valueLabel: ynLabel,
    order: [YES, NO, LEGACY],
    sort: (l) => Number(channelSent(l, "email")),
    csv: (l) => tick(channelSent(l, "email")),
  },
  {
    id: "wa",
    group: "reach",
    label: "list.col.wa",
    param: "f_wa",
    kind: "values",
    values: (l) => [reach(l, "whatsapp")],
    valueLabel: ynLabel,
    order: [YES, NO, LEGACY],
    sort: (l) => Number(channelSent(l, "whatsapp")),
    csv: (l) => tick(channelSent(l, "whatsapp")),
  },
  {
    id: "other",
    group: "reach",
    label: "list.col.other",
    param: "f_other",
    kind: "values",
    values: (l) => [yn(otherCount(l) > 0)],
    valueLabel: ynLabel,
    order: [YES, NO],
    sort: (l) => otherCount(l),
    csv: (l) => tick(otherCount(l) > 0),
  },
  {
    id: "mailReply",
    group: "reply",
    label: "list.col.mailReply",
    param: "f_mailReply",
    kind: "values",
    values: (l) => [yn(!!l.contact.channels.email?.firstReplyAt)],
    valueLabel: ynLabel,
    order: [YES, NO],
    sort: (l) => l.contact.channels.email?.firstReplyAt ?? "",
    csv: (l, c) => evet(!!l.contact.channels.email?.firstReplyAt, c),
  },
  {
    id: "waReply",
    group: "reply",
    label: "list.col.waReply",
    param: "f_waReply",
    kind: "values",
    values: (l) => [yn(!!l.contact.channels.whatsapp?.firstReplyAt)],
    valueLabel: ynLabel,
    order: [YES, NO],
    sort: (l) => l.contact.channels.whatsapp?.firstReplyAt ?? "",
    csv: (l, c) => evet(!!l.contact.channels.whatsapp?.firstReplyAt, c),
  },
  {
    id: "otherReply",
    group: "reply",
    label: "list.col.otherReply",
    param: "f_otherReply",
    kind: "values",
    values: (l) => [yn(!!otherReply(l))],
    valueLabel: ynLabel,
    order: [YES, NO],
    sort: (l) => otherReply(l) ?? "",
    csv: (l, c) => evet(!!otherReply(l), c),
  },
  {
    id: "status",
    group: "customer",
    label: "list.col.status",
    param: "f_status",
    kind: "values",
    values: (l) => [l.customerStatus ?? NONE],
    valueLabel: (v, c) => c.t(`customerStatus.${v}`),
    order: ["interested", "not_interested", "project_phase", "collecting_prices", "buyer_ready", NONE],
    sort: (l) => l.customerStatus ?? "~",
    csv: (l, c) => (l.customerStatus ? c.t(`customerStatus.${l.customerStatus}`) : ""),
  },
  {
    id: "stage",
    group: "customer",
    label: "list.col.stage",
    param: "stage",
    kind: "values",
    values: (l) => [l.currentStage],
    valueLabel: (v, c) => c.stageName(v),
    order: ["NEW", "CONTACTED", "QUALIFIED", "PROPOSAL", "WON", "LOST"],
    sort: (l) => ["NEW", "CONTACTED", "QUALIFIED", "PROPOSAL", "WON", "LOST"].indexOf(l.currentStage),
    csv: (l, c) => c.stageName(l.currentStage),
  },
  {
    id: "proposal",
    group: "proposal",
    label: "list.col.proposal",
    param: "f_proposal",
    kind: "values",
    values: (l) => [yn(l.proposal.given)],
    valueLabel: ynLabel,
    order: [YES, NO],
    sort: (l) => l.proposal.at ?? (l.proposal.given ? "0" : ""),
    csv: (l, c) => evet(l.proposal.given, c),
  },
  ...(["standard", "panoramic", "fullPanoramic"] as const).map((k): ColumnDef => ({
    id: k,
    group: "products",
    label: `product.${k === "fullPanoramic" ? "full_panoramic" : k}`,
    param: `f_${k}`,
    kind: "values",
    values: (l) => [yn((l.products[k] ?? 0) > 0)],
    valueLabel: ynLabel,
    order: [YES, NO],
    sort: (l) => l.products[k] ?? 0,
    csv: (l) => (l.products[k] ? String(l.products[k]) : ""),
  })),
  {
    id: "roof",
    group: "products",
    label: "product.roof",
    param: "f_roof",
    kind: "values",
    values: (l) => [yn(l.products.roof.wanted)],
    valueLabel: ynLabel,
    order: [YES, NO],
    sort: (l) => roofArea(l.products) ?? (l.products.roof.wanted ? 0 : -1),
    csv: (l) => {
      const a = roofArea(l.products);
      return !l.products.roof.wanted
        ? ""
        : a === null
          ? "✔"
          : `${l.products.roof.widthM} x ${l.products.roof.lengthM} m = ${a} m2`;
    },
  },
  {
    id: "last",
    group: "follow",
    label: "list.col.last",
    param: "f_last",
    kind: "values",
    values: (l, c) => [l.contact.lastAt ? month(l.contact.lastAt, c) : l.contact.state === "legacy" ? LEGACY : "never"],
    valueLabel: monthLabel,
    sort: (l) => l.contact.lastAt ?? "",
    csv: (l, c) => (l.contact.lastAt ? ddmm(l.contact.lastAt, c) : ""),
  },
  {
    id: "first",
    group: "follow",
    label: "list.col.first",
    param: "f_first",
    kind: "values",
    values: (l, c) => [l.contact.firstAt ? month(l.contact.firstAt, c) : "never"],
    valueLabel: monthLabel,
    sort: (l) => l.contact.firstAt ?? "",
    csv: (l, c) => (l.contact.firstAt ? ddmm(l.contact.firstAt, c) : ""),
  },
  {
    id: "count",
    group: "follow",
    label: "list.col.count",
    param: "f_count",
    kind: "values",
    values: (l) => [l.contact.count === 0 ? "0" : l.contact.count >= 3 ? "3+" : "1+"],
    valueLabel: (v) => v,
    order: ["0", "1+", "3+"],
    sort: (l) => l.contact.count,
    csv: (l) => String(l.contact.count),
  },
  {
    id: "next",
    group: "follow",
    label: "list.col.next",
    param: "f_next",
    kind: "values",
    values: (l) => [yn(!!l.nextActivity)],
    valueLabel: (v, c) => (v === YES ? c.t("list.has") : c.t("activity.rotting")),
    order: [YES, NO],
    sort: (l) => l.nextActivity?.dueAt ?? "~",
    csv: (l, c) =>
      l.nextActivity ? `${c.t(`activity.type.${l.nextActivity.type}`)} ${ddmm(l.nextActivity.dueAt, c)}` : "",
  },
  {
    id: "note",
    group: "follow",
    label: "list.col.note",
    param: "f_note",
    kind: "text",
    text: (l) => l.notes,
    sort: (l) => l.notes.toLocaleLowerCase("tr"),
    csv: (l) => l.notes,
  },
  {
    id: "site",
    group: "form",
    label: "answer.installSite",
    param: "f_site",
    kind: "values",
    values: (l) => [l.installSite ?? NONE],
    valueLabel: (v, c) => (v === NONE ? "—" : c.t(`answer.site.${v}`)),
    sort: (l) => l.installSite ?? "~",
    csv: (l, c) => (l.installSite ? c.t(`answer.site.${l.installSite}`) : ""),
  },
  {
    id: "timeline",
    group: "form",
    label: "answer.installTimeline",
    param: "f_timeline",
    kind: "values",
    values: (l) => [l.installTimeline ?? NONE],
    valueLabel: (v, c) => c.t(`answer.timeline.${v}`),
    order: ["m0_3", "m3_6", "m6_12", "researching", NONE],
    sort: (l) => ["m0_3", "m3_6", "m6_12", "researching"].indexOf(l.installTimeline ?? "") + 1 || 9,
    csv: (l, c) => (l.installTimeline ? c.t(`answer.timeline.${l.installTimeline}`) : ""),
  },
  {
    id: "profile",
    group: "form",
    label: "answer.customerProfile",
    param: "f_profile",
    kind: "values",
    values: (l) => [l.customerProfile ?? NONE],
    valueLabel: (v, c) => (v === NONE ? "—" : c.t(`answer.profile.${v}`)),
    sort: (l) => l.customerProfile ?? "~",
    csv: (l, c) => (l.customerProfile ? c.t(`answer.profile.${l.customerProfile}`) : ""),
  },
  {
    id: "band",
    group: "form",
    label: "list.col.band",
    param: "f_band",
    kind: "values",
    values: (l) => [l.courtCountBand ?? NONE],
    valueLabel: (v, c) => (v === NONE ? "—" : c.t(`answer.band.${v}`)),
    order: ["1", "2_3", "4_6", "7_plus", NONE],
    sort: (l) => ["1", "2_3", "4_6", "7_plus"].indexOf(l.courtCountBand ?? "") + 1 || 9,
    csv: (l, c) => (l.courtCountBand ? c.t(`answer.band.${l.courtCountBand}`) : ""),
  },
  {
    id: "surface",
    group: "form",
    label: "answer.adSurface",
    param: "f_surface",
    kind: "values",
    values: (l) => [l.adSurface ?? NONE],
    valueLabel: (v, c) => {
      if (v === NONE) return "—";
      const s = c.t(`surface.${v}`);
      return s.startsWith("surface.") ? v : s;
    },
    sort: (l) => l.adSurface ?? "~",
    csv: (l, c) => (l.adSurface ? c.t(`surface.${l.adSurface}`) : ""),
  },
  {
    id: "campaign",
    group: "form",
    label: "answer.campaign",
    param: "f_campaign",
    kind: "values",
    values: (l) => [l.campaign.campaignName ?? NONE],
    valueLabel: (v) => (v === NONE ? "—" : v),
    sort: (l) => l.campaign.campaignName ?? "~",
    csv: (l) => l.campaign.campaignName ?? "",
  },
  {
    id: "warn",
    group: "check",
    label: "list.col.warn",
    param: "f_warn",
    kind: "values",
    values: (l) => [yn(l.warnings.some((w) => w.severity === "warn" && !w.checked))],
    valueLabel: ynLabel,
    order: [YES, NO],
    sort: (l) => l.warnings.filter((w) => w.severity === "warn" && !w.checked).length,
    csv: (l) => String(l.warnings.filter((w) => w.severity === "warn" && !w.checked).length || ""),
  },
];

export const columnById = new Map(COLUMNS.map((c) => [c.id, c]));

/** Katlı grubun özet metni ("Ulaşıldı", "2 Panoramic · Kapatma 200 m²", "3 ay içinde · Tam kapalı"). */
export function groupSummary(g: GroupId, l: LeadListDto, c: Ctx): string {
  switch (g) {
    case "reach":
      return l.contact.state === "contacted"
        ? c.t("list.reached")
        : l.contact.state === "legacy"
          ? c.t("summary.legacyShort")
          : c.t("summary.never");
    case "reply":
      return l.contact.replied ? `✔ ${c.t("list.replied")}` : "—";
    case "products":
      return productLine(l.products, c.t, c.lang, true) || courtLine(l, c.t) || "—";
    case "form":
      return (
        [
          l.installTimeline ? c.t(`answer.timeline.${l.installTimeline}`) : "",
          l.installSite ? c.t(`answer.site.${l.installSite}`) : "",
        ]
          .filter(Boolean)
          .join(" · ") || "—"
      );
    default:
      return "";
  }
}
