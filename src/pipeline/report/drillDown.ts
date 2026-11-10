/**
 * Özet rapor hücresinden Lead listesine iniş (Faz 7g, iş emri §5.5 [U-B1a][U-I17]): saf fonksiyon, **tam ve açık**
 * süzgeç yazar (`#/list?from=report&…`); liste aynı tanımlarla o hücrenin lead'lerini açar.
 */
export interface ReportFilters {
  scope: "excel" | null;
  source: string | null;
  campaign: string | null;
  /** YYYY-MM-DD (lead oluşturma günü), dahil. */
  from: string | null;
  to: string | null;
  owner: string | null;
}

export type Metric =
  | "total"
  | "mailSent"
  | "whatsappSent"
  | "neverReached"
  | "legacyNoContact"
  | "contacted"
  | "replied"
  | "proposalGiven"
  | "buyers";

export interface CellSelector {
  metric?: Metric;
  /** undefined = sahip süzgeci yok; null = ortak havuz. */
  owner?: string | null | undefined;
  /** Havuz alt satırı: Excel'deki sorumlu etiketi (null = "Excel'de sorumlu yok"). */
  excelOwner?: string | null | undefined;
  status?: string | undefined;
  timeline?: string | null | undefined;
  product?: "standard" | "panoramic" | "full_panoramic" | "roof" | undefined;
  within?: "proposal" | "buyer" | undefined;
  closing?: boolean | undefined;
}

const PRODUCT_PARAM: Record<NonNullable<CellSelector["product"]>, string> = {
  standard: "f_standard",
  panoramic: "f_panoramic",
  full_panoramic: "f_fullPanoramic",
  roof: "f_roof",
};

export function drillDownParams(f: ReportFilters, s: CellSelector, label: string): URLSearchParams {
  const p = new URLSearchParams();
  p.set("from", "report");
  if (label) p.set("fromLabel", label);
  if (f.scope) p.set("scope", f.scope);
  if (f.source) p.set("source", f.source);
  if (f.campaign) p.set("campaign", f.campaign);
  if (f.from || f.to) p.set("f_created", `${f.from ?? ""}..${f.to ?? ""}`);
  const owner = s.owner !== undefined ? s.owner : f.owner;
  if (owner !== undefined && owner !== null) p.set("owner", owner);
  if (s.owner === null) p.set("owner", "pool");
  if (s.excelOwner !== undefined) p.set("f_excelOwner", s.excelOwner ?? "none");
  switch (s.metric) {
    case "mailSent":
      p.set("f_mail", "yes");
      break;
    case "whatsappSent":
      p.set("f_wa", "yes");
      break;
    case "neverReached":
      p.set("contact", "never");
      break;
    case "legacyNoContact":
      p.set("contact", "legacy");
      break;
    case "contacted":
      p.set("contact", "contacted");
      break;
    case "replied":
      p.set("contact", "replied");
      break;
    case "proposalGiven":
      p.set("f_proposal", "yes");
      break;
    case "buyers":
      p.set("f_status", "buyer_ready");
      break;
    default:
      break;
  }
  if (s.status) p.set("f_status", s.status);
  if (s.timeline !== undefined) p.set("f_timeline", s.timeline ?? "none");
  if (s.product) p.set(PRODUCT_PARAM[s.product], "yes");
  if (s.within === "proposal") p.set("f_proposal", "yes");
  if (s.within === "buyer") p.set("f_status", "buyer_ready");
  if (s.closing) p.set("f_site", "covered_court");
  return p;
}

export const drillDownHref = (f: ReportFilters, s: CellSelector, label: string) =>
  `#/list?${drillDownParams(f, s, label).toString()}`;
