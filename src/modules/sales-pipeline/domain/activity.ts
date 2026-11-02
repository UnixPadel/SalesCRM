import { RuleError, err, ok, type Result } from "../../shared/kernel";
import { isTerminal, type StageCode } from "./stage";

/**
 * Aktivite: lead üzerinde yapılacak iş (satış panosu, Faz 6a). Saf kurallar burada; tarih hesapları
 * saat dilimine göre yapılır çünkü "bugün" ve "09:00" satışçının takvimine göredir, sunucununkine değil.
 */
export const ACTIVITY_TYPES = ["call", "email", "meeting", "proposal_sent", "site_visit"] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];
export const isActivityType = (v: unknown): v is ActivityType =>
  typeof v === "string" && (ACTIVITY_TYPES as readonly string[]).includes(v);

export interface Activity {
  id: string;
  leadId: string;
  type: ActivityType;
  subject: string;
  dueAt: Date;
  /** null = açık (yapılmadı). */
  doneAt: Date | null;
  notes: string;
  /** Sistem açtı (ör. teklif takibi). */
  autoCreated: boolean;
  /** Otomatik aktiviteyi açan aşama değişikliği; geri al bu kimlikle siler. */
  createdByChangeId: string | null;
  createdByUserId: string | null;
  /** Eski panodan taşınan aktivitenin kimliği; yalnız taşıma betiği doldurur. */
  legacyId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export const isOpenActivity = (a: Pick<Activity, "doneAt">): boolean => a.doneAt === null;

export const DEFAULT_TIME_ZONE = "Europe/Istanbul";

export const DEFAULT_SUBJECTS: Record<ActivityType, string> = {
  call: "Arama",
  email: "E-posta",
  meeting: "Toplantı",
  proposal_sent: "Teklif gönderimi",
  site_visit: "Saha ziyareti",
};

/** Takvim günü, YYYY-MM-DD, verilen saat diliminde. */
export function calendarDay(d: Date, timeZone: string = DEFAULT_TIME_ZONE): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

function tzOffsetMs(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const wall = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return wall - at.getTime();
}

/** `base`in saat dilimindeki takvim gününden `daysAhead` gün sonra, yerel saat `hour`:00. */
export function atLocalHour(base: Date, daysAhead: number, hour: number, timeZone: string = DEFAULT_TIME_ZONE): Date {
  const [y, m, d] = calendarDay(base, timeZone).split("-").map(Number) as [number, number, number];
  const wall = new Date(Date.UTC(y, m - 1, d + daysAhead, hour));
  return new Date(wall.getTime() - tzOffsetMs(wall, timeZone));
}

export type ActivityBucket = "overdue" | "today" | "upcoming";

/** "Bugün" sayfasının üç kümesi; takvim gününe göre, saate değil. */
export function bucketOf(dueAt: Date, now: Date, timeZone: string = DEFAULT_TIME_ZONE): ActivityBucket {
  const due = calendarDay(dueAt, timeZone);
  const today = calendarDay(now, timeZone);
  return due < today ? "overdue" : due === today ? "today" : "upcoming";
}

export interface FollowUpRule {
  days: number;
  hour: number;
  timeZone: string;
}

export const PROPOSAL_FOLLOW_UP: FollowUpRule = { days: 3, hour: 9, timeZone: DEFAULT_TIME_ZONE };
export const FOLLOW_UP_SUBJECT = "Teklif takibi";

/** Kural 2: "Teklif gönderildi"ye giriş 3 gün sonra 09:00 için arama planlar. Başka aşamada yok. */
export function followUpFor(
  stage: StageCode,
  now: Date,
  rule: FollowUpRule = PROPOSAL_FOLLOW_UP,
): { type: ActivityType; subject: string; dueAt: Date } | null {
  if (stage !== "PROPOSAL") return null;
  return { type: "call", subject: FOLLOW_UP_SUBJECT, dueAt: atLocalHour(now, rule.days, rule.hour, rule.timeZone) };
}

export interface NextActivity {
  id: string;
  type: ActivityType;
  subject: string;
  dueAt: Date;
}

export interface ActivitySummary {
  openActivities: number;
  /** En yakın vadeli açık aktivite. */
  nextActivity: NextActivity | null;
  rotting: boolean;
}

/** Kural 1: açık aşamadaki lead'in bitmemiş aktivitesi yoksa takipsizdir. Terminal aşama takipsiz sayılmaz. */
export const isRotting = (stage: StageCode, openActivities: number): boolean =>
  !isTerminal(stage) && openActivities === 0;

export function summarizeActivities(stage: StageCode, activities: readonly Activity[]): ActivitySummary {
  const open = activities.filter(isOpenActivity).sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
  const next = open[0];
  return {
    openActivities: open.length,
    nextActivity: next ? { id: next.id, type: next.type, subject: next.subject, dueAt: next.dueAt } : null,
    rotting: isRotting(stage, open.length),
  };
}

export interface ActivityDraftInput {
  type: unknown;
  subject?: string | null | undefined;
  dueAt: Date | null | undefined;
  notes?: string | null | undefined;
}

export interface ActivityDraft {
  type: ActivityType;
  subject: string;
  dueAt: Date;
  notes: string;
}

/** Girdi doğrulama: tür listede, tarih geçerli; konu boşsa türün varsayılanı. */
export function validateActivity(input: ActivityDraftInput): Result<ActivityDraft, RuleError> {
  if (!isActivityType(input.type)) {
    return err(new RuleError("activity.type_unknown", "Bilinmeyen aktivite türü.", { type: input.type }));
  }
  const dueAt = input.dueAt;
  if (!(dueAt instanceof Date) || Number.isNaN(dueAt.getTime())) {
    return err(new RuleError("activity.due_required", "Aktivite için tarih seçin.", {}));
  }
  const subject = String(input.subject ?? "")
    .trim()
    .slice(0, 200);
  return ok({
    type: input.type,
    subject: subject || DEFAULT_SUBJECTS[input.type],
    dueAt,
    notes: String(input.notes ?? "")
      .trim()
      .slice(0, 4000),
  });
}
