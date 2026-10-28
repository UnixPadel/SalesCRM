/**
 * Kompozisyon kökü, Faz 2: inbox deposu → adaptörler → lead-intake işleri → webhook router + zamanlayıcı.
 * Secret'lar burada adıyla okunur ve adaptörlere değer olarak verilir; modüller process.env görmez.
 */
import type { Router } from "express";
import { IntegrationSettings } from "../modules/integration-settings/application";
import { pgFieldMappingRepository, pgSettingsRepository } from "../modules/integration-settings/infrastructure";
import { googleSourceAdapter, GOOGLE_SECRET_NAMES } from "../modules/lead-intake/adapters/google";
import {
  createGraphClient,
  metaBackfillSource,
  metaConfig,
  metaConfigured,
  metaSourceAdapter,
  type FetchLike,
} from "../modules/lead-intake/adapters/meta";
import { createWebhookRouter } from "../modules/lead-intake/api";
import {
  createLeadIntake,
  type BackfillSource,
  type LeadIntake,
  type SourceAdapter,
} from "../modules/lead-intake/application";
import { pgInboxRepository } from "../modules/lead-intake/infrastructure";
import {
  createAesGcmCipher,
  createScheduler,
  MINUTE,
  plainTextCipher,
  readSecret,
  systemClock,
  uuidGenerator,
  type Env,
  type Logger,
  type Scheduler,
} from "../modules/shared/kernel";
import type { SalesPipelineApp } from "./salesPipeline";

export interface LeadIntakeApp {
  webhooks: Router;
  intake: LeadIntake;
  settings: IntegrationSettings;
  scheduler: Scheduler;
  /** Hangi sağlayıcılar yapılandırıldı (loglar ve sağlık ucu için). */
  providers: { meta: boolean; google: boolean; encrypted: boolean };
}

export interface BootLeadIntakeOptions {
  logger?: Logger;
  env?: Env;
  /** Testler: Graph API çağrıları için sahte fetch. */
  metaFetch?: FetchLike;
  /** false: zamanlayıcı kurulur ama başlatılmaz (testler, CLI). */
  startScheduler?: boolean;
}

export function bootLeadIntake(app: SalesPipelineApp, opts: BootLeadIntakeOptions = {}): LeadIntakeApp {
  const env = opts.env ?? process.env;
  const read = (name: string) => readSecret(name, env);
  const logger = opts.logger ?? app.logger.child({ module: "lead-intake" });
  const { config, db } = app;

  const keyB64 = read("INBOX_ENCRYPTION_KEY");
  const cipher = keyB64 ? createAesGcmCipher(keyB64) : plainTextCipher;
  if (!keyB64)
    logger.warn("INBOX_ENCRYPTION_KEY tanımsız: inbox payload'ı düz metin saklanıyor (yalnız yerel geliştirme)");

  const settings = new IntegrationSettings({
    mappings: pgFieldMappingRepository(db),
    settings: pgSettingsRepository(db),
    clock: systemClock,
  });

  const adapters: SourceAdapter[] = [googleSourceAdapter()];
  const backfillSources: BackfillSource[] = [];
  const meta = metaConfig(read);
  const graph = createGraphClient({
    version: meta.graphVersion,
    token: meta.systemUserToken,
    logger,
    ...(opts.metaFetch ? { fetchImpl: opts.metaFetch } : {}),
  });
  adapters.push(metaSourceAdapter(graph));
  if (meta.systemUserToken) {
    backfillSources.push(
      metaBackfillSource(graph, async () => {
        const fromSettings = await settings.getJson<string[]>("meta", "active_form_ids", []);
        return fromSettings.length ? fromSettings : meta.formIds;
      }),
    );
  }

  const intake = createLeadIntake({
    inbox: pgInboxRepository(db, cipher),
    adapters,
    backfillSources,
    mappings: settings,
    leads: app.pipeline.createLead,
    ids: uuidGenerator,
    clock: systemClock,
    logger,
    retryMinutes: config.intake.retryMinutes,
    defaultCountry: config.intake.defaultCountry,
    backfillLookbackHours: config.intake.backfillLookbackHours,
    retentionDays: config.intake.retentionDays,
  });

  const googleKey = read(GOOGLE_SECRET_NAMES.webhookKey);
  const webhooks = createWebhookRouter({
    accept: intake.accept,
    logger,
    meta: metaConfigured(meta) ? { appSecret: meta.appSecret, verifyToken: meta.verifyToken } : null,
    google: googleKey ? { key: googleKey } : null,
  });

  const scheduler = createScheduler(
    [
      {
        name: "inbox-process",
        everyMs: config.intake.pollSeconds * 1000,
        run: async () => void (await intake.process.runOnce()),
      },
      ...(backfillSources.length
        ? [
            {
              name: "inbox-backfill",
              everyMs: config.intake.backfillIntervalMinutes * MINUTE,
              run: async () => void (await intake.backfill.runOnce()),
            },
          ]
        : []),
      {
        name: "inbox-purge",
        everyMs: 24 * 60 * MINUTE,
        runAtStart: true,
        run: async () => void (await intake.purge.runOnce()),
      },
    ],
    logger,
  );
  if (opts.startScheduler ?? true) scheduler.start();

  const providers = { meta: metaConfigured(meta), google: Boolean(googleKey), encrypted: Boolean(keyB64) };
  logger.info("lead-intake hazır", { ...providers, backfill: backfillSources.map((s) => s.provider) });
  return { webhooks, intake, settings, scheduler, providers };
}
