import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AppConfig } from "../kernel";
import type { Db } from "./db";
import { migrate, readMigrations } from "./migrate";
import { createPgDb } from "./pg";
import { createPgliteDb } from "./pglite";

export const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "db", "migrations");

/**
 * Config'e göre veritabanını açar ve migration'ları uygular.
 *  - DATABASE_URL varsa gerçek Postgres.
 *  - Yoksa PGlite: `memory` ile bellekte (testler), yoksa config'teki klasörde (yerel geliştirme).
 */
export async function openDatabase(
  config: Pick<AppConfig, "databaseUrl" | "pgliteDir">,
  opts: { memory?: boolean; migrate?: boolean; pgliteDir?: string } = {},
): Promise<Db> {
  const db = config.databaseUrl
    ? createPgDb(config.databaseUrl, { ssl: /sslmode=require/.test(config.databaseUrl) })
    : await createPgliteDb(opts.memory ? undefined : (opts.pgliteDir ?? config.pgliteDir));
  // Faz 7g: içe aktarmanın kuru çalıştırması ve doğrulaması şemaya dokunmaz (`migrate: false`).
  if (opts.migrate !== false) await migrate(db, readMigrations(MIGRATIONS_DIR));
  return db;
}

/** Uygulanmış en yüksek migration sürümü; tablo yoksa 0. */
export async function schemaVersion(db: Db): Promise<number> {
  try {
    const rows = await db.query<{ v: number | string | null }>("SELECT max(version) AS v FROM schema_migrations");
    return Number(rows[0]?.v ?? 0);
  } catch {
    return 0;
  }
}
