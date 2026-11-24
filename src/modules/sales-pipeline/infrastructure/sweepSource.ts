import type { Queryable } from "../../shared/db";
import type { DueActivityRow, IdleHotLeadRow, SweepSource } from "../application";

/** Zamanlı bildirimlerin sorguları (application/notificationSweeps.ts). Yalnız okur. */
const date = (v: Date | string): Date => (v instanceof Date ? v : new Date(v));

/** Açık aşama, sorumlusu var, test değil, silinmemiş. */
const LIVE_LEAD =
  "l.current_stage NOT IN ('WON','LOST') AND l.assigned_user_id IS NOT NULL AND NOT l.is_test AND l.deleted_at IS NULL";

interface LeadCols extends Record<string, unknown> {
  lead_id: string;
  assigned_user_id: string;
  full_name: string;
  company: string;
  country: string | null;
}

export function pgSweepSource(q: Queryable): SweepSource {
  return {
    async dueActivities(after, until) {
      const rows = await q.query<
        LeadCols & { id: string; type: string; subject: string; due_at: Date | string; auto_created: boolean }
      >(
        `SELECT a.id, a.type, a.subject, a.due_at, a.auto_created,
                l.id AS lead_id, l.assigned_user_id, l.full_name, l.company, l.country
           FROM activities a JOIN leads l ON l.id = a.lead_id
          WHERE a.done_at IS NULL AND a.due_at > $1 AND a.due_at <= $2 AND ${LIVE_LEAD}
          ORDER BY a.due_at, a.id`,
        [after, until],
      );
      return rows.map((r): DueActivityRow => ({
        activityId: r.id,
        activityType: r.type,
        subject: r.subject,
        dueAt: date(r.due_at),
        autoCreated: r.auto_created,
        leadId: r.lead_id,
        userId: r.assigned_user_id,
        leadName: r.full_name,
        company: r.company,
        country: r.country,
      }));
    },

    async idleHotLeads(after, until, now) {
      // Son dokunma: temas kaydı, tamamlanan iş, elle aşama değişikliği; hiçbiri yoksa lead'in açılışı.
      // `greatest` NULL'ları yok sayar. İleri tarihli açık işi olan lead planlıdır, bekliyor sayılmaz.
      const rows = await q.query<LeadCols & { last_touch: Date | string }>(
        `SELECT l.id AS lead_id, l.assigned_user_id, l.full_name, l.company, l.country, t.last_touch
           FROM leads l
          CROSS JOIN LATERAL (
            SELECT greatest(
              l.created_at,
              (SELECT max(c.created_at) FROM contact_logs c WHERE c.lead_id = l.id),
              (SELECT max(a.done_at) FROM activities a WHERE a.lead_id = l.id AND a.done_at IS NOT NULL),
              (SELECT max(e.occurred_at) FROM lead_stage_events e
                WHERE e.lead_id = l.id AND e.origin = 'manual' AND e.undone_at IS NULL)
            ) AS last_touch
          ) t
          WHERE l.install_timeline = 'm0_3' AND ${LIVE_LEAD}
            AND t.last_touch > $1 AND t.last_touch <= $2
            AND NOT EXISTS (
              SELECT 1 FROM activities p WHERE p.lead_id = l.id AND p.done_at IS NULL AND p.due_at > $3
            )
          ORDER BY t.last_touch, l.id`,
        [after, until, now],
      );
      return rows.map((r): IdleHotLeadRow => ({
        leadId: r.lead_id,
        userId: r.assigned_user_id,
        leadName: r.full_name,
        company: r.company,
        country: r.country,
        lastTouchAt: date(r.last_touch),
      }));
    },
  };
}
