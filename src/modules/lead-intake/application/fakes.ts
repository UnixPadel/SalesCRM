/** Bellek içi inbox ve sahte adaptörler: application ve adaptör testleri bunlarla çalışır. */
import type { InboxEvent, InboxFailedItem, InboxStats, InboundLeadDto, NewInboxEvent } from "./dto";
import type { AdapterContext, BackfillSource, InboxRepository, SourceAdapter } from "./ports";

export class InMemoryInbox implements InboxRepository {
  rows: InboxEvent[] = [];

  async enqueue(e: NewInboxEvent) {
    if (this.rows.some((r) => r.dedupeKey === e.dedupeKey)) return "duplicate" as const;
    this.rows.push({
      ...e,
      payload: structuredClone(e.payload),
      status: "pending",
      attempts: 0,
      lastErrorCode: null,
      lastError: null,
      leadId: null,
      processedAt: null,
    });
    return "inserted" as const;
  }

  async claimDue(now: Date, limit: number, lockMs: number) {
    const due = this.rows
      .filter(
        (r) =>
          (r.status === "pending" && r.nextAttemptAt <= now) || (r.status === "processing" && r.nextAttemptAt <= now),
      )
      .sort((a, b) => a.nextAttemptAt.getTime() - b.nextAttemptAt.getTime())
      .slice(0, limit);
    for (const r of due) {
      r.status = "processing";
      r.attempts += 1;
      r.nextAttemptAt = new Date(now.getTime() + lockMs);
    }
    return due.map((r) => ({ ...r, payload: structuredClone(r.payload) }));
  }

  async markDone(id: string, leadId: string, now: Date) {
    const r = this.row(id);
    r.status = "done";
    r.leadId = leadId;
    r.processedAt = now;
  }

  async markRetry(id: string, nextAttemptAt: Date, error: { code: string; message: string }) {
    const r = this.row(id);
    r.status = "pending";
    r.nextAttemptAt = nextAttemptAt;
    r.lastErrorCode = error.code;
    r.lastError = error.message;
  }

  async markFailed(id: string, error: { code: string; message: string }, now: Date) {
    const r = this.row(id);
    r.status = "failed";
    r.lastErrorCode = error.code;
    r.lastError = error.message;
    r.processedAt = now;
  }

  async purgePayloads(olderThan: Date) {
    let n = 0;
    for (const r of this.rows) {
      if (r.receivedAt < olderThan && r.payload !== null) {
        r.payload = null;
        n += 1;
      }
    }
    if (n) this.lastPurgedAt = olderThan;
    return n;
  }

  async findByDedupeKey(key: string) {
    const r = this.rows.find((x) => x.dedupeKey === key);
    return r ? { ...r } : undefined;
  }

  /** Temizlik işinin son çalıştığı an (sahte depo yalnız bunu tutar). */
  lastPurgedAt: Date | null = null;

  async stats(daySince: Date, purgeBefore: Date): Promise<InboxStats> {
    const counts = new Map<string, number>();
    for (const r of this.rows)
      counts.set(`${r.provider}|${r.status}`, (counts.get(`${r.provider}|${r.status}`) ?? 0) + 1);
    const open = this.rows.filter((r) => r.status === "pending" || r.status === "processing");
    return {
      counts: [...counts].map(([k, count]) => {
        const [provider, status] = k.split("|") as [string, InboxEvent["status"]];
        return { provider, status, count };
      }),
      receivedLastDay: this.rows.filter((r) => r.receivedAt >= daySince).length,
      oldestPendingAt: open.length ? new Date(Math.min(...open.map((r) => r.receivedAt.getTime()))) : null,
      lastPurgedAt: this.lastPurgedAt,
      purgeBacklog: this.rows.filter((r) => r.receivedAt < purgeBefore && r.payload !== null).length,
    };
  }

  async listFailed(limit: number): Promise<InboxFailedItem[]> {
    return this.rows
      .filter((r) => r.status === "failed")
      .sort((a, b) => (b.processedAt ?? b.receivedAt).getTime() - (a.processedAt ?? a.receivedAt).getTime())
      .slice(0, limit)
      .map((r) => ({
        id: r.id,
        provider: r.provider,
        kind: r.kind,
        receivedAt: r.receivedAt,
        attempts: r.attempts,
        lastErrorCode: r.lastErrorCode,
        lastError: r.lastError,
        leadId: r.leadId,
        processedAt: r.processedAt,
        hasPayload: r.payload !== null,
      }));
  }

  async requeueable(ids: readonly string[]) {
    return this.rows.filter((r) => ids.includes(r.id) && r.status === "failed" && r.payload !== null).map((r) => r.id);
  }

  async requeue(ids: readonly string[], now: Date) {
    let n = 0;
    for (const r of this.rows) {
      if (!ids.includes(r.id) || r.status !== "failed" || r.payload === null) continue;
      Object.assign(r, { status: "pending", attempts: 0, nextAttemptAt: now, processedAt: null });
      n += 1;
    }
    return n;
  }

  private row(id: string): InboxEvent {
    const r = this.rows.find((x) => x.id === id);
    if (!r) throw new Error(`inbox satırı yok: ${id}`);
    return r;
  }
}

/** Payload'ı verilen fonksiyonla DTO'ya çeviren sahte adaptör. */
export class FakeAdapter implements SourceAdapter {
  calls = 0;
  constructor(
    readonly provider: string,
    private readonly fn: (payload: unknown, ctx: AdapterContext, call: number) => Promise<InboundLeadDto>,
  ) {}
  toInboundLead(payload: unknown, ctx: AdapterContext) {
    this.calls += 1;
    return this.fn(payload, ctx, this.calls);
  }
}

export class FakeBackfill implements BackfillSource {
  calls: Date[] = [];
  constructor(
    readonly provider: string,
    private readonly fn: (since: Date) => Promise<{ dedupeKey: string; payload: unknown }[]>,
  ) {}
  fetchSince(since: Date) {
    this.calls.push(since);
    return this.fn(since);
  }
}

export const sampleDto = (over: Partial<InboundLeadDto> = {}): InboundLeadDto => ({
  source: "meta_form",
  provider: "fake",
  platformLeadId: "L-1",
  formId: "F-1",
  fullName: "Ayşe Demir",
  email: "ayse@example.com",
  phone: "+905321234567",
  country: "TR",
  city: "İzmir",
  company: "Demir Spor",
  productInterest: "Panoramik kort",
  notes: "",
  campaign: { campaignId: "c1" },
  attribution: {},
  consents: [],
  isTest: false,
  extraAnswers: {},
  submittedAt: new Date("2026-03-01T09:59:00Z"),
  ...over,
});
