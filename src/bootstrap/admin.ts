/**
 * Kompozisyon kökü, Faz 7: yönetim paneli router'ı (`/api/admin`). Gelen kutusu sağlığı lead-intake'ten, giden
 * kuyruk ad-feedback'ten, eşleme ve ayarlar integration-settings'ten gelir; hangi sağlayıcının hangi secret ve
 * ayarı kullandığı yalnız burada yazılır (modüller sağlayıcı adını veriden alır). Secret'ların değeri okunmaz:
 * yalnız "tanımlı mı" bilgisi.
 */
import type { Request, Router } from "express";
import { GOOGLE_DM_SECRET_NAMES } from "../modules/ad-feedback/adapters/google-data-manager";
import { META_CAPI_SECRET_NAMES } from "../modules/ad-feedback/adapters/meta-capi";
import { createAdminRouter, type ProviderInfo } from "../modules/integration-settings/api";
import { GOOGLE_SECRET_NAMES } from "../modules/lead-intake/adapters/google";
import { META_SECRET_NAMES } from "../modules/lead-intake/adapters/meta";
import { WEB_SECRET_NAMES } from "../modules/lead-intake/adapters/web-form";
import { STAGE_CODES } from "../modules/sales-pipeline/domain";
import { readSecret, systemClock, type Env } from "../modules/shared/kernel";
import type { AdFeedbackApp } from "./adFeedback";
import type { LeadIntakeApp } from "./leadIntake";
import type { SalesPipelineApp, SessionLike } from "./salesPipeline";

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
        secret(META_SECRET_NAMES.systemUserToken),
        secret(META_CAPI_SECRET_NAMES.token),
      ],
      settings: [
        { key: "dataset_id", kind: "text" },
        { key: "page_id", kind: "text" },
        { key: "active_form_ids", kind: "list" },
      ],
    },
    {
      provider: "google",
      inbound: leadIntake.providers.google,
      outbound: adFeedback.providers.google,
      listed: listed("google"),
      secrets: [secret(GOOGLE_SECRET_NAMES.webhookKey), secret(GOOGLE_DM_SECRET_NAMES.serviceAccountKey)],
      settings: [
        { key: "customer_id", kind: "text" },
        { key: "login_customer_id", kind: "text" },
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
    generalSecrets: () => [
      secret("INBOX_ENCRYPTION_KEY"),
      secret(app.config.smtp.userSecretName),
      secret(app.config.smtp.passwordSecretName),
    ],
    stageCodes: STAGE_CODES,
    retentionDays: app.config.intake.retentionDays,
    eurRates: { get: () => app.eurRates.describe(), save: (rates) => app.eurRates.save(rates) },
    now: () => systemClock.now(),
  });
}
