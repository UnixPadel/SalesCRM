import type { PGlite } from "@electric-sql/pglite";
import type { Db, Queryable } from "./db";

/**
 * PGlite: WebAssembly Postgres, ayrı süreç yok. `dataDir` verilmezse bellekte çalışır (testler);
 * verilirse diske yazar (yerel geliştirme, DATABASE_URL yokken).
 * Paket devDependency'dir ve burada geç yüklenir: üretimde (yalnız `dependencies` kurulu, DATABASE_URL tanımlı)
 * modülün içe aktarılması hata vermez.
 */
export async function createPgliteDb(dataDir?: string): Promise<Db> {
  const { PGlite: Lite } = await import("@electric-sql/pglite");
  const pg: PGlite = dataDir ? new Lite(dataDir) : new Lite();
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
