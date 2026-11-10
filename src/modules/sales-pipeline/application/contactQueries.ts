import { RuleError, err, ok, type Result } from "../../shared/kernel";
import {
  DEFAULT_TIME_ZONE,
  atLocalHour,
  isActivityOutcome,
  isActivityType,
  type Activity,
  type ActivityOutcome,
  type ActivityType,
  type Lead,
} from "../domain";
import type { Actor, UseCaseDeps } from "./types";
import { territoriesOf } from "./visibility";

/**
 * Temas geçmişi (Faz 7g, Excel TEMAS GEÇMİŞİ sayfası; iş emri §4.2). Görünür lead'lerin tamamlanmış aktiviteleri,
 * en yeni önce, `(done_at DESC, id DESC)` anahtar kümesiyle sayfalanır [M-I7]. Her satıra aynı kaydın açık
 * "sonraki takip"i eklenir.
 */
export interface HistoryInput {
  actor: Actor;
  /** YYYY-MM-DD (İstanbul günü), dahil. */
  from?: string | undefined;
  /** YYYY-MM-DD, dahil. */
  to?: string | undefined;
  type?: unknown;
  outcome?: unknown;
  /** Lead sahibi; "pool" = havuz. */
  owner?: string | undefined;
  /** Kaydeden. */
  doneBy?: string | undefined;
  /** Lead adı / firma. */
  q?: string | undefined;
  /** Not metni. */
  note?: string | undefined;
  /** "<iso>|<id>" */
  before?: string | undefined;
  limit?: number | undefined;
}

export interface HistoryItem {
  activity: Activity;
  lead: Lead;
  next: { id: string; type: ActivityType; dueAt: Date } | null;
}

export interface HistoryPage {
  items: HistoryItem[];
  nextBefore: string | null;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** YYYY-MM-DD → o günün yerel 00:00'ı (+ `days`). Geçersizse null. */
export function localDayStart(ymd: string, days: number, timeZone: string): Date | null {
  if (!YMD.test(ymd)) return null;
  const noon = new Date(`${ymd}T12:00:00Z`);
  if (Number.isNaN(noon.getTime())) return null;
  return atLocalHour(noon, days, 0, timeZone);
}

/** Tarih aralığı ayrıştırma (rapor ve geçmiş ortak): `code` hata kodu (`history.range`, `report.range`). */
export function parseDayRange(
  from: string | undefined,
  to: string | undefined,
  timeZone: string,
  code: string,
): Result<{ from: Date | undefined; to: Date | undefined }, RuleError> {
  const f = from ? localDayStart(from, 0, timeZone) : undefined;
  const t = to ? localDayStart(to, 1, timeZone) : undefined;
  if (f === null || t === null || (f && t && f.getTime() >= t.getTime())) {
    return err(new RuleError(code, "Tarih aralığı geçersiz.", { from, to }));
  }
  return ok({ from: f, to: t });
}

export class ContactQueries {
  constructor(private readonly deps: UseCaseDeps) {}

  async history(input: HistoryInput): Promise<Result<HistoryPage, RuleError>> {
    const tz = this.deps.timeZone ?? DEFAULT_TIME_ZONE;
    const range = parseDayRange(input.from, input.to, tz, "history.range");
    if (!range.ok) return range;
    let before: { at: Date; id: string } | undefined;
    if (input.before) {
      const [iso, id] = input.before.split("|");
      const at = new Date(iso ?? "");
      if (!id || Number.isNaN(at.getTime())) {
        return err(new RuleError("history.range", "Sayfa imleci geçersiz.", {}));
      }
      before = { at, id };
    }
    const limit = Math.min(1000, Math.max(1, Math.floor(input.limit ?? 200)));
    const type: ActivityType | undefined = isActivityType(input.type) ? input.type : undefined;
    const outcome: ActivityOutcome | undefined = isActivityOutcome(input.outcome) ? input.outcome : undefined;

    return this.deps.uow.run(async (repos) => {
      const visibleTo = input.actor.isAdmin
        ? undefined
        : { userId: input.actor.userId, countries: territoriesOf(input.actor.userId, await repos.territories.all()) };
      const owner =
        input.owner === undefined || input.owner === "" ? undefined : input.owner === "pool" ? null : input.owner;
      const leads = await repos.leads.list({
        visibleTo,
        includeTest: true,
        owner,
        search: input.q?.trim() || undefined,
      });
      const byId = new Map(leads.map((l) => [l.id, l]));
      const rows = await repos.activities.listDone({
        leadIds: [...byId.keys()],
        from: range.value.from,
        to: range.value.to,
        type,
        outcome,
        doneBy: input.doneBy || undefined,
        note: input.note?.trim() || undefined,
        before,
        limit: limit + 1,
      });
      const page = rows.slice(0, limit);
      const logIds = new Set(page.map((a) => a.logId).filter((x): x is string => x !== null));
      const open = logIds.size ? await repos.activities.listOpenByLeads([...new Set(page.map((a) => a.leadId))]) : [];
      const nextByLog = new Map<string, Activity>();
      for (const a of open) if (a.nextOfLogId && logIds.has(a.nextOfLogId)) nextByLog.set(a.nextOfLogId, a);
      const items: HistoryItem[] = [];
      for (const activity of page) {
        const lead = byId.get(activity.leadId);
        if (!lead) continue;
        const n = activity.logId ? nextByLog.get(activity.logId) : undefined;
        items.push({ activity, lead, next: n ? { id: n.id, type: n.type, dueAt: n.dueAt } : null });
      }
      const last = page[page.length - 1];
      return ok({
        items,
        nextBefore: rows.length > limit && last?.doneAt ? `${last.doneAt.toISOString()}|${last.id}` : null,
      });
    });
  }
}
