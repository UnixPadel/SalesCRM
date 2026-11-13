/**
 * Kompozisyon kökü, Faz 2–3: inbox deposu → adaptörler → lead-intake işleri → webhook/form router'ları + zamanlayıcı.
 * Secret'lar burada adıyla okunur ve adaptörlere değer olarak verilir; modüller process.env görmez.
 * Çekme modu (WEB_PULL_URL + WEB_FORM_HMAC_KEY): site talepleri saklar, "web-pull" işi çeker (worker'da tanımlanır).
 */
import type { Router } from "express";
import { IntegrationSettings } from "../modules/integration-settings/application";
import {
  pgFieldMappingRepository,
  pgSettingsRepository,
  pgStageMappingRepository,
} from "../modules/integration-settings/infrastructure";
import { googleSourceAdapter, GOOGLE_SECRET_NAMES } from "../modules/lead-intake/adapters/google";
import {
  createGraphClient,
  metaBackfillSource,
  metaConfig,
  metaConfigured,
  metaSourceAdapter,
  type FetchLike,
} from "../modules/lead-intake/adapters/meta";
import {
  createWebPullClient,
  webFormSourceAdapter,
  webPullItemToInbox,
  WEB_PROVIDER,
  WEB_SECRET_NAMES,
  type PullFetchLike,
} from "../modules/lead-intake/adapters/web-form";
import { createFormsRouter, createWebhookRouter } from "../modules/lead-intake/api";
import {
  createLeadIntake,
  EMPTY_WEB_PULL_STATUS,
  PullWebSubmissions,
  type BackfillSource,
  type LeadIntake,
  type SourceAdapter,
  type WebPullStatus,
  type WebPullStatusStore,
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
  /** /forms/web (Faz 3). webhooks gibi genel JSON ayrıştırıcısından önce bağlanır. */
  forms: Router;
  intake: LeadIntake;
  settings: IntegrationSettings;
  scheduler: Scheduler;
  /** Hangi sağlayıcılar yapılandırıldı (loglar ve sağlık ucu için). `webPull`: bu süreç siteden çekiyor. */
  providers: { meta: boolean; google: boolean; web: boolean; webPull: boolean; encrypted: boolean };
  /** Çekme işi; bu süreçte WEB_PULL_URL + anahtar yoksa null. */
  webPull: PullWebSubmissions | null;
  /** Çekmenin son durumu (veritabanından; worker başka süreçte olsa da yönetim paneli buradan okur). */
  webPullStatus: WebPullStatusStore;
}

/** integration_settings (provider "web", key "pull_status"): secret ve kişisel veri yok. */
export const WEB_PULL_STATUS_KEY = "pull_status";

export interface BootLeadIntakeOptions {
  logger?: Logger;
  env?: Env;
  /** Testler: Graph API çağrıları için sahte fetch. */
  metaFetch?: FetchLike;
  /** Testler: sitenin çekme API'si için sahte fetch. */
  webPullFetch?: PullFetchLike;
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

  // Aynı nesne ad-feedback'e verilir (server/index.mjs): aşama eşlemeleri olmadan dağıtıcı her satırı
  // `mapping_missing` ile atlar; bu yüzden üç depo da burada bağlanır.
  const settings = new IntegrationSettings({
    mappings: pgFieldMappingRepository(db),
    settings: pgSettingsRepository(db),
    stageMappings: pgStageMappingRepository(db),
    clock: systemClock,
  });

  const adapters: SourceAdapter[] = [googleSourceAdapter(), webFormSourceAdapter()];
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

  const webSecret = read(WEB_SECRET_NAMES.hmacKey);
  const forms = createFormsRouter({ accept: intake.accept, logger, web: webSecret ? { secret: webSecret } : null });

  const webPullStatus: WebPullStatusStore = {
    load: async () => {
      const v = await settings.getJson<WebPullStatus | null>(WEB_PROVIDER, WEB_PULL_STATUS_KEY, null);
      return v && typeof v === "object" ? { ...EMPTY_WEB_PULL_STATUS, ...v } : null;
    },
    save: (status) => settings.setJson(WEB_PROVIDER, WEB_PULL_STATUS_KEY, status),
  };
  const webPull =
    config.webPull.url && webSecret
      ? new PullWebSubmissions({
          source: createWebPullClient({
            baseUrl: config.webPull.url,
            secret: webSecret,
            ...(opts.webPullFetch ? { fetchImpl: opts.webPullFetch } : {}),
          }),
          accept: intake.accept,
          provider: WEB_PROVIDER,
          toInbox: webPullItemToInbox,
          clock: systemClock,
          logger: logger.child({ job: "web-pull" }),
          status: webPullStatus,
          pageSize: config.webPull.pageSize,
          maxPages: config.webPull.maxPages,
        })
      : null;
  if (config.webPull.url && !webSecret) logger.warn("WEB_PULL_URL tanımlı ama WEB_FORM_HMAC_KEY yok: çekme kapalı");

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
      ...(webPull
        ? [
            {
              name: "web-pull",
              everyMs: config.webPull.seconds * 1000,
              runAtStart: true,
              run: async () => void (await webPull.runOnce()),
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

  const providers = {
    meta: metaConfigured(meta),
    google: Boolean(googleKey),
    web: Boolean(webSecret),
    webPull: Boolean(webPull),
    encrypted: Boolean(keyB64),
  };
  logger.info("lead-intake hazır", { ...providers, backfill: backfillSources.map((s) => s.provider) });
  return { webhooks, forms, intake, settings, scheduler, providers, webPull, webPullStatus };
}
