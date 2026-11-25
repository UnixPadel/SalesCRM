/**
 * Config ve secret'ların tek okuma noktası (ADR-0004). Modüller `process.env`'e dokunmaz;
 * ihtiyaç duydukları değeri bu nesneden alır. Secret değerleri loglanmaz, arayüze gitmez.
 */
export interface AppConfig {
  /**
   * Postgres bağlantı adresi; boşsa yerel geliştirme PGlite ile çalışır. DATABASE_URL yoksa Clever Cloud PostgreSQL
   * eklentisinin bağlı uygulamaya verdiği POSTGRESQL_ADDON_URI kullanılır.
   */
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
  /** Giden olay dağıtıcısı (Faz 4–5). */
  outbound: OutboundConfig;
  /** Giden e-posta; host boşsa e-posta bildirimi kapalı, yalnız loglanır. */
  smtp: SmtpConfig;
  /** E-posta ve bildirimlerdeki bağlantıların kökü (ör. https://crm.example.com). */
  publicBaseUrl: string;
  push: PushConfig;
  notify: NotifyConfig;
  /** Pano toplamları için kurlar, JSON metni ({"USD":0.92,…}); boşsa modülün varsayılanı. Faz 7'de ekrandan. */
  eurRatesJson: string;
  /**
   * Faz 7g, D4 (açık soru 1, 2026-11-10 cevabı "Evet, sahibi girsin"): lead'in sorumlusu satışçı ürün tercihlerini
   * düzenler. Varsayılan açık; REPS_EDIT_PRODUCTS=0 yalnız yöneticiye bırakır.
   */
  repsEditProducts: boolean;
  /**
   * Form tablosu eşitlemesi (2026-11-11): Google E-Tablolar'ın CSV dışa aktarım adresi (bağlantıyla paylaşılmış Meta
   * form dökümü). Boşsa kapalı. Adres tablodaki kişisel veriye erişim verir: loglanmaz, arayüze gitmez.
   */
  sheetSync: { csvUrl: string; minutes: number };
  /**
   * Web sitesi çekme modu (docs/runbooks/web-form.md "Çekme modu"): sitenin çekme API'si tabanı. Boşsa kapalı.
   * Anahtar ayrıca secret olarak okunur (WEB_FORM_HMAC_KEY). Yalnız worker'da tanımlanır.
   */
  webPull: WebPullConfig;
  /**
   * UnixPadelST müşteri listesi (2026-11-25): Nitelikli ve üstü lead öteki programın MusteriBilgileri tablosuna yazılır.
   * Bağlantı secret olarak okunur: `ST_DB_URL`, yoksa `AUTH_DB_URL`. ST_CUSTOMER_SYNC=0 kapatır.
   */
  stCustomerSync: { enabled: boolean; minutes: number; dbUrlSecretNames: readonly string[] };
}

export interface WebPullConfig {
  url: string;
  /** Tur aralığı (saniye); varsayılan 120, en az 15. */
  seconds: number;
  /** `/pending` limit (1–100); varsayılan 50. */
  pageSize: number;
  /** Tur başına en çok sayfa; varsayılan 10. */
  maxPages: number;
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

export interface OutboundConfig {
  /** Dağıtıcının çalışma aralığı (saniye); Genel plan: her dakika. */
  dispatchIntervalSeconds: number;
  /** Geçici hatada yeniden deneme aralıkları (dakika); liste bitince `dead`. Genel plan: 1, 5, 30, 120, 720. */
  retryMinutes: readonly number[];
  /** Sağlayıcıya tek istekte gidecek en çok olay. */
  batchSize: number;
  /** KVKK onayı aranan tür (lead_consents.consent_type); web formu lead'inde verilmiş onay şart. */
  consentRequiredType: string;
  /** Günlük dead-letter raporu alıcıları; boşsa yalnız loglanır. */
  reportRecipients: readonly string[];
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

/** Web Push (VAPID). Açık anahtar boşsa push kapalıdır; zil çalışmaya devam eder. */
export interface PushConfig {
  /** Tarayıcıya verilen açık anahtar (VAPID_PUBLIC_KEY); gizli değildir. */
  publicKey: string;
  /** Gizli anahtar secret olarak ayrıca okunur (VAPID_PRIVATE_KEY); burada yalnız adı. */
  privateKeySecretName: string;
  /** Push servisinin sorun olursa ulaşacağı adres: `mailto:…` ya da https (VAPID_SUBJECT). */
  subject: string;
}

/** Zamanlı bildirimler (iş vadesi, bekleyen sıcak lead). */
export interface NotifyConfig {
  /** Tarama aralığı (dakika). */
  sweepMinutes: number;
  /** Sıcak lead'e bu kadar saat dokunulmazsa sorumlusuna bildirim; 0 = kapalı. */
  hotRepHours: number;
  /** Bu kadar saati de geçerse yöneticilere bildirim; 0 = kapalı. */
  hotManagerHours: number;
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
    databaseUrl: (env["DATABASE_URL"] || env["POSTGRESQL_ADDON_URI"] || "").trim(),
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
    outbound: {
      dispatchIntervalSeconds: num(env["OUTBOX_DISPATCH_SECONDS"], 60),
      retryMinutes: numList(env["OUTBOX_RETRY_MINUTES"], [1, 5, 30, 120, 720]),
      batchSize: num(env["OUTBOX_BATCH_SIZE"], 100),
      consentRequiredType: (env["CONSENT_REQUIRED_TYPE"] ?? "kvkk").trim() || "kvkk",
      reportRecipients: list(env["OUTBOX_REPORT_TO"]),
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
    push: {
      publicKey: (env["VAPID_PUBLIC_KEY"] ?? "").trim(),
      privateKeySecretName: "VAPID_PRIVATE_KEY",
      subject: pushSubject(env),
    },
    notify: {
      sweepMinutes: Math.max(1, num(env["NOTIFY_SWEEP_MINUTES"], 5)),
      hotRepHours: Math.max(0, num(env["HOT_LEAD_REP_HOURS"], 24)),
      hotManagerHours: Math.max(0, num(env["HOT_LEAD_MANAGER_HOURS"], 48)),
    },
    eurRatesJson: env["EUR_RATES"] ?? "",
    repsEditProducts: env["REPS_EDIT_PRODUCTS"] !== "0",
    sheetSync: {
      csvUrl: (env["SHEET_SYNC_CSV_URL"] ?? "").trim(),
      minutes: Math.max(1, num(env["SHEET_SYNC_MINUTES"], 5)),
    },
    webPull: {
      url: (env["WEB_PULL_URL"] ?? "").trim(),
      seconds: Math.max(15, num(env["WEB_PULL_SECONDS"], 120)),
      pageSize: Math.min(100, Math.max(1, num(env["WEB_PULL_LIMIT"], 50))),
      maxPages: Math.max(1, num(env["WEB_PULL_MAX_PAGES"], 10)),
    },
    stCustomerSync: {
      enabled: env["ST_CUSTOMER_SYNC"] !== "0",
      minutes: Math.max(1, num(env["ST_CUSTOMER_SYNC_MINUTES"], 5)),
      dbUrlSecretNames: ["ST_DB_URL", "AUTH_DB_URL"],
    },
  };
}

const numList = (v: string | undefined, fallback: readonly number[]): number[] => {
  const parsed = list(v)
    .map(Number)
    .filter((n) => Number.isFinite(n) && n > 0);
  return parsed.length ? parsed : [...fallback];
};

/** Secret'lar yalnız adıyla istenir; değer döner, kaydedilmez. Tanımsızsa boş string. */
/** VAPID_SUBJECT; yoksa gönderen e-posta adresi, o da yoksa uygulamanın https adresi. */
function pushSubject(env: Env): string {
  const given = (env["VAPID_SUBJECT"] ?? "").trim();
  if (/^(mailto:|https:\/\/)/.test(given)) return given;
  const from = (env["SMTP_FROM"] ?? "").trim();
  if (/^[^\s@<>]+@[^\s@<>]+$/.test(from)) return `mailto:${from}`;
  const base = (env["PUBLIC_BASE_URL"] ?? "").replace(/\/+$/, "");
  return base.startsWith("https://") ? base : "";
}

export function readSecret(name: string, env: Env = process.env): string {
  return env[name] ?? "";
}
