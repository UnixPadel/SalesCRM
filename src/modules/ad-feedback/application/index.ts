// ad-feedback/application: giden olay dağıtıcısı, dead-letter raporu, portlar. Platform adaptörleri PlatformSender uygular.
export * from "./dto";
export * from "./ports";
export { DispatchOutbox, consentAllows, skipReasonFor, type DispatchOutboxDeps } from "./dispatcher";
export { DeadLetterReport, renderDeadLetterReport, type DeadLetterReportDeps } from "./deadLetterReport";

import { DeadLetterReport } from "./deadLetterReport";
import { DispatchOutbox, type DispatchOutboxDeps } from "./dispatcher";
import type { ReportMailer } from "./ports";

export interface AdFeedbackDeps extends DispatchOutboxDeps {
  mailer: ReportMailer;
  reportRecipients: readonly string[];
  publicBaseUrl?: string;
}

export interface AdFeedback {
  dispatch: DispatchOutbox;
  report: DeadLetterReport;
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
  };
}
