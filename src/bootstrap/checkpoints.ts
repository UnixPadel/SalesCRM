/**
 * Geri yükleme noktası (2026-11-23). Toplu veri işlemi (Excel eşitleme) dokunacağı lead'lerin bütün satırlarını
 * işlemden önce ve sonra okur; fark `data_checkpoint_rows`'a yazılır. Yönetici geri dönünce yalnız o işlemin farkı geri
 * alınır: eklediği satırlar silinir, değiştirdiği ve sildiği satırlar işlem öncesi haline döner. İşlemin dokunmadığı
 * lead'ler etkilenmez. Satır kopyaları kişisel veri içerir; uçlar yalnız yöneticiye açıktır, rapora yalnız sayı yazılır.
 */
import { Router, type Request, type Response } from "express";
import type { Db, Queryable } from "../modules/shared/db";
import { uuidGenerator } from "../modules/shared/kernel";

type Row = Record<string, unknown>;
type Snapshot = Map<string, Map<string, Row>>;

interface TableSpec {
  name: string;
  key: string;
  /** `$1` = lead kimlikleri (uuid[]). */
  where: string;
}

/** Ebeveyn önce. Geri eklemede bu sıra, silmede ters sıra kullanılır. */
const TABLES: readonly TableSpec[] = [
  { name: "persons", key: "id", where: "id IN (SELECT person_id FROM leads WHERE id = ANY($1::uuid[]))" },
  { name: "leads", key: "id", where: "id = ANY($1::uuid[])" },
  { name: "lead_stage_events", key: "id", where: "lead_id = ANY($1::uuid[])" },
  { name: "contact_logs", key: "id", where: "lead_id = ANY($1::uuid[])" },
  { name: "activities", key: "id", where: "lead_id = ANY($1::uuid[])" },
  { name: "lead_attribution", key: "lead_id", where: "lead_id = ANY($1::uuid[])" },
  { name: "lead_consents", key: "id", where: "lead_id = ANY($1::uuid[])" },
  { name: "user_notifications", key: "id", where: "lead_id = ANY($1::uuid[])" },
  {
    name: "outbound_conversion_events",
    key: "id",
    where: "stage_event_id IN (SELECT id FROM lead_stage_events WHERE lead_id = ANY($1::uuid[]))",
  },
];
const SPEC = new Map(TABLES.map((t) => [t.name, t]));

/** Lead kümesinin bütün satırları (tablo → anahtar → satır). */
export async function captureLeads(q: Queryable, leadIds: readonly string[]): Promise<Snapshot> {
  const snap: Snapshot = new Map();
  for (const t of TABLES) {
    const rows = leadIds.length
      ? await q.query<{ r: Row }>(`SELECT to_jsonb(t) AS r FROM ${t.name} t WHERE ${t.where}`, [leadIds])
      : [];
    snap.set(t.name, new Map(rows.map(({ r }) => [String(r[t.key]), r])));
  }
  return snap;
}

export interface CheckpointOp {
  table: string;
  op: "insert" | "update" | "delete";
  key: string;
  before: Row | null;
  after: Row | null;
}

export function diffSnapshots(before: Snapshot, after: Snapshot): CheckpointOp[] {
  const ops: CheckpointOp[] = [];
  for (const t of TABLES) {
    const b = before.get(t.name) ?? new Map<string, Row>();
    const a = after.get(t.name) ?? new Map<string, Row>();
    for (const [key, row] of a) {
      const old = b.get(key);
      if (!old) ops.push({ table: t.name, op: "insert", key, before: null, after: row });
      else if (JSON.stringify(old) !== JSON.stringify(row))
        ops.push({ table: t.name, op: "update", key, before: old, after: row });
    }
    for (const [key, row] of b)
      if (!a.has(key)) ops.push({ table: t.name, op: "delete", key, before: row, after: null });
  }
  return ops;
}

export interface CheckpointSummary {
  /** tablo → { insert, update, delete } sayıları. */
  tables: Record<string, Partial<Record<CheckpointOp["op"], number>>>;
  leads: { created: number; changed: number };
  /** İşlemin kendi raporundan sayılar (ör. Excel eşitleme). */
  extra?: Record<string, unknown>;
}

export function summarize(ops: readonly CheckpointOp[]): CheckpointSummary {
  const tables: CheckpointSummary["tables"] = {};
  for (const o of ops) {
    const t = (tables[o.table] ??= {});
    t[o.op] = (t[o.op] ?? 0) + 1;
  }
  const touched = new Set(ops.filter((o) => o.table !== "persons").map((o) => leadIdOf(o)));
  const created = new Set(ops.filter((o) => o.table === "leads" && o.op === "insert").map((o) => o.key));
  return { tables, leads: { created: created.size, changed: [...touched].filter((id) => !created.has(id)).length } };
}

function leadIdOf(o: CheckpointOp): string {
  if (o.table === "leads") return o.key;
  const r = o.after ?? o.before ?? {};
  return String(r["lead_id"] ?? "");
}

export interface SaveCheckpointInput {
  label: string;
  source: string;
  createdBy: string;
  createdAt: Date;
  leadIds: readonly string[];
  ops: readonly CheckpointOp[];
  extra?: Record<string, unknown>;
}

export async function saveCheckpoint(db: Db, input: SaveCheckpointInput): Promise<{ id: string } & CheckpointSummary> {
  const id = uuidGenerator.next();
  const summary = { ...summarize(input.ops), ...(input.extra ? { extra: input.extra } : {}) };
  await db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO data_checkpoints (id, created_at, created_by, label, source, lead_ids, summary)
       VALUES ($1, $2, $3, $4, $5, $6::uuid[], $7::jsonb)`,
      [id, input.createdAt, input.createdBy, input.label, input.source, input.leadIds, JSON.stringify(summary)],
    );
    let seq = 0;
    for (const o of input.ops) {
      await tx.query(
        `INSERT INTO data_checkpoint_rows (checkpoint_id, seq, table_name, op, row_key, before, after)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)`,
        [
          id,
          seq++,
          o.table,
          o.op,
          o.key,
          o.before ? JSON.stringify(o.before) : null,
          o.after ? JSON.stringify(o.after) : null,
        ],
      );
    }
  });
  return { id, ...summary };
}

export interface CheckpointListItem {
  id: string;
  createdAt: string;
  createdBy: string;
  label: string;
  source: string;
  summary: CheckpointSummary;
  restoredAt: string | null;
  restoredBy: string | null;
}

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());

export async function listCheckpoints(q: Queryable): Promise<CheckpointListItem[]> {
  const rows = await q.query<{
    id: string;
    created_at: unknown;
    created_by: string;
    label: string;
    source: string;
    summary: CheckpointSummary;
    restored_at: unknown;
    restored_by: string | null;
  }>(
    `SELECT id, created_at, created_by, label, source, summary, restored_at, restored_by
       FROM data_checkpoints ORDER BY created_at DESC LIMIT 50`,
  );
  return rows.map((r) => ({
    id: r.id,
    createdAt: iso(r.created_at),
    createdBy: r.created_by,
    label: r.label,
    source: r.source,
    summary: r.summary,
    restoredAt: r.restored_at ? iso(r.restored_at) : null,
    restoredBy: r.restored_by,
  }));
}

type StoredOp = {
  seq: number;
  table_name: string;
  op: CheckpointOp["op"];
  row_key: string;
  before: Row | null;
  after: Row | null;
};

async function loadOps(q: Queryable, id: string): Promise<StoredOp[]> {
  return q.query<StoredOp>(
    `SELECT seq, table_name, op, row_key, before, after FROM data_checkpoint_rows WHERE checkpoint_id = $1 ORDER BY seq`,
    [id],
  );
}

async function currentRow(q: Queryable, table: string, key: string): Promise<Row | null> {
  const t = SPEC.get(table);
  if (!t) throw new Error(`Bilinmeyen tablo: ${table}`);
  const rows = await q.query<{ r: Row }>(`SELECT to_jsonb(t) AS r FROM ${t.name} t WHERE ${t.key}::text = $1`, [key]);
  return rows[0]?.r ?? null;
}

export interface RestorePreview {
  id: string;
  restoredAt: string | null;
  /** Geri alınacak satır sayıları (tablo → işlem). */
  tables: CheckpointSummary["tables"];
  leads: { toDelete: number; toRevert: number };
  /** Noktadan sonra başkasının değiştirdiği lead'ler: geri dönünce o değişiklikler de geri alınır. */
  changedSince: number;
  /** İşlemin açtığı lead'lere sonradan eklenmiş satırlar (geri dönünce lead'le birlikte silinir). */
  addedSince: number;
}

/** Noktadan sonra değişen satırlar: işlemin bıraktığı halden farklı olanlar ve sonradan eklenenler. */
async function driftOf(q: Queryable, ops: readonly StoredOp[], leadIds: readonly string[]) {
  const changedLeads = new Set<string>();
  for (const o of ops) {
    if (o.op === "delete") continue;
    const cur = await currentRow(q, o.table_name, o.row_key);
    if (JSON.stringify(cur) !== JSON.stringify(o.after)) {
      const r = o.after ?? {};
      changedLeads.add(o.table_name === "leads" ? o.row_key : String(r["lead_id"] ?? o.row_key));
    }
  }
  const known = new Set(ops.map((o) => `${o.table_name}:${o.row_key}`));
  const createdLeads = ops.filter((o) => o.table_name === "leads" && o.op === "insert").map((o) => o.row_key);
  let addedSince = 0;
  const now = await captureLeads(q, leadIds);
  for (const [table, rows] of now) {
    if (table === "persons" || table === "leads") continue;
    for (const [key, row] of rows) {
      if (known.has(`${table}:${key}`)) continue;
      // Önceden var olup işlemin dokunmadığı satırlar "before" kopyasında yoktur; yalnız yeni lead'lerdekiler sayılır.
      if (createdLeads.includes(String(row["lead_id"] ?? ""))) {
        addedSince++;
        changedLeads.add(String(row["lead_id"]));
      }
    }
  }
  const attachments = createdLeads.length
    ? await q.query<{ n: string | number }>(
        "SELECT count(*) AS n FROM lead_attachments WHERE lead_id = ANY($1::uuid[]) AND deleted_at IS NULL",
        [createdLeads],
      )
    : [{ n: 0 }];
  addedSince += Number(attachments[0]?.n ?? 0);
  return { changedSince: changedLeads.size, addedSince };
}

async function checkpointHead(q: Queryable, id: string) {
  const rows = await q.query<{ lead_ids: string[]; restored_at: unknown }>(
    "SELECT lead_ids, restored_at FROM data_checkpoints WHERE id = $1",
    [id],
  );
  return rows[0];
}

export async function previewRestore(q: Queryable, id: string): Promise<RestorePreview | null> {
  const head = await checkpointHead(q, id);
  if (!head) return null;
  const ops = await loadOps(q, id);
  const tables: CheckpointSummary["tables"] = {};
  for (const o of ops) {
    const t = (tables[o.table_name] ??= {});
    t[o.op] = (t[o.op] ?? 0) + 1;
  }
  const leadOps = ops.filter((o) => o.table_name === "leads");
  // Yeni açılan lead'ler silinir; "eski haline dönen" yalnız önceden var olan lead'lerdir.
  const createdLeads = new Set(leadOps.filter((o) => o.op === "insert").map((o) => o.row_key));
  const revertLeads = new Set(
    ops
      .filter((o) => o.table_name !== "persons" && o.table_name !== "outbound_conversion_events")
      .map((o) => (o.table_name === "leads" ? o.row_key : String((o.after ?? o.before ?? {})["lead_id"] ?? "")))
      .filter((id) => id && !createdLeads.has(id)),
  );
  const drift = await driftOf(q, ops, head.lead_ids);
  return {
    id,
    restoredAt: head.restored_at ? iso(head.restored_at) : null,
    tables,
    leads: {
      toDelete: createdLeads.size,
      toRevert: revertLeads.size,
    },
    ...drift,
  };
}

const columnsCache = new Map<string, string[]>();
async function columnsOf(q: Queryable, table: string): Promise<string[]> {
  const hit = columnsCache.get(table);
  if (hit) return hit;
  const rows = await q.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = $1 AND is_generated = 'NEVER'
      ORDER BY ordinal_position`,
    [table],
  );
  const cols = rows.map((r) => r.column_name);
  columnsCache.set(table, cols);
  return cols;
}

export class CheckpointError extends Error {
  constructor(
    readonly code: "checkpoint.not_found" | "checkpoint.already_restored",
    message: string,
  ) {
    super(message);
  }
}

export interface RestoreResult {
  deleted: number;
  reinserted: number;
  reverted: number;
  /** Başka kayda bağlı olduğu için silinmeyen kişi kayıtları. */
  keptPersons: number;
}

/** Aşama geçmişinin "yalnız ekleme" tetikleyicisi (migration 0001). */
const STAGE_GUARD = "lead_stage_events_append_only";

/**
 * İşlemin farkını tek transaction'da geri alır. İkinci kez çalıştırılamaz.
 *
 * Aşama geçmişi normalde yalnız eklenir (tetikleyici siler ve değiştirmeyi reddeder). Geri dönüş "işlem hiç olmamış"
 * demektir: işlemin eklediği aşama satırları silinir. Bunun için tetikleyici yalnız bu transaction içinde kapatılır ve
 * commit'ten önce yeniden açılır; DDL transaction'a dahil olduğundan başka hiçbir oturum onu kapalı görmez.
 */
export async function restoreCheckpoint(db: Db, id: string, by: string, at: Date): Promise<RestoreResult> {
  return db.transaction(async (tx) => {
    const locked = await tx.query<{ restored_at: unknown }>(
      "SELECT restored_at FROM data_checkpoints WHERE id = $1 FOR UPDATE",
      [id],
    );
    if (!locked[0]) throw new CheckpointError("checkpoint.not_found", "Geri yükleme noktası bulunamadı.");
    if (locked[0].restored_at)
      throw new CheckpointError("checkpoint.already_restored", "Bu noktaya zaten geri dönüldü.");
    const ops = await loadOps(tx, id);
    const touchesStages = ops.some(
      (o) => o.table_name === "lead_stage_events" || (o.table_name === "leads" && o.op === "insert"),
    );
    if (touchesStages) await tx.query(`ALTER TABLE lead_stage_events DISABLE TRIGGER ${STAGE_GUARD}`);
    const order = TABLES.map((t) => t.name);
    const byTable = (op: CheckpointOp["op"], reverse: boolean) => {
      const list = ops.filter((o) => o.op === op);
      return list.sort((a, b) => {
        const d = order.indexOf(a.table_name) - order.indexOf(b.table_name);
        return reverse ? -d : d;
      });
    };
    const result: RestoreResult = { deleted: 0, reinserted: 0, reverted: 0, keptPersons: 0 };

    // 1) İşlemin eklediği satırlar (çocuk önce). Kişi kaydı başka lead'e bağlıysa kalır.
    for (const o of byTable("insert", true)) {
      const t = SPEC.get(o.table_name)!;
      if (t.name === "persons") {
        const rows = await tx.query(
          `DELETE FROM persons p WHERE p.id::text = $1
             AND NOT EXISTS (SELECT 1 FROM leads l WHERE l.person_id = p.id)
             AND NOT EXISTS (SELECT 1 FROM persons m WHERE m.merged_into_id = p.id)
           RETURNING p.id`,
          [o.row_key],
        );
        if (rows.length) result.deleted++;
        else result.keptPersons++;
        continue;
      }
      const rows = await tx.query(`DELETE FROM ${t.name} WHERE ${t.key}::text = $1 RETURNING ${t.key}`, [o.row_key]);
      result.deleted += rows.length;
    }
    // 2) İşlemin sildiği satırlar (ebeveyn önce).
    for (const o of byTable("delete", false)) {
      const t = SPEC.get(o.table_name)!;
      const rows = await tx.query(
        `INSERT INTO ${t.name} SELECT * FROM jsonb_populate_record(NULL::${t.name}, $1::jsonb)
         ON CONFLICT DO NOTHING RETURNING ${t.key}`,
        [JSON.stringify(o.before)],
      );
      result.reinserted += rows.length;
    }
    // 3) İşlemin değiştirdiği satırlar işlem öncesi haline.
    for (const o of byTable("update", false)) {
      const t = SPEC.get(o.table_name)!;
      const cols = (await columnsOf(tx, t.name)).filter((c) => c !== t.key);
      const list = cols.map((c) => `"${c}"`).join(", ");
      const rows = await tx.query(
        `UPDATE ${t.name} SET (${list}) = (SELECT ${list} FROM jsonb_populate_record(NULL::${t.name}, $1::jsonb))
          WHERE ${t.key}::text = $2 RETURNING ${t.key}`,
        [JSON.stringify(o.before), o.row_key],
      );
      result.reverted += rows.length;
    }
    if (touchesStages) await tx.query(`ALTER TABLE lead_stage_events ENABLE TRIGGER ${STAGE_GUARD}`);
    await tx.query(
      "UPDATE data_checkpoints SET restored_at = $2, restored_by = $3, restore_summary = $4::jsonb WHERE id = $1",
      [id, at, by, JSON.stringify(result)],
    );
    return result;
  });
}

// ---- HTTP (yalnız yönetici; /api/admin/checkpoints).

export interface CheckpointRouterDeps {
  db: Db;
  roleOf(req: Request): string | undefined;
  actorIdOf(req: Request): string;
  now(): Date;
}

export function createCheckpointRouter(deps: CheckpointRouterDeps): Router {
  const r = Router();
  const adminOnly = (req: Request, res: Response): boolean => {
    if (deps.roleOf(req) === "admin") return true;
    res.status(403).json({ error: "Yalnız yönetici.", code: "admin_only" });
    return false;
  };
  r.get("/", async (req, res) => {
    if (!adminOnly(req, res)) return;
    res.json({ items: await listCheckpoints(deps.db) });
  });
  r.get("/:id", async (req, res) => {
    if (!adminOnly(req, res)) return;
    const p = await previewRestore(deps.db, String(req.params["id"]));
    if (!p) return res.status(404).json({ error: "Geri yükleme noktası bulunamadı.", code: "checkpoint.not_found" });
    res.json(p);
  });
  r.post("/:id/restore", async (req, res) => {
    if (!adminOnly(req, res)) return;
    try {
      res.json(await restoreCheckpoint(deps.db, String(req.params["id"]), deps.actorIdOf(req), deps.now()));
    } catch (e) {
      if (e instanceof CheckpointError)
        return res.status(e.code === "checkpoint.not_found" ? 404 : 409).json({ error: e.message, code: e.code });
      throw e;
    }
  });
  return r;
}
