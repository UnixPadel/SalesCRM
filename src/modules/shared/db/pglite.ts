import { PGlite } from "@electric-sql/pglite";
import type { Db, Queryable } from "./db";

/**
 * PGlite: WebAssembly Postgres, ayrı süreç yok. `dataDir` verilmezse bellekte çalışır (testler);
 * verilirse diske yazar (yerel geliştirme, DATABASE_URL yokken).
 */
export async function createPgliteDb(dataDir?: string): Promise<Db> {
  const pg = dataDir ? new PGlite(dataDir) : new PGlite();
  await pg.waitReady;

  const wrap = (q: { query: PGlite["query"]; exec: PGlite["exec"] }): Queryable => ({
    async query<R extends Record<string, unknown>>(sql: string, params: readonly unknown[] = []) {
      const res = await q.query<R>(sql, [...params]);
      return res.rows;
    },
    async exec(sql) {
      await q.exec(sql);
    },
  });

  const base = wrap(pg);
  return {
    query: base.query,
    exec: base.exec,
    transaction: (fn) => pg.transaction((tx) => fn(wrap(tx))),
    close: () => pg.close(),
  };
}
