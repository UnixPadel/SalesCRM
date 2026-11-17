import { describe, expect, it } from "vitest";
import { createPgliteDb } from "../db/pglite";
import { MIGRATIONS_DIR } from "../db/open";
import { migrate, readMigrations } from "../db/migrate";
import { redactSecrets } from "./redact";

// Uydurma, biçimce Meta token'ına benzeyen değer (gerçek token değil).
const FAKE_META = "EAA" + "Xy7".repeat(30);

describe("hata metinlerinde token gizleme", () => {
  it("Meta, Google ve Bearer token'ları gizlenir; kimlikler ve metin kalır", () => {
    const graph = `Unsupported post request. Object with ID '${FAKE_META}' does not exist (code 100/33)`;
    expect(redactSecrets(graph)).toBe(
      "Unsupported post request. Object with ID 'EAA…(gizlendi)' does not exist (code 100/33)",
    );
    expect(redactSecrets("token ya29.a0AfB_byC1234567890abcdefghijkl süresi doldu")).toBe(
      "token ya29.…(gizlendi) süresi doldu",
    );
    expect(redactSecrets("Authorization: Bearer abcdefghijklmnop1234")).toBe("Authorization: Bearer …(gizlendi)");
    expect(redactSecrets("Object with ID '1463363138990477' does not exist")).toBe(
      "Object with ID '1463363138990477' does not exist",
    );
  });

  it("migration 0016 kayıtlı hata metinlerini temizler", async () => {
    const db = await createPgliteDb();
    const files = readMigrations(MIGRATIONS_DIR);
    await migrate(
      db,
      files.filter((f) => f.version < 16),
    );
    await db.exec(`INSERT INTO inbound_webhook_events (id, provider, kind, dedupe_key, status, last_error, received_at, next_attempt_at)
      VALUES (gen_random_uuid(), 'meta', 'webhook', 'k1', 'failed', 'Object with ID ''${FAKE_META}'' yok', now(), now())`);
    await migrate(db, files);
    const [row] = await db.query<{ last_error: string }>("SELECT last_error FROM inbound_webhook_events");
    expect(row!.last_error).toBe("Object with ID 'EAA…(gizlendi)' yok");
    await db.close();
  });
});
