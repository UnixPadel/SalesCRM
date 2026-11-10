// sales-pipeline/infrastructure: Postgres repository'leri, transaction, outbox yazıcı, referans veri okuma.
export { PgUnitOfWork, repositoriesFor } from "./unitOfWork";
export { pgLeadRepository, pgOutboxWriter, pgPersonRepository, pgStageEventRepository } from "./repositories";
export { pgActivityRepository } from "./activityRepository";
export { pgContactLogRepository } from "./contactLogRepository";
export { pgOrganizationRepository } from "./organizationRepository";
export { readStageDefinitions, readLostReasons, type StageDefinition, type LostReason } from "./referenceData";
export { pgNotificationStore } from "./notifications";
export { createSmtpEmailSender, loggingEmailSender } from "./smtpEmailSender";
