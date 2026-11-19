/**
 * Lead listesi sütunları (Faz 7g, iş emri §5.4): Excel SATIŞ TAKİP'in sütun grupları. Her sütun satırdan bir ya da
 * daha çok "değer anahtarı" üretir (başlık menüsündeki sayılı liste ve URL süzgeci aynı anahtarı kullanır), bir
 * sıralama anahtarı ve dışa aktarım (Excel) metni. Saf: React yok; çeviri `t` ve takvim günü `day` dışarıdan gelir.
 */
import { localeOf } from "../../i18n/lang";
import type { LeadListDto } from "../../modules/sales-pipeline/api/dto";
import { phoneText, productLine, type ProductNames, type T } from "../contact/trackingView";

export type GroupId = "lead" | "reach" | "customer" | "proposal" | "products" | "follow" | "form" | "check";

export const GROUPS: { id: GroupId; label: string; adminOnly?: boolean }[] = [
  { id: "lead", label: "list.group.lead" },
  { id: "reach", label: "list.group.reach" },
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
  /** Ürün listesi: numara → ad (`/reference.products`). */
  productName: ProductNames;
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
  /** Dışa aktarım hücresi (Excel'in sembolleriyle); içe aktarım değişikliği bu metne göre arar. */
  csv: (l: LeadListDto, c: Ctx) => string;
  /** Dışa aktarımda yer almaz (aynı bilgi başka sütunda zaten var). */
  noCsv?: boolean;
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
      : new Date(`${v}-15T12:00:00Z`).toLocaleDateString(localeOf(c.lang), {
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
export const otherReply = (l: LeadListDto) =>
  OTHER.map((k) => l.contact.channels[k]?.firstReplyAt ?? null)
    .filter((x): x is string => !!x)
    .sort()[0] ?? null;
const REPLIED = "replied";
/** Kanal hücresinin değer anahtarları: gönderildi mi (eski kayıtta bilinmiyor) ve dönüş alındı mı. */
const reachValues = (sent: boolean, replied: boolean, l: LeadListDto): string[] => [
  l.contact.state === "legacy" && !sent ? LEGACY : yn(sent),
  ...(replied ? [REPLIED] : []),
];
const reachLabel = (v: string, c: Ctx) => (v === REPLIED ? `✔ ${c.t("list.replyReceived")}` : ynLabel(v, c));
/** Excel hücresi: ✔/✘, dönüş varsa tarihiyle ("✔ · dönüş 12.03.2026"). */
const reachCsv = (sent: boolean, replyAt: string | null, c: Ctx) =>
  tick(sent) + (replyAt ? ` · ${c.t("list.reply")} ${ddmm(replyAt, c)}` : "");
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
    // Numara ve arama/WhatsApp bağlantıları tek hücrede, adın hemen yanında.
    id: "phone",
    group: "lead",
    label: "list.col.phone",
    param: "f_phone",
    kind: "values",
    values: (l) => [yn(!!l.phoneE164)],
    valueLabel: (v, c) => (v === YES ? c.t("list.has") : c.t("list.hasNot")),
    order: [YES, NO],
    text: (l) => (l.phoneE164 ? `${l.phoneE164} ${phoneText(l.phoneE164)}` : ""),
    sort: (l) => l.phoneE164 ?? "~",
    csv: (l) => l.phoneE164 ?? "",
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
    values: (l) => reachValues(channelSent(l, "email"), !!l.contact.channels.email?.firstReplyAt, l),
    valueLabel: reachLabel,
    order: [YES, REPLIED, NO, LEGACY],
    sort: (l) => (l.contact.channels.email?.count ?? 0) + (l.contact.channels.email?.firstReplyAt ? 0.5 : 0),
    csv: (l, c) => reachCsv(channelSent(l, "email"), l.contact.channels.email?.firstReplyAt ?? null, c),
  },
  {
    id: "wa",
    group: "reach",
    label: "list.col.wa",
    param: "f_wa",
    kind: "values",
    values: (l) => reachValues(channelSent(l, "whatsapp"), !!l.contact.channels.whatsapp?.firstReplyAt, l),
    valueLabel: reachLabel,
    order: [YES, REPLIED, NO, LEGACY],
    sort: (l) => (l.contact.channels.whatsapp?.count ?? 0) + (l.contact.channels.whatsapp?.firstReplyAt ? 0.5 : 0),
    csv: (l, c) => reachCsv(channelSent(l, "whatsapp"), l.contact.channels.whatsapp?.firstReplyAt ?? null, c),
  },
  {
    id: "other",
    group: "reach",
    label: "list.col.other",
    param: "f_other",
    kind: "values",
    values: (l) => reachValues(otherCount(l) > 0, !!otherReply(l), l),
    valueLabel: reachLabel,
    order: [YES, REPLIED, NO, LEGACY],
    sort: (l) => otherCount(l) + (otherReply(l) ? 0.5 : 0),
    csv: (l, c) => reachCsv(otherCount(l) > 0, otherReply(l), c),
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
  {
    // Yalnız girilmiş ürünler; formdan gelen kort sayısı "Kort sayısı" sütunundadır.
    id: "products",
    group: "products",
    label: "list.col.products",
    param: "f_products",
    kind: "values",
    values: (l) => (l.products.length ? l.products.map((p) => String(p.productId)) : [NONE]),
    valueLabel: (v, c) => (v === NONE ? c.t("product.none") : c.productName(Number(v))),
    sort: (l) => l.products.reduce((n, p) => n + p.qty, 0),
    csv: (l, c) => l.products.map((p) => `${p.qty} ${c.productName(p.productId)}`).join("; "),
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

/** Gizlenemeyen sütunlar: solda yapışık duran kimlik sütunları (tarih, ad). Sıra, yapışma sırasıdır. */
export const PINNED_COLUMNS: readonly string[] = ["createdAt", "name"];

export type ColumnRun = { kind: "col"; col: ColumnDef } | { kind: "gap"; cols: ColumnDef[] };

/**
 * Kullanıcının gizlediği sütunlar tablodan kalkmaz, Excel'deki gibi çift çizgili dar bir şeride iner; yan yana
 * gizlenenler tek şeritte birleşir. Sabit sütunlar gizli listesinde olsa da görünür kalır.
 */
export function columnRuns(cols: readonly ColumnDef[], hidden: readonly string[]): ColumnRun[] {
  const out: ColumnRun[] = [];
  for (const col of cols) {
    if (!hidden.includes(col.id) || PINNED_COLUMNS.includes(col.id)) {
      out.push({ kind: "col", col });
      continue;
    }
    const last = out[out.length - 1];
    if (last?.kind === "gap") last.cols.push(col);
    else out.push({ kind: "gap", cols: [col] });
  }
  return out;
}

/** Katlı grubun özet metni ("Ulaşıldı", "2 Panoramic Padel Court · 1 Padel Court Cover", "3 ay içinde · Tam kapalı"). */
export function groupSummary(g: GroupId, l: LeadListDto, c: Ctx): string {
  switch (g) {
    case "reach":
      return l.contact.state === "contacted"
        ? c.t("list.reached")
        : l.contact.state === "legacy"
          ? c.t("summary.legacyShort")
          : c.t("summary.never");
    case "products":
      return productLine(l.products, c.productName, 2) || "—";
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
