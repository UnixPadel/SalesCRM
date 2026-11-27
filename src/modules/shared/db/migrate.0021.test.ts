import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "./db";
import { MIGRATIONS_DIR } from "./open";
import { migrate, readMigrations } from "./migrate";
import { createPgliteDb } from "./pglite";

/**
 * Migration 0021 (işlem günlüğü): 1–20 uygulanır, örnek aşama olayı / görüşme kaydı / dosya eki yazılır, sonra 0021
 * uygulanır. Kişilerin yaptığı işlemler günlüğe aktarılır; içe aktarma aktörü, sistem ve geri alınmış olaylar
 * aktarılmaz. Sentetik veri.
 */
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const P = uuid(1);
const LEAD = uuid(100);

describe("migration 0021: işlem günlüğü ve geçmişin aktarılması", () => {
  let db: Db;
  const all = readMigrations(MIGRATIONS_DIR);
  const details = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : v) as Record<string, unknown>;

  beforeAll(async () => {
    db = await createPgliteDb();
    await migrate(
      db,
      all.filter((m) => m.version <= 20),
    );
    await db.query("INSERT INTO persons (id, country) VALUES ($1, 'TR')", [P]);
    await db.query(
      "INSERT INTO leads (id, source, person_id, current_stage, full_name) VALUES ($1, 'manual', $2, 'CONTACTED', 'Ayşe Demir')",
      [LEAD, P],
    );
    const stage = (n: number, seq: number, code: string, actor: string | null, origin: string, undone = false) =>
      db.query(
        `INSERT INTO lead_stage_events (id, lead_id, change_id, stage_code, occurred_at, sequence, actor_user_id, origin,
                                        undone_at, undone_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          uuid(n),
          LEAD,
          uuid(n + 1000),
          code,
          new Date(Date.UTC(2026, 10, seq)),
          seq,
          actor,
          origin,
          undone ? new Date(Date.UTC(2026, 10, seq, 1)) : null,
          undone ? actor : null,
        ],
      );
    await stage(201, 1, "NEW", null, "system");
    await stage(202, 2, "CONTACTED", "12", "manual");
    await stage(203, 3, "QUALIFIED", "12", "manual", true); // geri alınmış
    await stage(204, 4, "CONTACTED", "import", "manual"); // içe aktarma
    // Görüşme kaydı: tamamlanan aktivite + (aynı kayda bağlı) ikinci satır tek günlük satırı üretir.
    await db.query(
      "INSERT INTO contact_logs (id, lead_id, actor_user_id, created_at) VALUES ($1, $2, '12', $3), ($4, $2, 'import', $3)",
      [uuid(301), LEAD, new Date(Date.UTC(2026, 10, 5)), uuid(302)],
    );
    const activity = (n: number, type: string, outcome: string, at: Date) =>
      db.query(
        `INSERT INTO activities (id, lead_id, type, due_at, done_at, outcome, done_by_user_id, log_id)
         VALUES ($1, $2, $3, $4, $4, $5, '12', $6)`,
        [uuid(n), LEAD, type, at, outcome, uuid(301)],
      );
    await activity(401, "whatsapp", "awaiting_reply", new Date(Date.UTC(2026, 10, 5)));
    await activity(402, "call", "follow_up", new Date(Date.UTC(2026, 10, 6)));
    await db.query(
      `INSERT INTO lead_attachments (id, lead_id, stage_code, file_name, mime_type, size_bytes, content_base64,
                                     uploaded_by, uploaded_at)
       VALUES ($1, $2, 'CONTACTED', 'saha.png', 'image/png', 3, 'AQID', '12', $3),
              ($4, $2, 'CONTACTED', 'teklif.pdf', 'application/pdf', 3, 'AQID', '14', $5)`,
      [uuid(501), LEAD, new Date(Date.UTC(2026, 10, 7)), uuid(502), new Date(Date.UTC(2026, 10, 8))],
    );
    await migrate(db, all);
  });
  afterAll(() => db.close());

  it("kişilerin işlemleri aktarılır; sistem, içe aktarma ve geri alınmış olaylar aktarılmaz", async () => {
    const rows = await db.query<{
      id: string;
      actor_user_id: string;
      action: string;
      lead_id: string;
      lead_name: string;
      details: unknown;
    }>("SELECT id, actor_user_id, action, lead_id, lead_name, details FROM user_action_logs ORDER BY occurred_at");
    expect(rows.map((r) => [r.id, r.actor_user_id, r.action, details(r.details)])).toEqual([
      [uuid(202), "12", "stage.changed", { to: "CONTACTED" }],
      [uuid(301), "12", "contact.logged", { type: "whatsapp", outcome: "awaiting_reply" }],
      [uuid(501), "12", "attachment.added", { fileName: "saha.png", image: true }],
      [uuid(502), "14", "attachment.added", { fileName: "teklif.pdf", image: false }],
    ]);
    expect(rows.every((r) => r.lead_id === LEAD && r.lead_name === "Ayşe Demir")).toBe(true);
  });

  it("lead silinince günlük satırı aynen kalır (0027: yabancı anahtar yok, satır değişmez)", async () => {
    await db.query(
      "INSERT INTO leads (id, source, person_id, current_stage, full_name) VALUES ($1, 'manual', $2, 'NEW', 'Silinecek')",
      [uuid(900), P],
    );
    await db.query(
      `INSERT INTO user_action_logs (id, occurred_at, actor_user_id, action, lead_id, lead_name)
       VALUES ($1, now(), '12', 'lead.created', $2, 'Silinecek')`,
      [uuid(901), uuid(900)],
    );
    await db.query("DELETE FROM leads WHERE id = $1", [uuid(900)]);
    const [row] = await db.query<{ lead_id: string | null; lead_name: string }>(
      "SELECT lead_id, lead_name FROM user_action_logs WHERE id = $1",
      [uuid(901)],
    );
    expect(row).toEqual({ lead_id: uuid(900), lead_name: "Silinecek" });
  });
});
