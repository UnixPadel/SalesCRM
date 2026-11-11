/**
 * outbound_conversion_events Postgres uygulaması (dağıtıcıya ait). Sıra alma `FOR UPDATE SKIP LOCKED` ile:
 * birden fazla instance aynı satırı almaz; alınan satırın next_attempt_at'ı kilit süresi kadar ileri atılır.
 * Satırları sales-pipeline yazar (OutboxWriter, aynı transaction); burada yalnız durum geçişleri.
 */
import type { Queryable } from "../../shared/db";
import type {
  DeadRow,
  OutboundDetail,
  OutboundRow,
  OutboundStatus,
  OutboxRepository,
  OutboxStats,
  SkipReason,
} from "../application";

interface Row extends Record<string, unknown> {
  id: string;
  stage_event_id: string;
  provider: string;
  status: string;
  skip_reason: string | null;
  attempts: number | string;
  next_attempt_at: Date | string;
  last_response_code: number | string | null;
  last_error: string | null;
  sent_at: Date | string | null;
  created_at: Date | string;
  finished_at: Date | string | null;
  request_id?: string | null;
}

const COLS =
  "id, stage_event_id, provider, status, skip_reason, attempts, next_attempt_at, last_response_code, last_error, sent_at, created_at, finished_at";
const DETAIL_COLS = `${COLS}, request_id`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const date = (v: Date | string): Date => (v instanceof Date ? v : new Date(v));
const dateOrNull = (v: Date | string | null): Date | null => (v === null ? null : date(v));

const fromRow = (r: Row): OutboundRow => ({
  id: r.id,
  stageEventId: r.stage_event_id,
  provider: r.provider,
  status: r.status as OutboundStatus,
  attempts: Number(r.attempts),
  nextAttemptAt: date(r.next_attempt_at),
  skipReason: r.skip_reason,
  lastResponseCode: r.last_response_code === null ? null : Number(r.last_response_code),
  lastError: r.last_error,
  sentAt: dateOrNull(r.sent_at),
  createdAt: date(r.created_at),
});

const detailFromRow = (r: Row): OutboundDetail => ({
  ...fromRow(r),
  finishedAt: dateOrNull(r.finished_at),
  requestId: r.request_id ?? null,
});

export function pgOutboxRepository(q: Queryable): OutboxRepository {
  return {
    async stats(): Promise<OutboxStats> {
      const counts = await q.query<{ provider: string; status: string; n: number | string }>(
        "SELECT provider, status, count(*)::int AS n FROM outbound_conversion_events GROUP BY provider, status ORDER BY provider, status",
      );
      const reasons = await q.query<{ provider: string; skip_reason: string; n: number | string }>(
        `SELECT provider, skip_reason, count(*)::int AS n FROM outbound_conversion_events
          WHERE status = 'skipped' AND skip_reason IS NOT NULL GROUP BY provider, skip_reason ORDER BY provider, n DESC`,
      );
      const edge = await q.query<{ oldest: Date | string | null; last_sent: Date | string | null }>(
        `SELECT (SELECT min(next_attempt_at) FROM outbound_conversion_events WHERE status IN ('pending', 'failed')) AS oldest,
                (SELECT max(sent_at) FROM outbound_conversion_events WHERE status = 'sent') AS last_sent`,
      );
      return {
        counts: counts.map((c) => ({ provider: c.provider, status: c.status as OutboundStatus, count: Number(c.n) })),
        skipReasons: reasons.map((r) => ({ provider: r.provider, reason: r.skip_reason, count: Number(r.n) })),
        oldestDueAt: dateOrNull(edge[0]?.oldest ?? null),
        lastSentAt: dateOrNull(edge[0]?.last_sent ?? null),
      };
    },

    async list(filter) {
      if (!filter.statuses.length) return [];
      const rows = await q.query<Row>(
        `SELECT ${DETAIL_COLS} FROM outbound_conversion_events
          WHERE status = ANY($1::text[]) AND ($2::text IS NULL OR provider = $2)
          ORDER BY coalesce(finished_at, created_at) DESC, id
          LIMIT $3`,
        [[...filter.statuses], filter.provider ?? null, Math.max(1, Math.min(500, filter.limit))],
      );
      return rows.map(detailFromRow);
    },

    async findByIds(ids) {
      const valid = ids.filter((id) => UUID.test(id));
      if (!valid.length) return [];
      const rows = await q.query<Row>(
        `SELECT ${DETAIL_COLS} FROM outbound_conversion_events WHERE id = ANY($1::uuid[])`,
        [valid],
      );
      return rows.map(detailFromRow);
    },

    async requeue(ids, now) {
      const valid = ids.filter((id) => UUID.test(id));
      if (!valid.length) return 0;
      const rows = await q.query<{ id: string }>(
        `UPDATE outbound_conversion_events
            SET attempts = CASE WHEN status = 'dead' THEN 0 ELSE attempts END,
                status = CASE WHEN status = 'dead' THEN 'pending' ELSE status END,
                next_attempt_at = $2,
                finished_at = NULL
          WHERE id = ANY($1::uuid[]) AND status IN ('dead', 'failed')
          RETURNING id`,
        [valid, now],
      );
      return rows.length;
    },

    async claimDue(now, limit, lockMs) {
      const rows = await q.query<Row>(
        `WITH due AS (
           SELECT id FROM outbound_conversion_events
            WHERE status IN ('pending', 'failed') AND next_attempt_at <= $1
            ORDER BY next_attempt_at, created_at
            LIMIT $2
            FOR UPDATE SKIP LOCKED)
         UPDATE outbound_conversion_events e
            SET attempts = e.attempts + 1, next_attempt_at = $3
           FROM due WHERE e.id = due.id
         RETURNING ${COLS.split(", ")
           .map((c) => `e.${c}`)
           .join(", ")}`,
        [now, limit, new Date(now.getTime() + lockMs)],
      );
      return rows.map(fromRow);
    },

    async markSent(ids, responseCode, now, requestId = null) {
      if (!ids.length) return;
      await q.query(
        `UPDATE outbound_conversion_events
            SET status = 'sent', last_response_code = $2, last_error = NULL, sent_at = $3, finished_at = $3,
                request_id = $4
          WHERE id = ANY($1::uuid[])`,
        [[...ids], responseCode, now, requestId],
      );
    },

    async markRetry(id, nextAttemptAt, responseCode, error) {
      await q.query(
        "UPDATE outbound_conversion_events SET status = 'failed', next_attempt_at = $2, last_response_code = $3, last_error = $4 WHERE id = $1",
        [id, nextAttemptAt, responseCode, error.slice(0, 2000)],
      );
    },

    async markDead(id, responseCode, error, now) {
      await q.query(
        "UPDATE outbound_conversion_events SET status = 'dead', last_response_code = $2, last_error = $3, finished_at = $4 WHERE id = $1",
        [id, responseCode, error.slice(0, 2000), now],
      );
    },

    async markSkipped(id, reason: SkipReason, now) {
      await q.query(
        "UPDATE outbound_conversion_events SET status = 'skipped', skip_reason = $2, finished_at = $3 WHERE id = $1",
        [id, reason, now],
      );
    },

    async enqueueMissing(stageEventIds, provider, notBefore) {
      if (!stageEventIds.length) return 0;
      const rows = await q.query<{ id: string }>(
        `INSERT INTO outbound_conversion_events (id, stage_event_id, provider, status, next_attempt_at)
         SELECT gen_random_uuid(), e.id, $2, 'pending', $3 FROM unnest($1::uuid[]) AS e(id)
         ON CONFLICT (stage_event_id, provider) DO NOTHING
         RETURNING id`,
        [[...stageEventIds], provider, notBefore],
      );
      return rows.length;
    },

    async listDead(since) {
      const rows = await q.query<Row>(
        `SELECT ${COLS} FROM outbound_conversion_events WHERE status = 'dead' AND finished_at >= $1 ORDER BY finished_at`,
        [since],
      );
      return rows.map((r): DeadRow => ({
        id: r.id,
        stageEventId: r.stage_event_id,
        provider: r.provider,
        attempts: Number(r.attempts),
        lastResponseCode: r.last_response_code === null ? null : Number(r.last_response_code),
        lastError: r.last_error,
        finishedAt: dateOrNull(r.finished_at),
      }));
    },
  };
}
