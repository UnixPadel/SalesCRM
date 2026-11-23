import type { Queryable } from "../../shared/db";
import type { PushLang, PushSubscription, PushSubscriptionStore } from "../application";

/** Web Push abonelikleri (migration 0023 `push_subscriptions`). */
interface Row extends Record<string, unknown> {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  lang: string;
  created_at: Date | string;
  updated_at: Date | string;
}

const date = (v: Date | string): Date => (v instanceof Date ? v : new Date(v));
const lang = (v: string): PushLang => (v === "en" || v === "ar" ? v : "tr");

const fromRow = (r: Row): PushSubscription => ({
  id: r.id,
  userId: r.user_id,
  endpoint: r.endpoint,
  p256dh: r.p256dh,
  auth: r.auth,
  lang: lang(r.lang),
  createdAt: date(r.created_at),
  updatedAt: date(r.updated_at),
});

const COLS = "id, user_id, endpoint, p256dh, auth, lang, created_at, updated_at";

export function pgPushSubscriptionStore(q: Queryable): PushSubscriptionStore {
  return {
    async upsert(s) {
      await q.query(
        `INSERT INTO push_subscriptions (${COLS}) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (endpoint) DO UPDATE
           SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth,
               lang = EXCLUDED.lang, updated_at = EXCLUDED.updated_at`,
        [s.id, s.userId, s.endpoint, s.p256dh, s.auth, s.lang, s.createdAt, s.updatedAt],
      );
    },
    async listForUser(userId) {
      return (
        await q.query<Row>(`SELECT ${COLS} FROM push_subscriptions WHERE user_id = $1 ORDER BY created_at`, [userId])
      ).map(fromRow);
    },
    async removeByEndpoint(endpoint, userId) {
      if (userId === undefined) await q.query("DELETE FROM push_subscriptions WHERE endpoint = $1", [endpoint]);
      else await q.query("DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2", [endpoint, userId]);
    },
  };
}
