/**
 * outbound_conversion_events Postgres uygulaması (dağıtıcıya ait). Sıra alma `FOR UPDATE SKIP LOCKED` ile:
 * birden fazla instance aynı satırı almaz; alınan satırın next_attempt_at'ı kilit süresi kadar ileri atılır.
 * Satırları sales-pipeline yazar (OutboxWriter, aynı transaction); burada yalnız durum geçişleri.
 */
import type { Queryable } from "../../shared/db";
import type { DeadRow, OutboundRow, OutboundStatus, OutboxRepository, SkipReason } from "../application";

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
}

const COLS =
  "id, stage_event_id, provider, status, skip_reason, attempts, next_attempt_at, last_response_code, last_error, sent_at, created_at, finished_at";

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

export function pgOutboxRepository(q: Queryable): OutboxRepository {
  return {
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

    async markSent(ids, responseCode, now) {
      if (!ids.length) return;
      await q.query(
        `UPDATE outbound_conversion_events
            SET status = 'sent', last_response_code = $2, last_error = NULL, sent_at = $3, finished_at = $3
          WHERE id = ANY($1::uuid[])`,
        [[...ids], responseCode, now],
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
