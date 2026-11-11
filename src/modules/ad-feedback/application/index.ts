// ad-feedback/application: giden olay dağıtıcısı, dead-letter raporu, portlar. Platform adaptörleri PlatformSender uygular.
export * from "./dto";
export * from "./ports";
export { DispatchOutbox, consentAllows, skipReasonFor, type DispatchOutboxDeps } from "./dispatcher";
export { DeadLetterReport, renderDeadLetterReport, type DeadLetterReportDeps } from "./deadLetterReport";
export { BackfillOutbox, type BackfillOutboxInput, type BackfillOutboxResult } from "./backfill";
export { OutboxHealth, REQUEUEABLE, isRequeueable, type OutboxHealthDeps } from "./health";

import { DeadLetterReport } from "./deadLetterReport";
import { DispatchOutbox, type DispatchOutboxDeps } from "./dispatcher";
import { OutboxHealth } from "./health";
import type { ReportMailer } from "./ports";

export interface AdFeedbackDeps extends DispatchOutboxDeps {
  mailer: ReportMailer;
  reportRecipients: readonly string[];
  publicBaseUrl?: string;
}

export interface AdFeedback {
  dispatch: DispatchOutbox;
  report: DeadLetterReport;
  /** Faz 7a/7c: yönetim paneli sorguları ve yeniden kuyruğa alma. */
  health: OutboxHealth;
}

export function createAdFeedback(deps: AdFeedbackDeps): AdFeedback {
  return {
    dispatch: new DispatchOutbox(deps),
    report: new DeadLetterReport({
      outbox: deps.outbox,
      mailer: deps.mailer,
      recipients: deps.reportRecipients,
      clock: deps.clock,
      logger: deps.logger,
      ...(deps.publicBaseUrl ? { publicBaseUrl: deps.publicBaseUrl } : {}),
    }),
    health: new OutboxHealth({
      outbox: deps.outbox,
      context: deps.context,
      senders: deps.senders,
      clock: deps.clock,
      logger: deps.logger,
    }),
  };
}
