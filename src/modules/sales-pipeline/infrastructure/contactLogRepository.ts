import { queryOne, type Queryable } from "../../shared/db";
import type { ContactLog, ContactLogRepository } from "../domain";
import { contactLogFromRow, type ContactLogRow } from "./rows";

/** Temas kayıtları (Faz 7g, migration 0012 `contact_logs`). Kişisel veri yok: yalnız kimlikler ve kodlar. */
const COLS =
  "id, lead_id, actor_user_id, created_at, completed_activity_id, prev_type, prev_subject, " +
  "status_changed, status_before, status_after, stage_change_id, assigned_on_log";
const PLACEHOLDERS = COLS.split(",")
  .map((_, i) => `$${i + 1}`)
  .join(",");

export function pgContactLogRepository(q: Queryable): ContactLogRepository {
  return {
    async insert(l: ContactLog) {
      await q.query(`INSERT INTO contact_logs (${COLS}) VALUES (${PLACEHOLDERS})`, [
        l.id,
        l.leadId,
        l.actorUserId,
        l.createdAt,
        l.completedActivityId,
        l.prevType,
        l.prevSubject,
        l.statusChanged,
        l.statusBefore,
        l.statusAfter,
        l.stageChangeId,
        l.assignedOnLog,
      ]);
    },
    async findById(id) {
      const r = await queryOne<ContactLogRow>(q, `SELECT ${COLS} FROM contact_logs WHERE id = $1`, [id]);
      return r && contactLogFromRow(r);
    },
    async listByLead(leadId) {
      return (
        await q.query<ContactLogRow>(
          `SELECT ${COLS} FROM contact_logs WHERE lead_id = $1 ORDER BY created_at DESC, id DESC`,
          [leadId],
        )
      ).map(contactLogFromRow);
    },
    async remove(id) {
      await q.query("DELETE FROM contact_logs WHERE id = $1", [id]);
    },
  };
}
