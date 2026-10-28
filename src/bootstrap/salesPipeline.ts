/**
 * Kompozisyon kökü: config → veritabanı → repository'ler → use-case'ler → Express router.
 * Yalnız burası somut uygulamaları bir araya getirir; modüller birbirini doğrudan bilmez.
 */
import type { Request, Router } from "express";
import { openDatabase, type Db } from "../modules/shared/db";
import {
  createLogger,
  loadConfig,
  systemClock,
  uuidGenerator,
  type AppConfig,
  type Env,
  type Logger,
} from "../modules/shared/kernel";
import { createSalesPipeline, type SalesPipeline } from "../modules/sales-pipeline/application";
import { createSalesPipelineRouter } from "../modules/sales-pipeline/api";
import { PgUnitOfWork } from "../modules/sales-pipeline/infrastructure";

export interface SessionLike {
  userId?: string;
  email?: string;
  role?: string;
}

export interface SalesPipelineApp {
  router: Router;
  pipeline: SalesPipeline;
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

export async function bootSalesPipeline(
  opts: { logger?: Logger; memory?: boolean; env?: Env } = {},
): Promise<SalesPipelineApp> {
  const config = loadConfig(opts.env ?? process.env);
  const logger = opts.logger ?? createLogger({ module: "sales-pipeline" });
  const db = await openDatabase(config, { memory: opts.memory ?? false });
  const pipeline = createSalesPipeline({
    uow: new PgUnitOfWork(db, uuidGenerator),
    clock: systemClock,
    ids: uuidGenerator,
    platforms: { enabledProviders: () => config.enabledProviders },
    // Bildirimler Faz 2'de abone olur; şimdilik olaylar yalnız loglanır.
    events: {
      publish: async (events) =>
        events.forEach((e) => logger.debug("domain event", { type: e.type, leadId: e.leadId })),
    },
    logger,
    undoWindowMs: config.undoWindowMinutes * 60_000,
  });
  const router = createSalesPipelineRouter({
    pipeline,
    db,
    logger,
    undoWindowMinutes: config.undoWindowMinutes,
    actorOf: (req: Request) => actorFromSession((req as Request & { session?: SessionLike }).session),
  });
  logger.info("sales-pipeline hazır", {
    db: config.databaseUrl ? "postgres" : "pglite",
    providers: config.enabledProviders,
  });
  return { router, pipeline, db, config, logger, close: () => db.close() };
}
