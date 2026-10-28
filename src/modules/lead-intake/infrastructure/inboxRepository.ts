/**
 * inbound_webhook_events Postgres uygulaması. Payload diske şifreli yazılır (PayloadCipher);
 * okurken çözülür. Sıra alma `FOR UPDATE SKIP LOCKED` ile: birden fazla instance aynı satırı almaz.
 */
import type { Queryable } from "../../shared/db";
import type { PayloadCipher } from "../../shared/kernel";
import type { InboxEvent, InboxKind, InboxStatus, NewInboxEvent } from "../application";
import type { InboxRepository } from "../application";

interface Row extends Record<string, unknown> {
  id: string;
  provider: string;
  kind: string;
  dedupe_key: string;
  payload_ciphertext: string | null;
  received_at: Date | string;
  status: string;
  attempts: number | string;
  next_attempt_at: Date | string;
  last_error_code: string | null;
  last_error: string | null;
  lead_id: string | null;
  processed_at: Date | string | null;
}

const COLS =
  "id, provider, kind, dedupe_key, payload_ciphertext, received_at, status, attempts, next_attempt_at, last_error_code, last_error, lead_id, processed_at";

const date = (v: Date | string): Date => (v instanceof Date ? v : new Date(v));

export function pgInboxRepository(q: Queryable, cipher: PayloadCipher): InboxRepository {
  const fromRow = (r: Row): InboxEvent => ({
    id: r.id,
    provider: r.provider,
    kind: r.kind as InboxKind,
    dedupeKey: r.dedupe_key,
    payload: r.payload_ciphertext === null ? null : (JSON.parse(cipher.decrypt(r.payload_ciphertext)) as unknown),
    receivedAt: date(r.received_at),
    status: r.status as InboxStatus,
    attempts: Number(r.attempts),
    nextAttemptAt: date(r.next_attempt_at),
    lastErrorCode: r.last_error_code,
    lastError: r.last_error,
    leadId: r.lead_id,
    processedAt: r.processed_at === null ? null : date(r.processed_at),
  });

  return {
    async enqueue(e: NewInboxEvent) {
      const rows = await q.query<{ id: string }>(
        `INSERT INTO inbound_webhook_events (id, provider, kind, dedupe_key, payload_ciphertext, received_at, status, attempts, next_attempt_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'pending', 0, $7)
         ON CONFLICT (dedupe_key) DO NOTHING RETURNING id`,
        [
          e.id,
          e.provider,
          e.kind,
          e.dedupeKey,
          cipher.encrypt(JSON.stringify(e.payload)),
          e.receivedAt,
          e.nextAttemptAt,
        ],
      );
      return rows.length ? "inserted" : "duplicate";
    },

    async claimDue(now, limit, lockMs) {
      const rows = await q.query<Row>(
        `WITH due AS (
           SELECT id FROM inbound_webhook_events
            WHERE status IN ('pending', 'processing') AND next_attempt_at <= $1
            ORDER BY next_attempt_at, received_at
            LIMIT $2
            FOR UPDATE SKIP LOCKED)
         UPDATE inbound_webhook_events e
            SET status = 'processing', attempts = e.attempts + 1, next_attempt_at = $3
           FROM due WHERE e.id = due.id
         RETURNING ${COLS.split(", ")
           .map((c) => `e.${c}`)
           .join(", ")}`,
        [now, limit, new Date(now.getTime() + lockMs)],
      );
      return rows.map(fromRow);
    },

    async markDone(id, leadId, now) {
      await q.query(
        "UPDATE inbound_webhook_events SET status = 'done', lead_id = $2, processed_at = $3, last_error_code = NULL, last_error = NULL WHERE id = $1",
        [id, leadId, now],
      );
    },

    async markRetry(id, nextAttemptAt, error) {
      await q.query(
        "UPDATE inbound_webhook_events SET status = 'pending', next_attempt_at = $2, last_error_code = $3, last_error = $4 WHERE id = $1",
        [id, nextAttemptAt, error.code, error.message.slice(0, 2000)],
      );
    },

    async markFailed(id, error, now) {
      await q.query(
        "UPDATE inbound_webhook_events SET status = 'failed', processed_at = $2, last_error_code = $3, last_error = $4 WHERE id = $1",
        [id, now, error.code, error.message.slice(0, 2000)],
      );
    },

    async purgePayloads(olderThan, now) {
      const rows = await q.query<{ id: string }>(
        "UPDATE inbound_webhook_events SET payload_ciphertext = NULL, payload_purged_at = $2 WHERE received_at < $1 AND payload_ciphertext IS NOT NULL RETURNING id",
        [olderThan, now],
      );
      return rows.length;
    },

    async findByDedupeKey(key) {
      const rows = await q.query<Row>(`SELECT ${COLS} FROM inbound_webhook_events WHERE dedupe_key = $1`, [key]);
      return rows[0] && fromRow(rows[0]);
    },
  };
}
