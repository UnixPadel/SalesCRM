/**
 * Veritabanı erişim arayüzü. İki uygulama var: `pg` (gerçek Postgres; staging ve canlı) ve
 * PGlite (Node içinde Postgres motoru; testler ve yerel geliştirme). Repository'ler yalnız bu
 * arayüzü görür, hangisinin arkada olduğunu bilmez.
 */
export interface Queryable {
  /** Parametreli sorgu; satırları döner. Parametreler `$1, $2…` ile verilir. */
  query<R extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<R[]>;
  /** Parametresiz, çok ifadeli SQL (migration dosyaları). */
  exec(sql: string): Promise<void>;
}

export interface Db extends Queryable {
  /** fn içindeki tüm sorgular tek transaction'da; fn fırlatırsa ROLLBACK, yoksa COMMIT. */
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** Tek satır bekleyen sorgular için. */
export async function queryOne<R extends Record<string, unknown>>(
  q: Queryable,
  sql: string,
  params?: readonly unknown[],
): Promise<R | undefined> {
  const rows = await q.query<R>(sql, params);
  return rows[0];
}
