/**
 * Config ve secret'ların tek okuma noktası (ADR-0004). Modüller `process.env`'e dokunmaz;
 * ihtiyaç duydukları değeri bu nesneden alır. Secret değerleri loglanmaz, arayüze gitmez.
 */
export interface AppConfig {
  /** Postgres bağlantı adresi; boşsa yerel geliştirme PGlite ile çalışır. */
  databaseUrl: string;
  /** Yerel PGlite veri klasörü (DATABASE_URL yoksa). */
  pgliteDir: string;
  /** Aşama değişikliğinin geri alınabileceği süre (dakika). Genel plan: 10. */
  undoWindowMinutes: number;
  /** Dağıtıcının bekleme süresi; undoWindowMinutes ile aynı olmalı. */
  dispatchDelayMinutes: number;
  /** Platform adaptörleri (Faz 4–5). Faz 1'de boş: outbox satırı yazılmaz. */
  enabledProviders: readonly string[];
}

export type Env = Readonly<Record<string, string | undefined>>;

const num = (v: string | undefined, fallback: number): number => {
  const n = Number(v);
  return v !== undefined && v !== "" && Number.isFinite(n) ? n : fallback;
};

const list = (v: string | undefined): string[] =>
  (v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

export function loadConfig(env: Env = process.env): AppConfig {
  const undo = num(env["UNDO_WINDOW_MINUTES"], 10);
  return {
    databaseUrl: env["DATABASE_URL"] ?? "",
    pgliteDir: env["PGLITE_DIR"] ?? "server/data/pglite",
    undoWindowMinutes: undo,
    dispatchDelayMinutes: num(env["DISPATCH_DELAY_MINUTES"], undo),
    enabledProviders: list(env["ENABLED_PROVIDERS"]),
  };
}

/** Secret'lar yalnız adıyla istenir; değer döner, kaydedilmez. Tanımsızsa boş string. */
export function readSecret(name: string, env: Env = process.env): string {
  return env[name] ?? "";
}
