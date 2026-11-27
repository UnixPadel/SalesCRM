import type { Queryable } from "../../shared/db";
import type { ActionLogEntry, ActionLogStore, ActionResult, ActionType, TargetType } from "../application";

/** İşlem günlüğü (migration 0021 `user_action_logs`; 0027 hedef + sonuç, yalnız ekleme). */
interface Row extends Record<string, unknown> {
  id: string;
  occurred_at: Date | string;
  actor_user_id: string;
  action: string;
  lead_id: string | null;
  lead_name: string;
  target_type: string;
  target_id: string | null;
  target_label: string;
  result: string;
  details: unknown;
}

const date = (v: Date | string): Date => (v instanceof Date ? v : new Date(v));

function detailsOf(v: unknown): Record<string, unknown> {
  let parsed = v;
  if (typeof v === "string") {
    try {
      parsed = JSON.parse(v) as unknown;
    } catch {
      return {};
    }
  }
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

const fromRow = (r: Row): ActionLogEntry => ({
  id: r.id,
  occurredAt: date(r.occurred_at),
  actorUserId: r.actor_user_id,
  action: r.action as ActionType,
  leadId: r.lead_id,
  leadName: r.lead_name,
  targetType: r.target_type as TargetType,
  targetId: r.target_id,
  targetLabel: r.target_label,
  result: r.result as ActionResult,
  details: detailsOf(r.details),
});

const COLS =
  "id, occurred_at, actor_user_id, action, lead_id, lead_name, target_type, target_id, target_label, result, details";
/** LIKE joker karakterleri aranan metinde düz karakterdir. */
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => "\\" + c);

export function pgActionLogStore(q: Queryable): ActionLogStore {
  return {
    async insert(e) {
      await q.query(`INSERT INTO user_action_logs (${COLS}) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)`, [
        e.id,
        e.occurredAt,
        e.actorUserId,
        e.action,
        e.leadId,
        e.leadName,
        e.targetType,
        e.targetId,
        e.targetLabel,
        e.result,
        JSON.stringify(e.details),
      ]);
    },
    async list(f) {
      const where: string[] = [];
      const params: unknown[] = [];
      const p = (v: unknown) => {
        params.push(v);
        return `$${params.length}`;
      };
      if (f.actorUserId) where.push(`actor_user_id = ${p(f.actorUserId)}`);
      if (f.actions?.length) where.push(`action IN (${f.actions.map((a) => p(a)).join(",")})`);
      if (f.targetType) where.push(`target_type = ${p(f.targetType)}`);
      if (f.targetId) where.push(`target_id = ${p(f.targetId)}`);
      if (f.search) where.push(`lower(target_label) LIKE ${p(`%${likeEscape(f.search.toLowerCase())}%`)}`);
      if (f.result) where.push(`result = ${p(f.result)}`);
      if (f.from) where.push(`occurred_at >= ${p(f.from)}`);
      if (f.to) where.push(`occurred_at < ${p(f.to)}`);
      if (f.before) where.push(`(occurred_at, id) < (${p(f.before.at)}, ${p(f.before.id)}::uuid)`);
      const sql =
        `SELECT ${COLS} FROM user_action_logs` +
        (where.length ? ` WHERE ${where.join(" AND ")}` : "") +
        ` ORDER BY occurred_at DESC, id DESC LIMIT ${p(f.limit)}`;
      return (await q.query<Row>(sql, params)).map(fromRow);
    },
    async actors() {
      return (
        await q.query<{ actor_user_id: string }>(
          "SELECT DISTINCT actor_user_id FROM user_action_logs ORDER BY actor_user_id",
        )
      ).map((r) => r.actor_user_id);
    },
  };
}
