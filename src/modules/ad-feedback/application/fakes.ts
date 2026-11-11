/** Bellek içi sahteler: dağıtıcı ve adaptör testleri bunlarla çalışır. */
import type { OutboundStageEvent } from "../../sales-pipeline/application";
import type {
  DeadRow,
  OutboundDetail,
  OutboundRow,
  OutboxListFilter,
  OutboxStats,
  PlatformRequestStatus,
  PrepareResult,
  PreparedEvent,
  SendResult,
  SkipReason,
} from "./dto";
import type { OutboxRepository, PlatformSender, ReportMailer, ReportMessage } from "./ports";

export class InMemoryOutbox implements OutboxRepository {
  rows: OutboundDetail[] = [];
  private seq = 0;

  enqueue(stageEventId: string, provider: string, notBefore: Date): OutboundRow {
    const row = {
      id: `ob-${++this.seq}`,
      stageEventId,
      provider,
      status: "pending" as const,
      attempts: 0,
      nextAttemptAt: notBefore,
      skipReason: null,
      lastResponseCode: null,
      lastError: null,
      sentAt: null,
      createdAt: notBefore,
      finishedAt: null,
      requestId: null,
    };
    this.rows.push(row);
    return { ...row };
  }

  async claimDue(now: Date, limit: number, lockMs: number) {
    const due = this.rows
      .filter((r) => (r.status === "pending" || r.status === "failed") && r.nextAttemptAt <= now)
      .sort((a, b) => a.nextAttemptAt.getTime() - b.nextAttemptAt.getTime())
      .slice(0, limit);
    for (const r of due) {
      r.attempts += 1;
      r.nextAttemptAt = new Date(now.getTime() + lockMs);
    }
    return due.map((r) => ({ ...r }));
  }
  async markSent(ids: readonly string[], code: number, now: Date, requestId: string | null = null) {
    for (const r of this.rows)
      if (ids.includes(r.id))
        Object.assign(r, { status: "sent", lastResponseCode: code, sentAt: now, finishedAt: now, requestId });
  }
  async stats(): Promise<OutboxStats> {
    const counts = new Map<string, number>();
    const reasons = new Map<string, number>();
    for (const r of this.rows) {
      counts.set(`${r.provider}|${r.status}`, (counts.get(`${r.provider}|${r.status}`) ?? 0) + 1);
      if (r.status === "skipped" && r.skipReason)
        reasons.set(`${r.provider}|${r.skipReason}`, (reasons.get(`${r.provider}|${r.skipReason}`) ?? 0) + 1);
    }
    const due = this.rows.filter((r) => r.status === "pending" || r.status === "failed").map((r) => r.nextAttemptAt);
    const sent = this.rows.flatMap((r) => (r.status === "sent" && r.sentAt ? [r.sentAt] : []));
    const split = (k: string) => k.split("|") as [string, string];
    return {
      counts: [...counts].map(([k, count]) => ({
        provider: split(k)[0],
        status: split(k)[1] as OutboundRow["status"],
        count,
      })),
      skipReasons: [...reasons].map(([k, count]) => ({ provider: split(k)[0], reason: split(k)[1], count })),
      oldestDueAt: due.length ? new Date(Math.min(...due.map((d) => d.getTime()))) : null,
      lastSentAt: sent.length ? new Date(Math.max(...sent.map((d) => d.getTime()))) : null,
    };
  }
  async list(filter: OutboxListFilter): Promise<OutboundDetail[]> {
    return this.rows
      .filter((r) => filter.statuses.includes(r.status) && (!filter.provider || r.provider === filter.provider))
      .sort((a, b) => (b.finishedAt ?? b.createdAt).getTime() - (a.finishedAt ?? a.createdAt).getTime())
      .slice(0, filter.limit)
      .map((r) => ({ ...r }));
  }
  async findByIds(ids: readonly string[]): Promise<OutboundDetail[]> {
    return this.rows.filter((r) => ids.includes(r.id)).map((r) => ({ ...r }));
  }
  async requeue(ids: readonly string[], now: Date) {
    let n = 0;
    for (const r of this.rows) {
      if (!ids.includes(r.id) || (r.status !== "dead" && r.status !== "failed")) continue;
      if (r.status === "dead") Object.assign(r, { status: "pending", attempts: 0 });
      Object.assign(r, { nextAttemptAt: now, finishedAt: null });
      n += 1;
    }
    return n;
  }
  async markRetry(id: string, nextAttemptAt: Date, code: number | null, error: string) {
    Object.assign(this.row(id), { status: "failed", nextAttemptAt, lastResponseCode: code, lastError: error });
  }
  async markDead(id: string, code: number | null, error: string, now: Date) {
    Object.assign(this.row(id), { status: "dead", lastResponseCode: code, lastError: error, finishedAt: now });
  }
  async markSkipped(id: string, reason: SkipReason, now: Date) {
    Object.assign(this.row(id), { status: "skipped", skipReason: reason, finishedAt: now });
  }
  async listDead(since: Date): Promise<DeadRow[]> {
    return this.rows
      .filter((r) => r.status === "dead" && r.finishedAt && r.finishedAt >= since)
      .map((r) => ({
        id: r.id,
        stageEventId: r.stageEventId,
        provider: r.provider,
        attempts: r.attempts,
        lastResponseCode: r.lastResponseCode,
        lastError: r.lastError,
        finishedAt: r.finishedAt,
      }));
  }
  async enqueueMissing(stageEventIds: readonly string[], provider: string, notBefore: Date) {
    let n = 0;
    for (const id of stageEventIds) {
      if (this.rows.some((r) => r.stageEventId === id && r.provider === provider)) continue;
      this.enqueue(id, provider, notBefore);
      n += 1;
    }
    return n;
  }
  private row(id: string) {
    const r = this.rows.find((x) => x.id === id);
    if (!r) throw new Error(`outbox satırı yok: ${id}`);
    return r;
  }
}

/** Sonuçları sırayla verilen sahte gönderici; `sent` içinde her çağrının olayları durur. */
export class FakeSender implements PlatformSender {
  readonly provider: string;
  calls: PreparedEvent[][] = [];
  private results: SendResult[];
  /** prepare'de skip döndürülecek aşama olayı kimlikleri. */
  skipFor = new Map<string, SkipReason>();
  /** Verilirse sahte gönderici akıbet sorgusunu destekler (Faz 7c). */
  requestStatus?: (requestId: string) => Promise<PlatformRequestStatus>;

  constructor(provider: string, results: SendResult[] = [{ kind: "ok", code: 200 }]) {
    this.provider = provider;
    this.results = results;
  }
  prepare(context: OutboundStageEvent, eventName: string, row: OutboundRow): PrepareResult {
    const skip = this.skipFor.get(context.stageEventId);
    if (skip) return { kind: "skip", reason: skip };
    return { kind: "ready", event: { row, context, eventName, payload: { eventName, id: context.stageEventId } } };
  }
  async send(events: readonly PreparedEvent[]): Promise<SendResult> {
    this.calls.push([...events]);
    const next = this.results.length > 1 ? this.results.shift()! : this.results[0]!;
    if ((next as { throws?: boolean }).throws) throw new Error("ağ hatası");
    return next;
  }
}

export class RecordingMailer implements ReportMailer {
  sent: ReportMessage[] = [];
  async send(m: ReportMessage) {
    this.sent.push(m);
  }
}

/** Test bağlamı üretir. */
export const sampleContext = (over: Partial<OutboundStageEvent> = {}): OutboundStageEvent => ({
  stageEventId: "evt-1",
  leadId: "lead-1",
  stageCode: "QUALIFIED",
  occurredAt: new Date("2026-03-01T10:00:00Z"),
  undoneAt: null,
  origin: "manual",
  value: null,
  lead: {
    source: "meta_form",
    platformLeadId: "555000001",
    email: "ayse@example.com",
    phoneE164: "+905321234567",
    isTest: false,
    country: "TR",
    createdAt: new Date("2026-02-28T09:00:00Z"),
  },
  attribution: null,
  consents: [],
  ...over,
});
