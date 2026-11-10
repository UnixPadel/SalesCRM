import { queryOne, type Queryable } from "../../shared/db";
import type { Activity, ActivityRepository } from "../domain";
import { activityFromRow, type ActivityRow } from "./rows";

const COLS =
  "id, lead_id, type, subject, due_at, done_at, notes, auto_created, created_by_change_id, created_by_user_id, legacy_id, " +
  // Faz 7g (migration 0012): temas sonucu, cevap işareti, görüşme notu, kaydeden, tahmini tarih, kayıt bağları.
  "outcome, customer_replied, result_note, done_by_user_id, date_estimated, log_id, next_of_log_id, " +
  "created_at, updated_at";
const PLACEHOLDERS = COLS.split(",")
  .map((_, i) => `$${i + 1}`)
  .join(",");

export function pgActivityRepository(q: Queryable): ActivityRepository {
  return {
    async findById(id) {
      const r = await queryOne<ActivityRow>(q, `SELECT ${COLS} FROM activities WHERE id = $1`, [id]);
      return r && activityFromRow(r);
    },
    async listByLead(leadId) {
      return (
        await q.query<ActivityRow>(`SELECT ${COLS} FROM activities WHERE lead_id = $1 ORDER BY due_at, created_at`, [
          leadId,
        ])
      ).map(activityFromRow);
    },
    async listOpenByLeads(leadIds) {
      if (!leadIds.length) return [];
      return (
        await q.query<ActivityRow>(
          `SELECT ${COLS} FROM activities WHERE done_at IS NULL AND lead_id = ANY($1::uuid[]) ORDER BY due_at, created_at`,
          [[...leadIds]],
        )
      ).map(activityFromRow);
    },
    async insert(a: Activity) {
      await q.query(`INSERT INTO activities (${COLS}) VALUES (${PLACEHOLDERS})`, [
        a.id,
        a.leadId,
        a.type,
        a.subject,
        a.dueAt,
        a.doneAt,
        a.notes,
        a.autoCreated,
        a.createdByChangeId,
        a.createdByUserId,
        a.legacyId,
        a.outcome,
        a.customerReplied,
        a.resultNote,
        a.doneByUserId,
        a.dateEstimated,
        a.logId,
        a.nextOfLogId,
        a.createdAt,
        a.updatedAt,
      ]);
    },
    async findByLegacyId(legacyId) {
      const r = await queryOne<ActivityRow>(q, `SELECT ${COLS} FROM activities WHERE legacy_id = $1`, [legacyId]);
      return r && activityFromRow(r);
    },
    async setDone(id, doneAt, updatedAt) {
      await q.query("UPDATE activities SET done_at = $2, updated_at = $3 WHERE id = $1", [id, doneAt, updatedAt]);
    },
    async remove(id) {
      await q.query("DELETE FROM activities WHERE id = $1", [id]);
    },
    async removeAutoCreatedByChange(changeId) {
      const rows = await q.query<{ id: string }>(
        "DELETE FROM activities WHERE auto_created AND created_by_change_id = $1 RETURNING id",
        [changeId],
      );
      return rows.length;
    },
  };
}
