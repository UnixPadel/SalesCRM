/**
 * Kompozisyon kökü: config → veritabanı → repository'ler → use-case'ler → Express router.
 * Yalnız burası somut uygulamaları bir araya getirir; modüller birbirini doğrudan bilmez.
 */
import type { Request, Router } from "express";
import { openDatabase, type Db } from "../modules/shared/db";
import {
  createLogger,
  loadConfig,
  readSecret,
  systemClock,
  uuidGenerator,
  type AppConfig,
  type Env,
  type Logger,
} from "../modules/shared/kernel";
import {
  LeadNotifier,
  NotificationQueries,
  createSalesPipeline,
  type EmailSender,
  type SalesPipeline,
  type UserDirectory,
} from "../modules/sales-pipeline/application";
import { createSalesPipelineRouter } from "../modules/sales-pipeline/api";
import {
  PgUnitOfWork,
  createSmtpEmailSender,
  loggingEmailSender,
  pgNotificationStore,
} from "../modules/sales-pipeline/infrastructure";

export interface SessionLike {
  userId?: string;
  email?: string;
  role?: string;
}

export interface SalesPipelineApp {
  router: Router;
  pipeline: SalesPipeline;
  notifications: NotificationQueries;
  /** E-posta gönderici (SMTP ya da log); ad-feedback dead-letter raporu da bunu kullanır. */
  email: EmailSender;
  db: Db;
  config: AppConfig;
  logger: Logger;
  close(): Promise<void>;
}

/**
 * Oturum → Actor. `req.session` mevcut sunucunun auth middleware'i tarafından doldurulur.
 * Roller (README): admin her şeyi görür ve yapar; satışçı kendi + bölgesi; görüntüleyici
 * (muhasebe, fabrika, lojistik, gözlemci) her şeyi görür, hiçbir şeyi değiştiremez.
 */
export function actorFromSession(s: SessionLike | undefined) {
  if (!s) return undefined;
  const userId = s.userId || s.email;
  if (!userId) return undefined;
  const viewer = s.role === "viewer";
  return { userId, isAdmin: s.role === "admin" || viewer, readOnly: viewer };
}

export interface BootOptions {
  logger?: Logger;
  memory?: boolean;
  env?: Env;
  /** Kullanıcı rehberi (ad, e-posta); sunucu şirket kullanıcı tablosundan verir. Yoksa e-posta gönderilmez. */
  users?: UserDirectory;
  /** Testler: sahte gönderici. Verilmezse SMTP_HOST varsa SMTP, yoksa yalnız log. */
  email?: EmailSender;
}

export async function bootSalesPipeline(opts: BootOptions = {}): Promise<SalesPipelineApp> {
  const env = opts.env ?? process.env;
  const config = loadConfig(env);
  const logger = opts.logger ?? createLogger({ module: "sales-pipeline" });
  const db = await openDatabase(config, { memory: opts.memory ?? false });
  const uow = new PgUnitOfWork(db, uuidGenerator);

  // Bildirimler (Faz 2): LeadCreated → atanan satışçıya uygulama içi + e-posta. Olaylar ayrıca loglanır.
  const email =
    opts.email ??
    (config.smtp.host
      ? createSmtpEmailSender(
          config.smtp,
          { user: readSecret(config.smtp.userSecretName, env), pass: readSecret(config.smtp.passwordSecretName, env) },
          logger,
        )
      : loggingEmailSender(logger));
  const notificationStore = pgNotificationStore(db);
  const notifier = new LeadNotifier({
    uow,
    notifications: notificationStore,
    email,
    users: opts.users ?? { findById: async () => undefined },
    clock: systemClock,
    ids: uuidGenerator,
    logger: logger.child({ module: "notifications" }),
    publicBaseUrl: config.publicBaseUrl,
  });
  const notifications = new NotificationQueries(notificationStore, systemClock);

  const pipeline = createSalesPipeline({
    uow,
    clock: systemClock,
    ids: uuidGenerator,
    platforms: { enabledProviders: () => config.enabledProviders },
    events: {
      publish: async (events) => {
        events.forEach((e) => logger.debug("domain event", { type: e.type, leadId: e.leadId }));
        await notifier.publish(events);
      },
    },
    logger,
    undoWindowMs: config.undoWindowMinutes * 60_000,
  });
  const router = createSalesPipelineRouter({
    pipeline,
    notifications,
    db,
    logger,
    undoWindowMinutes: config.undoWindowMinutes,
    actorOf: (req: Request) => actorFromSession((req as Request & { session?: SessionLike }).session),
  });
  logger.info("sales-pipeline hazır", {
    db: config.databaseUrl ? "postgres" : "pglite",
    providers: config.enabledProviders,
    email: opts.email ? "custom" : config.smtp.host ? "smtp" : "log",
  });
  return { router, pipeline, notifications, email, db, config, logger, close: () => db.close() };
}
