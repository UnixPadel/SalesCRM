// Pure business rules. No storage, no React — easy to unit test and to reuse server-side.
import { EUR_RATE, OPEN_STAGES, STAGE, STAGES } from "./constants";
import type { Activity, Deal, DealStageChange, StageKey } from "./types";

const DAY = 86_400_000;

export const now = () => new Date();
export const todayISO = (d = now()) => localDate(d);
export function localDate(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);
export const daysSince = (iso: string, ref = now()) =>
  Math.max(0, Math.floor((ref.getTime() - new Date(iso).getTime()) / DAY));

export const toEUR = (d: Pick<Deal, "value" | "currency">) => d.value * (EUR_RATE[d.currency] ?? 1);
export const isOpenDeal = (d: Deal) => STAGE[d.stage].open && !d.won_at;
export const isWon = (d: Deal) => !!d.won_at;

export const openActivitiesOf = (dealId: string, activities: Activity[]) =>
  activities.filter((a) => a.deal_id === dealId && !a.done);

/**
 * Rule 1 — an open customer with no planned (not done) activity is "unattended".
 * Only applied to open columns: sold and red-line customers need no next step.
 */
export function isRotting(deal: Deal, activities: Activity[]) {
  if (!isOpenDeal(deal)) return false;
  return openActivitiesOf(deal.id, activities).length === 0;
}

export type ActivityStatus = "overdue" | "today" | "planned" | "none";
/** Next-activity indicator for a card. */
export function nextActivity(dealId: string, activities: Activity[]) {
  const open = openActivitiesOf(dealId, activities).sort((a, b) => a.due_at.localeCompare(b.due_at));
  const next = open[0];
  let status: ActivityStatus = "none";
  if (next) status = activityBucket(next);
  return { next, status };
}

export function activityBucket(a: Activity, ref = now()): "overdue" | "today" | "planned" {
  const day = a.due_at.slice(0, 10);
  const t = todayISO(ref);
  if (day < t) return "overdue";
  if (day > t) return "planned";
  // due today: past the time counts as overdue
  return a.due_at.length > 10 && new Date(a.due_at) < ref ? "overdue" : "today";
}

/** Last completed touch with the customer (for "son temas: 3 gün önce"). */
export function lastTouch(dealId: string, activities: Activity[]) {
  return activities
    .filter((a) => a.deal_id === dealId && a.done)
    .map((a) => a.done_at || a.due_at)
    .sort()
    .pop();
}

export interface StageStats {
  stage: StageKey;
  count: number;
  totalEUR: number;
  avgDays: number;
}
/** Rule 4 — per-column count, total value and average days sitting in the column. */
export function stageStats(deals: Deal[], ref = now()): Record<StageKey, StageStats> {
  const out = {} as Record<StageKey, StageStats>;
  for (const s of STAGES) {
    const inStage = deals.filter((d) => d.stage === s.key);
    const days = inStage.map((d) => daysSince(d.stage_entered_at, ref));
    out[s.key] = {
      stage: s.key,
      count: inStage.length,
      totalEUR: inStage.reduce((sum, d) => sum + toEUR(d), 0),
      avgDays: days.length ? Math.round(days.reduce((a, b) => a + b, 0) / days.length) : 0,
    };
  }
  return out;
}

/* ---------------- reports ---------------- */

export function wonPerMonth(deals: Deal[], months = 12, ref = now()) {
  const rows: { key: string; label: string; count: number; valueEUR: number }[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(ref.getFullYear(), ref.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleDateString("tr-TR", { month: "short", year: "2-digit" });
    rows.push({ key, label, count: 0, valueEUR: 0 });
  }
  for (const deal of deals) {
    if (!deal.won_at) continue;
    const r = rows.find((x) => x.key === deal.won_at!.slice(0, 7));
    if (r) {
      r.count++;
      r.valueEUR += toEUR(deal);
    }
  }
  return rows;
}

/**
 * Conversion per column: of the closed customers (sold or red line) that ever reached a column,
 * the share that was sold. Open customers are excluded so the rate isn't diluted by work in progress.
 */
export function winRateByStage(deals: Deal[], changes: DealStageChange[]) {
  const reached = new Map<string, Set<StageKey>>();
  for (const c of changes) {
    if (!reached.has(c.deal_id)) reached.set(c.deal_id, new Set());
    reached.get(c.deal_id)!.add(c.to_stage);
  }
  return OPEN_STAGES.map((stage) => {
    const touched = deals.filter((d) => reached.get(d.id)?.has(stage) || d.stage === stage);
    const closed = touched.filter((d) => !isOpenDeal(d));
    const won = closed.filter(isWon);
    return {
      stage,
      reached: touched.length,
      closed: closed.length,
      won: won.length,
      rate: closed.length ? won.length / closed.length : null,
    };
  });
}

export function pipelineByCountry(deals: Deal[], countryOf: (d: Deal) => string) {
  const m = new Map<string, { country: string; count: number; valueEUR: number }>();
  for (const d of deals) {
    if (!isOpenDeal(d)) continue;
    const c = countryOf(d) || "";
    const r = m.get(c) ?? { country: c, count: 0, valueEUR: 0 };
    r.count++;
    r.valueEUR += toEUR(d);
    m.set(c, r);
  }
  return [...m.values()].sort((a, b) => b.valueEUR - a.valueEUR);
}

/** Weighted value: value × column probability. */
export const weightedEUR = (d: Deal) => (toEUR(d) * STAGE[d.stage].probability) / 100;
