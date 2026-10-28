// shared/db: veritabanı erişimi (pg / PGlite) ve migration koşucusu. Yalnız infrastructure katmanları import eder.
export type { Db, Queryable } from "./db";
export { queryOne } from "./db";
export { createPgDb } from "./pg";
export { createPgliteDb } from "./pglite";
export { migrate, readMigrations, type Migration, type MigrateResult } from "./migrate";
export { MIGRATIONS_DIR, openDatabase } from "./open";
