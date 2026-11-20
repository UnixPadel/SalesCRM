/**
 * Kompozisyon kökü, Faz 7: yönetim paneli router'ı (`/api/admin`). Gelen kutusu sağlığı lead-intake'ten, giden
 * kuyruk ad-feedback'ten, eşleme ve ayarlar integration-settings'ten gelir; hangi sağlayıcının hangi secret ve
 * ayarı kullandığı yalnız burada yazılır (modüller sağlayıcı adını veriden alır). Secret'ların değeri okunmaz:
 * yalnız "tanımlı mı" bilgisi.
 */
import type { Request, Router } from "express";
import { GOOGLE_DM_SECRET_NAMES } from "../modules/ad-feedback/adapters/google-data-manager";
import { createAdminRouter, type ProviderInfo } from "../modules/integration-settings/api";
import { GOOGLE_SECRET_NAMES } from "../modules/lead-intake/adapters/google";
import { META_SECRET_NAMES } from "../modules/lead-intake/adapters/meta";
import { WEB_SECRET_NAMES } from "../modules/lead-intake/adapters/web-form";
import { STAGE_CODES } from "../modules/sales-pipeline/domain";
import { readSecret, systemClock, type Env } from "../modules/shared/kernel";
import type { AdFeedbackApp } from "./adFeedback";
import type { LeadIntakeApp } from "./leadIntake";
import type { SalesPipelineApp, SessionLike } from "./salesPipeline";

/** Meta sayfa / form / veri seti kimlikleri: yalnız rakam. */
const META_NUMERIC_ID = /^\d{1,25}$/;
/** Google Ads müşteri kimliği: 10 hane, tireli ya da tiresiz. */
const GOOGLE_CUSTOMER_ID = /^\d{3}-?\d{3}-?\d{4}$/;

export interface BootAdminOptions {
  env?: Env;
}

export function bootAdmin(
  app: SalesPipelineApp,
  leadIntake: LeadIntakeApp,
  adFeedback: AdFeedbackApp,
  opts: BootAdminOptions = {},
): Router {
  const env = opts.env ?? process.env;
  const secret = (name: string) => ({ name, set: readSecret(name, env).trim() !== "" });
  const listed = (provider: string) => app.config.enabledProviders.includes(provider);

  const providers = (): ProviderInfo[] => [
    {
      provider: "meta",
      inbound: leadIntake.providers.meta,
      outbound: adFeedback.providers.meta,
      listed: listed("meta"),
      secrets: [
        secret(META_SECRET_NAMES.appSecret),
        secret(META_SECRET_NAMES.verifyToken),
        // META_CAPI_TOKEN listelenmez (2026-11-19): giden yön sistem kullanıcısı token'ıyla çalışıyor.
        secret(META_SECRET_NAMES.systemUserToken),
      ],
      settings: [
        // Meta kimlikleri yalnız rakamdır; token gibi metinler reddedilir (2026-11-17: veri seti alanına token girilmişti).
        { key: "dataset_id", kind: "text", pattern: META_NUMERIC_ID },
        { key: "page_id", kind: "text", pattern: META_NUMERIC_ID },
        { key: "active_form_ids", kind: "list", pattern: META_NUMERIC_ID },
      ],
    },
    {
      provider: "google",
      inbound: leadIntake.providers.google,
      outbound: adFeedback.providers.google,
      listed: listed("google"),
      secrets: [secret(GOOGLE_SECRET_NAMES.webhookKey), secret(GOOGLE_DM_SECRET_NAMES.serviceAccountKey)],
      settings: [
        { key: "customer_id", kind: "text", pattern: GOOGLE_CUSTOMER_ID },
        { key: "login_customer_id", kind: "text", pattern: GOOGLE_CUSTOMER_ID },
      ],
    },
    {
      provider: "web",
      inbound: leadIntake.providers.web,
      outbound: null,
      listed: false,
      secrets: [secret(WEB_SECRET_NAMES.hmacKey)],
      settings: [],
    },
  ];

  return createAdminRouter({
    settings: leadIntake.settings,
    outbox: adFeedback.feedback.health,
    inbox: leadIntake.intake.health,
    logger: app.logger.child({ module: "admin" }),
    actorIdOf: (req: Request) => {
      const s = (req as Request & { session?: SessionLike }).session;
      return s?.userId || s?.email || "?";
    },
    providers,
    webPull: async () => {
      const status = await leadIntake.webPullStatus.load();
      const configuredHere = leadIntake.providers.webPull;
      if (!status && !configuredHere) return null;
      return {
        configuredHere,
        lastRunAt: status?.lastRunAt ?? null,
        lastPullAt: status?.lastPullAt ?? null,
        lastRunOk: status?.lastRunOk ?? null,
        lastErrorCode: status?.lastErrorCode ?? null,
        lastErrorKind: status?.lastErrorKind ?? null,
        lastErrorAt: status?.lastErrorAt ?? null,
        lastRound: status?.lastRound ?? null,
      };
    },
    generalSecrets: () => [
      secret("INBOX_ENCRYPTION_KEY"),
      secret(app.config.smtp.userSecretName),
      secret(app.config.smtp.passwordSecretName),
    ],
    stageCodes: STAGE_CODES,
    retentionDays: app.config.intake.retentionDays,
    eurRates: {
      get: () => app.eurRates.describe(),
      save: (rates, opts) => app.eurRates.save(rates, opts),
      refresh: () => app.eurRates.refresh(),
    },
    now: () => systemClock.now(),
  });
}
