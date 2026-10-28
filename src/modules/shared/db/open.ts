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
  opts: { memory?: boolean } = {},
): Promise<Db> {
  const db = config.databaseUrl
    ? createPgDb(config.databaseUrl, { ssl: /sslmode=require/.test(config.databaseUrl) })
    : await createPgliteDb(opts.memory ? undefined : config.pgliteDir);
  await migrate(db, readMigrations(MIGRATIONS_DIR));
  return db;
}
