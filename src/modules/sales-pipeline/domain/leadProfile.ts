import { isTerminal, type StageCode } from "./stage";

/**
 * Lead profili (Faz 7g, ADR-0014): müşteri durumu (D1) ve formdan gelen cevaplar (D5) kod listeleri.
 * Kodlar sabittir ve DB CHECK'leriyle aynıdır (migration 0012); görünen ad yalnız `src/i18n`'dedir.
 * Sıra Excel LİSTELER sırasıdır (iş emri §3.2).
 */

/** Müşteri durumu (Excel N sütunu); aşamadan bağımsızdır. NULL = "Durum girilmedi". */
export const CUSTOMER_STATUSES = [
  "interested",
  "not_interested",
  "project_phase",
  "collecting_prices",
  "buyer_ready",
] as const;
export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];
export const isCustomerStatus = (v: unknown): v is CustomerStatus =>
  typeof v === "string" && (CUSTOMER_STATUSES as readonly string[]).includes(v);

/** Ton ve ikon anahtarı: renk tek başına anlam taşımaz, her kodun ikonu ve metni var [K-M2]. */
export type StatusTone = "info" | "bad" | "neutral" | "warn" | "ok";
export const CUSTOMER_STATUS_STYLE: Readonly<Record<CustomerStatus, { tone: StatusTone; icon: string }>> = {
  interested: { tone: "info", icon: "checkCircle" },
  not_interested: { tone: "bad", icon: "ban" },
  project_phase: { tone: "neutral", icon: "ruler" },
  collecting_prices: { tone: "warn", icon: "tag" },
  buyer_ready: { tone: "ok", icon: "star" },
};

/** Kurulum yeri (Excel AD). */
export const INSTALL_SITES = [
  "covered_court",
  "no_site_yet",
  "indoor_hall",
  "beach_windy",
  "rooftop",
  "existing_ground",
  "other",
] as const;
export type InstallSite = (typeof INSTALL_SITES)[number];
export const isInstallSite = (v: unknown): v is InstallSite =>
  typeof v === "string" && (INSTALL_SITES as readonly string[]).includes(v);

/** Kurulum zamanı (Excel AE); yalnız "3 ay içinde" sıcak lead'dir. */
export const INSTALL_TIMELINES = ["m0_3", "m3_6", "m6_12", "researching"] as const;
export type InstallTimeline = (typeof INSTALL_TIMELINES)[number];
export const isInstallTimeline = (v: unknown): v is InstallTimeline =>
  typeof v === "string" && (INSTALL_TIMELINES as readonly string[]).includes(v);

export type TimelineHeat = "hot" | "warm" | "cool" | "cold";
const HEAT: Readonly<Record<InstallTimeline, TimelineHeat>> = {
  m0_3: "hot",
  m3_6: "warm",
  m6_12: "cool",
  researching: "cold",
};
export const timelineHeat = (t: InstallTimeline | null): TimelineHeat | null => (t === null ? null : HEAT[t]);

/** Müşteri profili (Excel AF). */
export const CUSTOMER_PROFILES = [
  "investor",
  "club_operator",
  "private_home",
  "public_facility",
  "hospitality_residential",
  "distributor",
] as const;
export type CustomerProfile = (typeof CUSTOMER_PROFILES)[number];
export const isCustomerProfile = (v: unknown): v is CustomerProfile =>
  typeof v === "string" && (CUSTOMER_PROFILES as readonly string[]).includes(v);

/** Kort sayısı bandı (Excel AG); formda kesin sayı varsa `court_count` ayrıca dolar. */
export const COURT_COUNT_BANDS = ["1", "2_3", "4_6", "7_plus"] as const;
export type CourtCountBand = (typeof COURT_COUNT_BANDS)[number];
export const isCourtCountBand = (v: unknown): v is CourtCountBand =>
  typeof v === "string" && (COURT_COUNT_BANDS as readonly string[]).includes(v);

/** Kesin kort sayısının bandı: 1 → "1", 2–3 → "2_3", 4–6 → "4_6", ≥ 7 → "7_plus"; 1'den küçük ya da tam sayı değilse null. */
export function bandForCount(n: number): CourtCountBand | null {
  if (!Number.isInteger(n) || n < 1) return null;
  if (n === 1) return "1";
  if (n <= 3) return "2_3";
  if (n <= 6) return "4_6";
  return "7_plus";
}

/** Reklam yüzeyi opak koddur (`ig`, `fb`, `web`…); etiketi yalnız `src/i18n` `surface.*` bilir. */
export const AD_SURFACE_RE = /^[a-z0-9_]{1,32}$/;
export const isAdSurface = (v: unknown): v is string => typeof v === "string" && AD_SURFACE_RE.test(v);

/** Sıcak lead: kurulum "3 ay içinde" ve aşama açık. */
export const isHotLead = (lead: { installTimeline: InstallTimeline | null; currentStage: StageCode }): boolean =>
  lead.installTimeline === "m0_3" && !isTerminal(lead.currentStage);
