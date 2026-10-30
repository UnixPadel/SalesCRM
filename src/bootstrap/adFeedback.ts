/**
 * Kompozisyon kökü, Faz 4: outbox deposu → platform göndericileri → dağıtıcı + dead-letter raporu + zamanlayıcı.
 * Secret'lar burada adıyla okunur ve adaptörlere değer olarak verilir; modüller process.env görmez.
 * Dağıtıcı ancak en az bir gönderici yapılandırıldıysa başlar; aksi hâlde outbox satırları bekler (pending).
 */
import {
  createCapiClient,
  metaCapiConfig,
  metaCapiSender,
  type FetchLike,
} from "../modules/ad-feedback/adapters/meta-capi";
import { createAdFeedback, type AdFeedback, type PlatformSender } from "../modules/ad-feedback/application";
import { pgOutboxRepository } from "../modules/ad-feedback/infrastructure";
import type { IntegrationSettings } from "../modules/integration-settings/application";
import {
  createScheduler,
  MINUTE,
  readSecret,
  systemClock,
  type Env,
  type Logger,
  type Scheduler,
} from "../modules/shared/kernel";
import type { SalesPipelineApp } from "./salesPipeline";

export interface AdFeedbackApp {
  feedback: AdFeedback;
  scheduler: Scheduler;
  /** Hangi göndericiler yapılandırıldı (loglar ve sağlık ucu için). */
  providers: { meta: boolean };
}

export interface BootAdFeedbackOptions {
  logger?: Logger;
  env?: Env;
  /** Testler: Conversions API için sahte fetch. */
  metaFetch?: FetchLike;
  /** false: zamanlayıcı kurulur ama başlatılmaz (testler, CLI). */
  startScheduler?: boolean;
}

export function bootAdFeedback(
  app: SalesPipelineApp,
  settings: IntegrationSettings,
  opts: BootAdFeedbackOptions = {},
): AdFeedbackApp {
  const env = opts.env ?? process.env;
  const read = (name: string) => readSecret(name, env);
  const logger = opts.logger ?? app.logger.child({ module: "ad-feedback" });
  const { config, db } = app;

  const senders: PlatformSender[] = [];
  const meta = metaCapiConfig(read);
  if (meta.token) {
    const client = createCapiClient({
      graphVersion: meta.graphVersion,
      token: meta.token,
      logger,
      ...(opts.metaFetch ? { fetchImpl: opts.metaFetch } : {}),
    });
    senders.push(
      metaCapiSender({
        client,
        datasetId: async () => (await settings.get("meta", "dataset_id")) || meta.datasetId,
        testEventCode: meta.testEventCode || undefined,
      }),
    );
    if (meta.testEventCode)
      logger.warn("META_TEST_EVENT_CODE tanımlı: olaylar Events Manager test akışına gider (yalnız staging)");
  }

  const feedback = createAdFeedback({
    outbox: pgOutboxRepository(db),
    context: app.pipeline.queries,
    policy: settings,
    senders,
    clock: systemClock,
    logger,
    retryMinutes: config.outbound.retryMinutes,
    consentRequiredType: config.outbound.consentRequiredType,
    batchSize: config.outbound.batchSize,
    mailer: app.email,
    reportRecipients: config.outbound.reportRecipients,
    publicBaseUrl: config.publicBaseUrl,
  });

  const scheduler = createScheduler(
    [
      ...(senders.length
        ? [
            {
              name: "outbox-dispatch",
              everyMs: config.outbound.dispatchIntervalSeconds * 1000,
              run: async () => void (await feedback.dispatch.runOnce()),
            },
          ]
        : []),
      {
        name: "outbox-dead-letter-report",
        everyMs: 24 * 60 * MINUTE,
        runAtStart: true,
        run: async () => void (await feedback.report.runOnce()),
      },
    ],
    logger,
  );
  if (opts.startScheduler ?? true) scheduler.start();

  const providers = { meta: Boolean(meta.token) };
  logger.info("ad-feedback hazır", {
    ...providers,
    datasetConfigured: Boolean(meta.datasetId),
    enabledProviders: config.enabledProviders,
    reportRecipients: config.outbound.reportRecipients.length,
  });
  if (config.enabledProviders.length && !senders.length)
    logger.warn("ENABLED_PROVIDERS dolu ama hiçbir gönderici yapılandırılmadı: outbox satırları pending bekler");
  return { feedback, scheduler, providers };
}
