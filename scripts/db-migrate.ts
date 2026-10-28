// Migration'ları uygular: `npm run db:migrate`. DATABASE_URL yoksa yerel PGlite klasörünü kullanır.
import "../server/env.mjs";
import { loadConfig } from "../src/modules/shared/kernel";
import { MIGRATIONS_DIR, migrate, openDatabase, readMigrations } from "../src/modules/shared/db";

const config = loadConfig();
const db = await openDatabase(config);
const result = await migrate(db, readMigrations(MIGRATIONS_DIR));
console.log(`[db] hedef: ${config.databaseUrl ? "postgres" : `pglite (${config.pgliteDir})`}`);
console.log(
  `[db] uygulandı: ${result.applied.length ? result.applied.join(", ") : "yok"}; atlandı: ${result.skipped.length}`,
);
await db.close();
