import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPgliteDb, migrate, MIGRATIONS_DIR, readMigrations, type Db } from "../../shared/db";
import { FixedClock } from "../../shared/kernel";
import { IntegrationSettings } from "../application";
import { pgFieldMappingRepository, pgSettingsRepository } from "./index";

let db: Db;
let svc: IntegrationSettings;

beforeAll(async () => {
  db = await createPgliteDb();
  await migrate(db, readMigrations(MIGRATIONS_DIR));
  svc = new IntegrationSettings({
    mappings: pgFieldMappingRepository(db),
    settings: pgSettingsRepository(db),
    clock: new FixedClock("2026-03-01T10:00:00Z"),
  });
});
afterAll(() => db.close());

describe("integration-settings (PGlite, seed)", () => {
  it("seed eşlemeleri okunur; form satırı varsayılanı ezer", async () => {
    const generic = await svc.mappingsFor("meta", null);
    expect(generic.get("full_name")).toBe("full_name");
    expect(generic.get("work_email")).toBe("email");
    expect(generic.get("job_title")).toBe("extra");
    await db.query(
      "INSERT INTO form_field_mappings (id, provider, form_id, platform_field, target_field) VALUES (gen_random_uuid(), 'meta', 'f-1', 'job_title', 'product_interest')",
    );
    expect((await svc.mappingsFor("meta", "f-1")).get("job_title")).toBe("product_interest");
    expect((await svc.mappingsFor("meta", "f-2")).get("job_title")).toBe("extra");
    expect((await svc.listMappings("google")).every((m) => m.provider === "google")).toBe(true);
  });

  it("ayar: seed, set/get, JSON ve boolean", async () => {
    expect(await svc.getJson("meta", "active_form_ids", ["x"])).toEqual([]);
    expect(await svc.getBoolean("meta", "webhook_enabled", false)).toBe(true);
    expect(await svc.get("meta", "yok")).toBeNull();
    await svc.setJson("meta", "active_form_ids", ["f-1", "f-2"]);
    await svc.set("meta", "backfill_last_run_at", "2026-03-01T10:00:00.000Z");
    expect(await svc.getJson("meta", "active_form_ids", [])).toEqual(["f-1", "f-2"]);
    const rows = await svc.list("meta");
    expect(rows.find((r) => r.key === "backfill_last_run_at")).toMatchObject({
      value: "2026-03-01T10:00:00.000Z",
      updatedAt: new Date("2026-03-01T10:00:00Z"),
    });
    await db.query(
      "UPDATE integration_settings SET value = '{bozuk' WHERE provider = 'meta' AND key = 'active_form_ids'",
    );
    expect(await svc.getJson("meta", "active_form_ids", ["fallback"])).toEqual(["fallback"]);
  });
});
