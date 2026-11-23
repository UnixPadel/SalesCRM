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
  ActionLog,
  ActionLogQueries,
  LeadNotifier,
  NotificationDelivery,
  NotificationQueries,
  NotificationSweeps,
  PushNotifier,
  PushSubscriptions,
  createSalesPipeline,
  type EmailSender,
  type SalesPipeline,
  type TeamDirectory,
  type UserDirectory,
} from "../modules/sales-pipeline/application";
import { createSalesPipelineRouter } from "../modules/sales-pipeline/api";
import { pgSettingsRepository } from "../modules/integration-settings/infrastructure";
import {
  PgUnitOfWork,
  createSmtpEmailSender,
  createWebPushTransport,
  loggingEmailSender,
  pgActionLogStore,
  pgNotificationStore,
  pgPushSubscriptionStore,
  pgSweepSource,
} from "../modules/sales-pipeline/infrastructure";

import { createEurRatesStore, type EurRatesStore } from "./eurRates";

export interface SessionLike {
  userId?: string;
  email?: string;
  role?: string;
  /** Kampanya adlarını görebilir (server/roles.mjs CRM_CAMPAIGN_VIEWERS). */
  seesCampaign?: boolean;
  /** İşlem günlüğünü görebilir (server/roles.mjs CRM_LOG_VIEWERS). */
  seesLogs?: boolean;
}

export interface SalesPipelineApp {
  router: Router;
  pipeline: SalesPipeline;
  notifications: NotificationQueries;
  /** Web Push açık mı (VAPID anahtarları tanımlı). */
  pushEnabled: boolean;
  /** Zamanlı bildirim taraması (iş vadesi, bekleyen sıcak lead); yöneticileri çağıran verir. */
  notificationSweeps(managers: () => Promise<readonly string[]>): NotificationSweeps;
  /** E-posta gönderici (SMTP ya da log); ad-feedback dead-letter raporu da bunu kullanır. */
  email: EmailSender;
  db: Db;
  config: AppConfig;
  logger: Logger;
  /** Faz 7b: kurların kaynağı (ayar → ortam değişkeni → varsayılan); yönetim paneli buradan okur ve yazar. */
  eurRates: EurRatesStore;
  close(): Promise<void>;
}

/**
 * Oturum → Actor. `req.session` mevcut sunucunun auth middleware'i tarafından doldurulur.
 * Roller (README): admin her şeyi görür ve yapar; satışçı kendi + bölgesi; görüntüleyici
 * (muhasebe, fabrika, lojistik, gözlemci) her şeyi görür, hiçbir şeyi değiştiremez; pazarlama aynı, raporlar hariç.
 */
export function actorFromSession(s: SessionLike | undefined) {
  if (!s) return undefined;
  const userId = s.userId || s.email;
  if (!userId) return undefined;
  // Görüntüleyici ve pazarlama (server/roles.mjs): her lead'i görür (isAdmin görünürlüğü), hiçbir şeyi değiştiremez.
  const readOnly = s.role === "viewer" || s.role === "marketing";
  return {
    userId,
    isAdmin: s.role === "admin" || readOnly,
    readOnly,
    seesCampaign: s.seesCampaign === true,
    seesLogs: s.seesLogs === true,
  };
}

export interface BootOptions {
  logger?: Logger;
  memory?: boolean;
  env?: Env;
  /** Kullanıcı rehberi (ad, e-posta); sunucu şirket kullanıcı tablosundan verir. Yoksa e-posta gönderilmez. */
  users?: UserDirectory;
  /** Ekip dizini (Faz 7g): Özet rapor satırları, bölge atamasında pasif kullanıcı. Yoksa süzme yapılmaz. */
  team?: TeamDirectory;
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
  // Web Push (2026-11-23): VAPID anahtarları varsa her yeni bildirim abone tarayıcılara da gider.
  const notifyLogger = logger.child({ module: "notifications" });
  const pushStore = pgPushSubscriptionStore(db);
  const vapidPrivate = readSecret(config.push.privateKeySecretName, env);
  const pushEnabled = Boolean(config.push.publicKey && vapidPrivate && config.push.subject);
  if (config.push.publicKey && !pushEnabled) {
    logger.warn(
      "web push kapalı: VAPID_PRIVATE_KEY ve VAPID_SUBJECT (ya da SMTP_FROM / https PUBLIC_BASE_URL) gerekli",
    );
  }
  const push = pushEnabled
    ? new PushNotifier({
        store: pushStore,
        transport: createWebPushTransport({
          subject: config.push.subject,
          publicKey: config.push.publicKey,
          privateKey: vapidPrivate,
        }),
        logger: notifyLogger,
      })
    : null;
  const pushSubscriptions = new PushSubscriptions({
    store: pushStore,
    clock: systemClock,
    ids: uuidGenerator,
    publicKey: pushEnabled ? config.push.publicKey : "",
  });
  const notifier = new LeadNotifier({
    uow,
    notifications: notificationStore,
    push,
    email,
    users: opts.users ?? { findById: async () => undefined },
    clock: systemClock,
    ids: uuidGenerator,
    logger: notifyLogger,
    publicBaseUrl: config.publicBaseUrl,
  });
  const notifications = new NotificationQueries(notificationStore, systemClock);
  const notificationSweeps = (managers: () => Promise<readonly string[]>) =>
    new NotificationSweeps({
      source: pgSweepSource(db),
      delivery: new NotificationDelivery({ notifications: notificationStore, push, logger: notifyLogger }),
      managers,
      clock: systemClock,
      ids: uuidGenerator,
      logger: notifyLogger,
      hotRepHours: config.notify.hotRepHours,
      hotManagerHours: config.notify.hotManagerHours,
    });

  const eurRates = createEurRatesStore({
    settings: pgSettingsRepository(db),
    envJson: config.eurRatesJson,
    clock: systemClock,
    logger,
  });

  // İşlem günlüğü: use-case'ler başarıdan sonra yazar; Yönetim > Loglar okur.
  const actionStore = pgActionLogStore(db);
  const actions = new ActionLog({
    store: actionStore,
    uow,
    clock: systemClock,
    ids: uuidGenerator,
    logger: logger.child({ module: "action-log" }),
  });

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
    eurRatesSource: eurRates.current,
    team: opts.team,
    actions,
    policy: { repsEditProducts: config.repsEditProducts },
  });
  const router = createSalesPipelineRouter({
    pipeline,
    notifications,
    push: pushSubscriptions,
    actionLog: new ActionLogQueries(actionStore),
    db,
    logger,
    undoWindowMinutes: config.undoWindowMinutes,
    eurRatesSource: eurRates.current,
    policy: { repsEditProducts: config.repsEditProducts },
    actorOf: (req: Request) => actorFromSession((req as Request & { session?: SessionLike }).session),
  });
  logger.info("sales-pipeline hazır", {
    db: config.databaseUrl ? "postgres" : "pglite",
    providers: config.enabledProviders,
    email: opts.email ? "custom" : config.smtp.host ? "smtp" : "log",
    push: pushEnabled,
  });
  return {
    router,
    pipeline,
    notifications,
    pushEnabled,
    notificationSweeps,
    email,
    db,
    config,
    logger,
    eurRates,
    close: () => db.close(),
  };
}
