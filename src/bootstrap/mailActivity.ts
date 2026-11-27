/**
 * Mail gönderim raporu (2026-11-27): satis@, export3@, export2@, yusa@ hesaplarının Gönderilmiş klasörü saatte bir
 * salt-okunur taranır, her gönderilen mailin tarihi ve alıcıları veritabanına yazılır (konu / gövde yok). Yönetim >
 * Mail Gönderimleri haftalık sayımı veritabanından hesaplar. Yalnız CRM_MAIL_STATS_VIEWERS (varsayılan admin,
 * elshan.rasulov) görür; yönetici rolü tek başına yetmez.
 *
 * Kaynak cPanel "Track Delivery" değil IMAP: cPanel'e erişim yok. Sınır: Gönderilmiş klasörüne kopyası düşmeyen
 * mail (Sent'e kaydetmeyen bir telefon uygulaması) sayılmaz; gönderilip ilk taramadan önce silinen mail kaçabilir.
 */
import type { Request, Router } from "express";
import type { Db } from "../modules/shared/db";
import {
  createScheduler,
  MINUTE,
  readSecret,
  systemClock,
  type AppConfig,
  type Clock,
  type Env,
  type Logger,
  type MailStatsConfig,
  type Scheduler,
} from "../modules/shared/kernel";
import {
  MailActivityQueries,
  scanSentFolders,
  type LeadMatcher,
  type MailboxScanResult,
  type SentSource,
} from "../modules/mail-activity/application";
import { createMailActivityRouter } from "../modules/mail-activity/api";
import {
  createImapSentSource,
  pgMailActivityStore,
  type ImapCredentials,
} from "../modules/mail-activity/infrastructure";
import type { SessionLike } from "./salesPipeline";

const JOB = "mail-activity-scan";

export interface MailActivity {
  router: Router;
  /** Tarama kapalıysa (MAIL_STATS_ENABLED=0 ya da hiçbir hesabın giriş bilgisi yok) null. */
  scheduler: Scheduler | null;
  /** Elle tarama; çalışıyorsa bitmesini bekler. Son turun sonucunu döner. */
  runNow(): Promise<readonly MailboxScanResult[]>;
}

/** Hesabın kendi şifresi (MAIL_STATS_PASS_*), yoksa IMAP master kullanıcı ("<adres>*<master>"), yoksa null. */
export function mailStatsCredentials(
  cfg: MailStatsConfig,
  env: Env = process.env,
): (mailbox: string) => ImapCredentials | null {
  const master = readSecret(cfg.masterPasswordSecretName, env);
  const own = new Map(cfg.mailboxes.map((b) => [b.address, readSecret(b.passwordSecretName, env)]));
  return (mailbox) => {
    const pass = own.get(mailbox);
    if (pass) return { user: mailbox, pass };
    if (cfg.masterUser && master) return { user: `${mailbox}*${cfg.masterUser}`, pass: master };
    return null;
  };
}

/**
 * Alıcı → lead: kişinin e-postası (persons.email_normalized) önce, yoksa lead'in kendi e-postası. Silinmiş ve test
 * lead'leri sayılmaz; birden çok lead varsa en son güncellenen.
 */
export function pgLeadMatcher(db: Db): LeadMatcher {
  return {
    async match(addresses) {
      if (!addresses.length) return new Map();
      const rows = await db.query(
        `WITH a AS (SELECT DISTINCT unnest($1::text[]) AS addr),
         hits AS (
           SELECT a.addr, l.id, l.full_name, l.updated_at, 0 AS pri
             FROM a JOIN persons p ON p.email_normalized = a.addr JOIN leads l ON l.person_id = p.id
            WHERE l.deleted_at IS NULL AND NOT l.is_test
           UNION ALL
           SELECT a.addr, l.id, l.full_name, l.updated_at, 1 AS pri
             FROM leads l JOIN a ON a.addr = lower(trim(l.email))
            WHERE l.deleted_at IS NULL AND NOT l.is_test
         )
         SELECT DISTINCT ON (addr) addr, id, full_name FROM hits ORDER BY addr, pri, updated_at DESC`,
        [[...addresses]],
      );
      return new Map(
        rows.map((r) => [String(r["addr"]), { leadId: String(r["id"]), name: String(r["full_name"] ?? "") }]),
      );
    },
  };
}

export function createMailActivity(opts: {
  db: Db;
  config: MailStatsConfig;
  logger: Logger;
  source: SentSource;
  canView(req: Request): boolean;
  clock?: Clock;
  /** false: zamanlayıcı kurulur ama başlatılmaz (testler). */
  start?: boolean;
}): MailActivity {
  const clock = opts.clock ?? systemClock;
  const store = pgMailActivityStore(opts.db);
  const mailboxes = opts.config.mailboxes.map((b) => b.address);
  const internalDomain = mailboxes[0]?.split("@")[1] ?? "unixpadel.com";
  const queries = new MailActivityQueries({
    store,
    matcher: pgLeadMatcher(opts.db),
    mailboxes,
    configured: (m) => opts.source.configured(m),
    clock,
    internalDomain,
  });
  const enabled = opts.config.enabled && mailboxes.some((m) => opts.source.configured(m));
  let running = false;
  let lastRunAt: Date | null = null;
  let last: readonly MailboxScanResult[] = [];

  const run = async () => {
    running = true;
    lastRunAt = clock.now();
    try {
      last = await scanSentFolders({
        source: opts.source,
        store,
        mailboxes,
        clock,
        backfillWeeks: opts.config.backfillWeeks,
        logger: opts.logger,
      });
      const added = last.reduce((n, r) => n + r.added, 0);
      const failed = last.filter((r) => r.status === "failed").length;
      if (added || failed) opts.logger.info("gönderilmiş klasörleri tarandı", { added, failed });
    } finally {
      running = false;
    }
  };
  const scheduler = enabled
    ? createScheduler([{ name: JOB, everyMs: opts.config.minutes * MINUTE, runAtStart: true, run }], opts.logger)
    : null;
  if (scheduler && (opts.start ?? true)) scheduler.start();

  const runNow = async () => {
    if (scheduler) await scheduler.runNow(JOB);
    return last;
  };
  const router = createMailActivityRouter({
    queries,
    canView: opts.canView,
    scan: {
      enabled,
      minutes: opts.config.minutes,
      running: () => running,
      lastRunAt: () => lastRunAt,
      runNow: async () => void (await runNow()),
    },
  });
  return { router, scheduler, runNow };
}

/** Görme izni: oturumun `seesMailStats` bayrağı (girişte server/roles.mjs mailStatsViewers ile hesaplanır). */
export const sessionSeesMailStats = (req: Request): boolean =>
  (req as Request & { session?: SessionLike }).session?.seesMailStats === true;

/** Sunucu bağlantısı: şifreler ortamdan, görme izni oturumun `seesMailStats` bayrağından. */
export function bootMailActivity(
  app: { db: Db; config: AppConfig; logger: Logger },
  env: Env = process.env,
): MailActivity {
  const cfg = app.config.mailStats;
  const logger = app.logger.child({ module: "mail-activity" });
  const source = createImapSentSource({
    host: cfg.imapHost,
    port: cfg.imapPort,
    credentials: mailStatsCredentials(cfg, env),
  });
  const ma = createMailActivity({
    db: app.db,
    config: cfg,
    logger,
    source,
    canView: sessionSeesMailStats,
  });
  const missing = cfg.mailboxes.filter((b) => !source.configured(b.address)).map((b) => b.passwordSecretName);
  if (cfg.enabled && missing.length)
    logger.warn("mail taraması: şifresi tanımlı olmayan hesaplar atlanır", { missing });
  return ma;
}
