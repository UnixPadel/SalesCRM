import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Db } from "./db";

/**
 * İleri yönlü, sıralı SQL migration'lar (ADR-0002). Dosya adı `NNNN_aciklama.sql`; her dosya tek
 * transaction'da uygulanır ve `schema_migrations` tablosuna yazılır. Uygulanmış dosya bir daha
 * çalışmaz; dosya içeriği sonradan değiştirilmez, yeni dosya eklenir.
 */
export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
}

export function readMigrations(dir: string): Migration[] {
  return readdirSync(dir)
    .filter((f) => /^\d{4}_.+\.sql$/.test(f))
    .sort()
    .map((f) => ({
      version: Number(f.slice(0, 4)),
      name: f.replace(/\.sql$/, ""),
      sql: readFileSync(join(dir, f), "utf8"),
    }));
}

export interface MigrateResult {
  applied: string[];
  skipped: string[];
}

export async function migrate(db: Db, migrations: readonly Migration[]): Promise<MigrateResult> {
  await db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       version    integer PRIMARY KEY,
       name       text NOT NULL,
       applied_at timestamptz NOT NULL DEFAULT now()
     )`,
  );
  const done = new Set(
    (await db.query<{ version: number }>("SELECT version FROM schema_migrations")).map((r) => Number(r.version)),
  );
  const result: MigrateResult = { applied: [], skipped: [] };
  for (const m of migrations) {
    if (done.has(m.version)) {
      result.skipped.push(m.name);
      continue;
    }
    await db.transaction(async (tx) => {
      await tx.exec(m.sql);
      await tx.query("INSERT INTO schema_migrations (version, name) VALUES ($1, $2)", [m.version, m.name]);
    });
    result.applied.push(m.name);
  }
  return result;
}
