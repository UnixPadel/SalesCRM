// sales-pipeline/infrastructure: Postgres repository'leri, transaction, outbox yazıcı, referans veri okuma.
export { PgUnitOfWork, repositoriesFor } from "./unitOfWork";
export { pgLeadRepository, pgOutboxWriter, pgPersonRepository, pgStageEventRepository } from "./repositories";
export { readStageDefinitions, readLostReasons, type StageDefinition, type LostReason } from "./referenceData";
