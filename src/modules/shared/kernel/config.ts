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
  /** Gelen lead akışı (Faz 2). */
  intake: IntakeConfig;
  /** Giden e-posta; host boşsa e-posta bildirimi kapalı, yalnız loglanır. */
  smtp: SmtpConfig;
  /** E-posta ve bildirimlerdeki bağlantıların kökü (ör. https://crm.example.com). */
  publicBaseUrl: string;
}

export interface IntakeConfig {
  /** İşleyicinin inbox'ı yoklama aralığı (saniye). */
  pollSeconds: number;
  /** Geçici hatada yeniden deneme aralıkları (dakika); liste bitince `failed`. Genel plan: 1, 5, 30, 120, 720. */
  retryMinutes: readonly number[];
  /** Yedek senkron aralığı (dakika) ve geriye bakış penceresi (saat). */
  backfillIntervalMinutes: number;
  backfillLookbackHours: number;
  /** Inbox payload saklama süresi (gün); sonrası silinir, satır kalır. */
  retentionDays: number;
  /** Ülkesiz telefon numaraları için varsayılan ülke (ISO-3166 iki harf). */
  defaultCountry: string;
}

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  from: string;
  /** Kimlik bilgileri secret olarak ayrıca okunur (SMTP_USER, SMTP_PASSWORD); burada yalnız adı. */
  userSecretName: string;
  passwordSecretName: string;
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
    intake: {
      pollSeconds: num(env["INTAKE_POLL_SECONDS"], 5),
      retryMinutes: numList(env["INTAKE_RETRY_MINUTES"], [1, 5, 30, 120, 720]),
      backfillIntervalMinutes: num(env["BACKFILL_INTERVAL_MINUTES"], 60),
      backfillLookbackHours: num(env["BACKFILL_LOOKBACK_HOURS"], 2),
      retentionDays: num(env["INBOX_RETENTION_DAYS"], 30),
      defaultCountry: (env["INTAKE_DEFAULT_COUNTRY"] ?? "TR").toUpperCase(),
    },
    smtp: {
      host: env["SMTP_HOST"] ?? "",
      port: num(env["SMTP_PORT"], 465),
      secure: (env["SMTP_SECURE"] ?? "1") !== "0",
      from: env["SMTP_FROM"] ?? "",
      userSecretName: "SMTP_USER",
      passwordSecretName: "SMTP_PASSWORD",
    },
    publicBaseUrl: (env["PUBLIC_BASE_URL"] ?? "").replace(/\/+$/, ""),
  };
}

const numList = (v: string | undefined, fallback: readonly number[]): number[] => {
  const parsed = list(v)
    .map(Number)
    .filter((n) => Number.isFinite(n) && n > 0);
  return parsed.length ? parsed : [...fallback];
};

/** Secret'lar yalnız adıyla istenir; değer döner, kaydedilmez. Tanımsızsa boş string. */
export function readSecret(name: string, env: Env = process.env): string {
  return env[name] ?? "";
}
