import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "./db";
import { MIGRATIONS_DIR } from "./open";
import { migrate, readMigrations } from "./migrate";
import { createPgliteDb } from "./pglite";

describe("migration koşucusu + Faz 1–2 şeması (PGlite)", () => {
  let db: Db;
  beforeAll(async () => {
    db = await createPgliteDb();
  });
  afterAll(() => db.close());

  it("dosyaları sırayla uygular, ikinci çalıştırmada atlar", async () => {
    const files = readMigrations(MIGRATIONS_DIR);
    expect(files.map((f) => f.version)).toEqual([1, 2, 3, 4]);
    const first = await migrate(db, files);
    expect(first.applied).toEqual(["0001_faz1_core", "0002_faz1_seed", "0003_faz2_intake", "0004_faz2_seed"]);
    const second = await migrate(db, files);
    expect(second.applied).toEqual([]);
    expect(second.skipped).toHaveLength(4);
  });

  it("on dört tablo ve seed verisi var", async () => {
    const tables = (
      await db.query<{ table_name: string }>(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY 1",
      )
    ).map((r) => r.table_name);
    expect(tables).toEqual([
      "form_field_mappings",
      "inbound_webhook_events",
      "integration_settings",
      "lead_attribution",
      "lead_consents",
      "lead_stage_events",
      "leads",
      "lost_reasons",
      "outbound_conversion_events",
      "persons",
      "platform_stage_mappings",
      "schema_migrations",
      "stage_definitions",
      "territory_rules",
      "user_notifications",
    ]);
    const stages = await db.query<{ code: string; is_terminal: boolean }>(
      "SELECT code, is_terminal FROM stage_definitions ORDER BY sort_order",
    );
    expect(stages.map((s) => s.code)).toEqual(["NEW", "CONTACTED", "QUALIFIED", "PROPOSAL", "WON", "LOST"]);
    expect(stages.filter((s) => s.is_terminal).map((s) => s.code)).toEqual(["WON", "LOST"]);
    expect(await db.query("SELECT code FROM lost_reasons")).toHaveLength(7);
    expect(await db.query("SELECT * FROM territory_rules")).toHaveLength(0);
    expect(await db.query("SELECT id FROM form_field_mappings WHERE provider = 'meta'")).toHaveLength(16);
    expect(await db.query("SELECT id FROM form_field_mappings WHERE provider = 'google'")).toHaveLength(14);
    expect(await db.query("SELECT key FROM integration_settings")).toHaveLength(4);
  });

  it("UNIQUE(source, platform_lead_id) çift kaydı engeller", async () => {
    const person = "11111111-1111-4111-8111-111111111111";
    await db.query("INSERT INTO persons (id) VALUES ($1)", [person]);
    const ins = (id: string) =>
      db.query(
        "INSERT INTO leads (id, source, platform_lead_id, person_id, current_stage) VALUES ($1,'meta_form','123',$2,'NEW')",
        [id, person],
      );
    await ins("22222222-2222-4222-8222-222222222222");
    await expect(ins("33333333-3333-4333-8333-333333333333")).rejects.toThrow(/leads_platform_uq|duplicate/);
  });

  it("lead_stage_events yalnız eklemeli: silme ve alan değişikliği reddedilir, undone_at serbest", async () => {
    const lead = "22222222-2222-4222-8222-222222222222";
    const ev = "44444444-4444-4444-8444-444444444444";
    await db.query(
      "INSERT INTO lead_stage_events (id, lead_id, change_id, stage_code, occurred_at, sequence, origin) VALUES ($1,$2,$1,'NEW',now(),1,'system')",
      [ev, lead],
    );
    await expect(db.query("DELETE FROM lead_stage_events WHERE id = $1", [ev])).rejects.toThrow(/yalnız eklemeli/);
    await expect(db.query("UPDATE lead_stage_events SET stage_code = 'WON' WHERE id = $1", [ev])).rejects.toThrow(
      /yalnız eklemeli/,
    );
    await db.query("UPDATE lead_stage_events SET undone_at = now(), undone_by_user_id = 'u1' WHERE id = $1", [ev]);
    await expect(db.query("UPDATE lead_stage_events SET undone_at = NULL WHERE id = $1", [ev])).rejects.toThrow(
      /geri alınmış/,
    );
  });

  it("transaction: hata olunca hiçbir şey yazılmaz", async () => {
    const before = await db.query("SELECT id FROM persons");
    await expect(
      db.transaction(async (tx) => {
        await tx.query("INSERT INTO persons (id) VALUES ('55555555-5555-4555-8555-555555555555')");
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await db.query("SELECT id FROM persons")).toHaveLength(before.length);
  });
});
