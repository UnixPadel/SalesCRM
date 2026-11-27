import type { Db } from "../../shared/db";
import type { MailActivityStore, MailboxWeekRow, RecipientWeekRow, ScanState, StoredMessage } from "../domain";

const date = (v: unknown): Date | null =>
  v === null || v === undefined ? null : v instanceof Date ? v : new Date(String(v));

function toState(r: Record<string, unknown>): ScanState {
  return {
    mailbox: String(r["mailbox"]),
    folder: (r["folder"] as string | null) ?? null,
    uidValidity: (r["uidvalidity"] as string | null) ?? null,
    lastUid: Number(r["last_uid"] ?? 0),
    lastOkAt: date(r["last_ok_at"]),
    lastError: (r["last_error"] as string | null) ?? null,
    lastErrorAt: date(r["last_error_at"]),
  };
}

/** Postgres deposu (migration 0026). Konu ve gövde yok: yalnız tarih, anahtar ve alıcılar. */
export function pgMailActivityStore(db: Db): MailActivityStore {
  return {
    async state(mailbox) {
      const rows = await db.query("SELECT * FROM mailbox_scan_state WHERE mailbox = $1", [mailbox]);
      return rows[0] ? toState(rows[0]) : null;
    },

    async states() {
      return (await db.query("SELECT * FROM mailbox_scan_state ORDER BY mailbox")).map(toState);
    },

    async addMessages(mailbox, messages: readonly StoredMessage[]) {
      if (!messages.length) return 0;
      return db.transaction(async (tx) => {
        let added = 0;
        for (const m of messages) {
          const [row] = await tx.query<{ id: string | number }>(
            `INSERT INTO mailbox_sent_messages (mailbox, message_key, sent_at, uid, recipient_count)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (mailbox, message_key) DO NOTHING
             RETURNING id`,
            [mailbox, m.key, m.sentAt.toISOString(), m.uid, m.recipients.length],
          );
          if (!row) continue;
          added++;
          if (!m.recipients.length) continue;
          await tx.query(
            `INSERT INTO mailbox_sent_recipients (message_id, address_normalized, kind)
             SELECT $1, t.a, t.k FROM unnest($2::text[], $3::text[]) AS t(a, k)
             ON CONFLICT DO NOTHING`,
            [row.id, m.recipients.map((r) => r.address), m.recipients.map((r) => r.kind)],
          );
        }
        return added;
      });
    },

    async markOk(mailbox, cursor, at) {
      await db.query(
        `INSERT INTO mailbox_scan_state (mailbox, folder, uidvalidity, last_uid, last_ok_at, last_error, last_error_at)
         VALUES ($1, $2, $3, $4, $5, NULL, NULL)
         ON CONFLICT (mailbox) DO UPDATE SET
           folder = EXCLUDED.folder, uidvalidity = EXCLUDED.uidvalidity, last_uid = EXCLUDED.last_uid,
           last_ok_at = EXCLUDED.last_ok_at, last_error = NULL, last_error_at = NULL`,
        [mailbox, cursor.folder, cursor.uidValidity, cursor.lastUid, at.toISOString()],
      );
    },

    async markError(mailbox, error, at) {
      await db.query(
        `INSERT INTO mailbox_scan_state (mailbox, last_error, last_error_at) VALUES ($1, $2, $3)
         ON CONFLICT (mailbox) DO UPDATE SET last_error = EXCLUDED.last_error, last_error_at = EXCLUDED.last_error_at`,
        [mailbox, error.slice(0, 500), at.toISOString()],
      );
    },

    async mailboxWeek(mailboxes, start, end): Promise<MailboxWeekRow[]> {
      const rows = await db.query(
        `SELECT m.mailbox,
                count(*) FILTER (WHERE m.sent_at >= $2 AND m.sent_at < $3)::int AS sent,
                max(m.sent_at) FILTER (WHERE m.sent_at >= $2 AND m.sent_at < $3) AS last_in_week,
                max(m.sent_at) AS last_ever,
                (SELECT count(DISTINCT r.address_normalized)::int
                   FROM mailbox_sent_recipients r
                   JOIN mailbox_sent_messages x ON x.id = r.message_id
                  WHERE x.mailbox = m.mailbox AND x.sent_at >= $2 AND x.sent_at < $3) AS uniq
           FROM mailbox_sent_messages m
          WHERE m.mailbox = ANY($1::text[])
          GROUP BY m.mailbox`,
        [[...mailboxes], start.toISOString(), end.toISOString()],
      );
      return rows.map((r) => ({
        mailbox: String(r["mailbox"]),
        sent: Number(r["sent"] ?? 0),
        lastSentInWeek: date(r["last_in_week"]),
        lastSentEver: date(r["last_ever"]),
        uniqueRecipients: Number(r["uniq"] ?? 0),
      }));
    },

    async recipientsWeek(mailboxes, start, end): Promise<RecipientWeekRow[]> {
      const rows = await db.query(
        `SELECT m.mailbox, r.address_normalized AS address, count(*)::int AS messages, max(m.sent_at) AS last_sent_at
           FROM mailbox_sent_recipients r
           JOIN mailbox_sent_messages m ON m.id = r.message_id
          WHERE m.mailbox = ANY($1::text[]) AND m.sent_at >= $2 AND m.sent_at < $3
          GROUP BY m.mailbox, r.address_normalized`,
        [[...mailboxes], start.toISOString(), end.toISOString()],
      );
      return rows.map((r) => ({
        mailbox: String(r["mailbox"]),
        address: String(r["address"]),
        messages: Number(r["messages"] ?? 0),
        lastSentAt: date(r["last_sent_at"]) as Date,
      }));
    },
  };
}
