import { calendarDay, DEFAULT_TIME_ZONE } from "./activity";
import type { Lead, StageEvent } from "./lead";
import { DEFAULT_EUR_RATES, stageSummary, toEur, type EurRates } from "./opportunity";
import { isTerminal, STAGE_CODES, type StageCode } from "./stage";

/**
 * Raporlar (satış panosu, Faz 6c). Saf kod: lead'ler ve geri alınmamış aşama olaylarından türetilir; I/O yok.
 * Ay sınırları satış ekibinin takvimine göredir (Europe/Istanbul), sunucununkine değil.
 */

export interface ReportInput {
  leads: readonly Lead[];
  /** Bu lead'lerin tüm aşama olayları (geri alınanlar burada elenir). */
  events: readonly StageEvent[];
  now: Date;
  /** Aylık serilerde kaç ay geriye bakılır (bu ay dahil). */
  months?: number | undefined;
  timeZone?: string | undefined;
  rates?: EurRates | undefined;
}

export interface MonthRow {
  /** YYYY-MM */
  month: string;
  count: number;
  totalEur: number;
}

export interface StageConversionRow {
  stage: StageCode;
  /** Bu aşamaya hiç ulaşmış lead sayısı. */
  reached: number;
  /** Ulaşanlardan kapananlar (Kazanıldı + Kaybedildi). */
  closed: number;
  won: number;
  /** won / closed; kapanan yoksa null. Açık lead'ler oranı sulandırmasın diye dışarıda. */
  rate: number | null;
}

export interface CountryRow {
  /** ISO-2 ya da "" (bilinmiyor). */
  country: string;
  count: number;
  totalEur: number;
}

export interface LostReasonRow {
  /** Neden kodu; neden yoksa "unspecified". */
  code: string;
  count: number;
}

export interface SourceRow {
  source: Lead["source"];
  /** Dönemde oluşturulan lead sayısı. */
  count: number;
  /** Bunlardan kazanılanlar. */
  won: number;
}

export interface ReportKpis {
  openCount: number;
  openTotalEur: number;
  wonThisMonth: { count: number; totalEur: number };
  /** Kapananlar içinde kazanılma payı; kapanan yoksa null. */
  closedWon: number;
  closedLost: number;
  winRate: number | null;
}

export interface Report {
  /** Serilerin kapsadığı aylar, eskiden yeniye (YYYY-MM). */
  months: string[];
  kpis: ReportKpis;
  wonByMonth: MonthRow[];
  conversionByStage: StageConversionRow[];
  openByCountry: CountryRow[];
  lostReasons: LostReasonRow[];
  leadsBySource: SourceRow[];
}

export const monthKey = (d: Date, timeZone: string = DEFAULT_TIME_ZONE): string => calendarDay(d, timeZone).slice(0, 7);

/** Bu ay dahil geriye `n` ay, eskiden yeniye. */
export function lastMonths(now: Date, n: number, timeZone: string = DEFAULT_TIME_ZONE): string[] {
  const [y, m] = monthKey(now, timeZone).split("-").map(Number) as [number, number];
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function liveEventsByLead(events: readonly StageEvent[]): Map<string, StageEvent[]> {
  const by = new Map<string, StageEvent[]>();
  for (const e of events) {
    if (e.undoneAt) continue;
    by.set(e.leadId, [...(by.get(e.leadId) ?? []), e]);
  }
  for (const list of by.values()) list.sort((a, b) => a.sequence - b.sequence);
  return by;
}

export function buildReport(input: ReportInput): Report {
  const timeZone = input.timeZone ?? DEFAULT_TIME_ZONE;
  const rates = input.rates ?? DEFAULT_EUR_RATES;
  const months = lastMonths(input.now, input.months ?? 12, timeZone);
  const monthSet = new Set(months);
  const live = liveEventsByLead(input.events);
  const leads = input.leads.filter((l) => !l.isTest);
  const eur = (v: { amount: number; currency: string } | null) => (v ? (toEur(v, rates) ?? 0) : 0);

  // Aylık kazanılan: WON olayının ayı; tutar olaydaki (yoksa son geçerli tutar).
  const won = new Map(months.map((m) => [m, { month: m, count: 0, totalEur: 0 }]));
  const thisMonth = months[months.length - 1]!;
  for (const l of leads) {
    const ev = live.get(l.id) ?? [];
    const w = [...ev].reverse().find((e) => e.stageCode === "WON");
    if (!w) continue;
    const key = monthKey(w.occurredAt, timeZone);
    if (!monthSet.has(key)) continue;
    const row = won.get(key)!;
    row.count++;
    row.totalEur = round2(row.totalEur + eur(w.value ?? stageSummary(l, ev).value));
  }

  // Aşamaya göre dönüşüm (açık aşamalar): ulaşan / kapanan / kazanan.
  const conversionByStage: StageConversionRow[] = STAGE_CODES.filter((s) => !isTerminal(s)).map((stage) => {
    const reachedLeads = leads.filter(
      (l) => l.currentStage === stage || (live.get(l.id) ?? []).some((e) => e.stageCode === stage),
    );
    const closed = reachedLeads.filter((l) => isTerminal(l.currentStage));
    const wonN = closed.filter((l) => l.currentStage === "WON").length;
    return {
      stage,
      reached: reachedLeads.length,
      closed: closed.length,
      won: wonN,
      rate: closed.length ? round2(wonN / closed.length) : null,
    };
  });

  // Ülkeye göre açık hat: terminal olmayan lead'ler, son geçerli tutarla.
  const byCountry = new Map<string, CountryRow>();
  let openCount = 0;
  let openTotalEur = 0;
  for (const l of leads) {
    if (isTerminal(l.currentStage)) continue;
    const value = eur(stageSummary(l, live.get(l.id) ?? []).value);
    openCount++;
    openTotalEur += value;
    const c = (l.country ?? "").toUpperCase();
    const row = byCountry.get(c) ?? { country: c, count: 0, totalEur: 0 };
    row.count++;
    row.totalEur = round2(row.totalEur + value);
    byCountry.set(c, row);
  }
  const openByCountry = [...byCountry.values()].sort(
    (a, b) => b.totalEur - a.totalEur || b.count - a.count || a.country.localeCompare(b.country),
  );

  // Kayıp nedenleri: bugün Kaybedildi'de olan lead'in son LOST olayındaki kod.
  const reasons = new Map<string, number>();
  let closedLost = 0;
  let closedWon = 0;
  for (const l of leads) {
    if (l.currentStage === "WON") closedWon++;
    if (l.currentStage !== "LOST") continue;
    closedLost++;
    const lost = [...(live.get(l.id) ?? [])].reverse().find((e) => e.stageCode === "LOST");
    const code = lost?.lostReasonCode ?? "unspecified";
    reasons.set(code, (reasons.get(code) ?? 0) + 1);
  }
  const lostReasons = [...reasons.entries()]
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));

  // Kaynağa göre lead: dönemde oluşturulanlar ve kazanılanları.
  const bySource = new Map<Lead["source"], SourceRow>();
  for (const l of leads) {
    if (!monthSet.has(monthKey(l.createdAt, timeZone))) continue;
    const row = bySource.get(l.source) ?? { source: l.source, count: 0, won: 0 };
    row.count++;
    if (l.currentStage === "WON") row.won++;
    bySource.set(l.source, row);
  }
  const leadsBySource = [...bySource.values()].sort((a, b) => b.count - a.count || a.source.localeCompare(b.source));

  const closed = closedWon + closedLost;
  return {
    months,
    kpis: {
      openCount,
      openTotalEur: round2(openTotalEur),
      wonThisMonth: { count: won.get(thisMonth)!.count, totalEur: won.get(thisMonth)!.totalEur },
      closedWon,
      closedLost,
      winRate: closed ? round2(closedWon / closed) : null,
    },
    wonByMonth: months.map((m) => won.get(m)!),
    conversionByStage,
    openByCountry,
    lostReasons,
    leadsBySource,
  };
}
