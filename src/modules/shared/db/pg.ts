import pg from "pg";
import type { Db, Queryable } from "./db";

/** Gerçek Postgres (staging, canlı). Bağlantı adresi config'ten gelir (ADR-0004). */
export function createPgDb(connectionString: string, opts: { max?: number; ssl?: boolean } = {}): Db {
  const pool = new pg.Pool({
    connectionString,
    max: opts.max ?? 5,
    ssl: opts.ssl ? { rejectUnauthorized: false } : undefined,
  });

  const wrap = (c: { query: pg.Pool["query"] } | pg.PoolClient): Queryable => ({
    async query<R extends Record<string, unknown>>(sql: string, params: readonly unknown[] = []) {
      const res = await c.query(sql, [...params]);
      return res.rows as R[];
    },
    async exec(sql) {
      await c.query(sql);
    },
  });

  const base = wrap(pool);
  return {
    query: base.query,
    exec: base.exec,
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const out = await fn(wrap(client));
        await client.query("COMMIT");
        return out;
      } catch (e) {
        await client.query("ROLLBACK").catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}
