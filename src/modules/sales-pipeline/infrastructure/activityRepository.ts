import { queryOne, type Queryable } from "../../shared/db";
import type { Activity, ActivityOutcome, ActivityRepository, ActivityType, ContactAggregateRow } from "../domain";
import { activityFromRow, type ActivityRow } from "./rows";

interface AggregateRow extends Record<string, unknown> {
  lead_id: string;
  type: string;
  outcome: string | null;
  customer_replied: boolean;
  date_estimated: boolean;
  n: number | string;
  first_at: Date | string;
  last_at: Date | string;
}

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
      // Yeniden açarken (doneAt = null) temas alanları da temizlenir (Faz 7g, iş emri §4.1).
      if (doneAt === null) {
        await q.query(
          "UPDATE activities SET done_at = NULL, outcome = NULL, customer_replied = false, result_note = '', " +
            "done_by_user_id = NULL, date_estimated = false, updated_at = $2 WHERE id = $1",
          [id, updatedAt],
        );
        return;
      }
      await q.query("UPDATE activities SET done_at = $2, updated_at = $3 WHERE id = $1", [id, doneAt, updatedAt]);
    },
    async complete(id, c, updatedAt) {
      await q.query(
        "UPDATE activities SET done_at = $2, type = $3, outcome = $4, customer_replied = $5, result_note = $6, " +
          "done_by_user_id = $7, log_id = $8, date_estimated = $9, updated_at = $10 WHERE id = $1",
        [
          id,
          c.doneAt,
          c.type,
          c.outcome,
          c.customerReplied,
          c.resultNote,
          c.doneByUserId,
          c.logId,
          c.dateEstimated,
          updatedAt,
        ],
      );
    },
    async reopen(id, back, updatedAt) {
      await q.query(
        "UPDATE activities SET done_at = NULL, outcome = NULL, customer_replied = false, result_note = '', " +
          "done_by_user_id = NULL, date_estimated = false, log_id = NULL, type = $2, subject = $3, updated_at = $4 " +
          "WHERE id = $1",
        [id, back.type, back.subject, updatedAt],
      );
    },
    async removeCreatedByLog(logId, exceptId) {
      const rows = await q.query<{ id: string }>(
        "DELETE FROM activities WHERE log_id = $1 AND ($2::uuid IS NULL OR id <> $2::uuid) RETURNING id",
        [logId, exceptId],
      );
      return rows.length;
    },
    async removeOpenNextOfLog(logId) {
      const rows = await q.query<{ id: string }>(
        "DELETE FROM activities WHERE next_of_log_id = $1 AND done_at IS NULL RETURNING id",
        [logId],
      );
      return rows.length;
    },
    async contactAggregatesByLeads(leadIds) {
      if (!leadIds.length) return [];
      const rows = await q.query<AggregateRow>(
        "SELECT lead_id, type, outcome, customer_replied, date_estimated, count(*)::int AS n, " +
          "min(done_at) AS first_at, max(done_at) AS last_at FROM activities " +
          "WHERE done_at IS NOT NULL AND lead_id = ANY($1::uuid[]) GROUP BY 1, 2, 3, 4, 5",
        [[...leadIds]],
      );
      return rows.map((r): ContactAggregateRow => ({
        leadId: r.lead_id,
        type: r.type as ActivityType,
        outcome: r.outcome as ActivityOutcome | null,
        customerReplied: r.customer_replied,
        estimated: r.date_estimated,
        n: Number(r.n),
        firstAt: new Date(r.first_at),
        lastAt: new Date(r.last_at),
      }));
    },
    async listDone(f) {
      if (!f.leadIds.length) return [];
      const where = ["done_at IS NOT NULL", "lead_id = ANY($1::uuid[])"];
      const params: unknown[] = [[...f.leadIds]];
      const p = (v: unknown) => {
        params.push(v);
        return `$${params.length}`;
      };
      if (f.from) where.push(`done_at >= ${p(f.from)}`);
      if (f.to) where.push(`done_at < ${p(f.to)}`);
      if (f.type) where.push(`type = ${p(f.type)}`);
      if (f.outcome) where.push(`outcome = ${p(f.outcome)}`);
      if (f.doneBy) where.push(`coalesce(done_by_user_id, created_by_user_id) = ${p(f.doneBy)}`);
      if (f.note) where.push(`lower(result_note || ' ' || notes) LIKE ${p(`%${f.note.toLocaleLowerCase("tr-TR")}%`)}`);
      if (f.before) where.push(`(done_at, id) < (${p(f.before.at)}::timestamptz, ${p(f.before.id)}::uuid)`);
      const sql =
        `SELECT ${COLS} FROM activities WHERE ${where.join(" AND ")} ` +
        `ORDER BY done_at DESC, id DESC LIMIT ${p(f.limit)}`;
      return (await q.query<ActivityRow>(sql, params)).map(activityFromRow);
    },
    async remove(id) {
      await q.query("DELETE FROM activities WHERE id = $1", [id]);
    },
    async removeAutoCreatedByChange(changeId) {
      const rows = await q.query<{ id: string }>(
        // Faz 7g: temasla tamamlanmış takip korunur; yalnız açık olan gider.
        "DELETE FROM activities WHERE auto_created AND created_by_change_id = $1 AND done_at IS NULL RETURNING id",
        [changeId],
      );
      return rows.length;
    },
  };
}
