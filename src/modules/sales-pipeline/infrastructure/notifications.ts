import type { Queryable } from "../../shared/db";
import type { Notification, NotificationStore, NotificationType } from "../application";

interface Row extends Record<string, unknown> {
  id: string;
  user_id: string;
  type: string;
  lead_id: string | null;
  title: string;
  body: string;
  created_at: Date | string;
  read_at: Date | string | null;
}

const date = (v: Date | string): Date => (v instanceof Date ? v : new Date(v));
const fromRow = (r: Row): Notification => ({
  id: r.id,
  userId: r.user_id,
  type: r.type as NotificationType,
  leadId: r.lead_id,
  title: r.title,
  body: r.body,
  createdAt: date(r.created_at),
  readAt: r.read_at === null ? null : date(r.read_at),
});

const COLS = "id, user_id, type, lead_id, title, body, created_at, read_at";

export function pgNotificationStore(q: Queryable): NotificationStore {
  return {
    async insert(n) {
      await q.query(`INSERT INTO user_notifications (${COLS}) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [
        n.id,
        n.userId,
        n.type,
        n.leadId,
        n.title,
        n.body,
        n.createdAt,
        n.readAt,
      ]);
    },
    async listForUser(userId, limit) {
      return (
        await q.query<Row>(
          `SELECT ${COLS} FROM user_notifications WHERE user_id = $1 ORDER BY created_at DESC, id LIMIT $2`,
          [userId, limit],
        )
      ).map(fromRow);
    },
    async unreadCount(userId) {
      const r = await q.query<{ n: number | string }>(
        "SELECT count(*)::int AS n FROM user_notifications WHERE user_id = $1 AND read_at IS NULL",
        [userId],
      );
      return Number(r[0]?.n ?? 0);
    },
    async markRead(id, userId, now) {
      const r = await q.query<{ id: string }>(
        "UPDATE user_notifications SET read_at = coalesce(read_at, $3) WHERE id = $1 AND user_id = $2 RETURNING id",
        [id, userId, now],
      );
      return r.length > 0;
    },
    async markAllRead(userId, now) {
      const r = await q.query<{ id: string }>(
        "UPDATE user_notifications SET read_at = $2 WHERE user_id = $1 AND read_at IS NULL RETURNING id",
        [userId, now],
      );
      return r.length;
    },
  };
}
