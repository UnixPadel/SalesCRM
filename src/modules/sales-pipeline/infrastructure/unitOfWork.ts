import type { Db, Queryable } from "../../shared/db";
import type { IdGenerator } from "../../shared/kernel";
import type { Repositories, UnitOfWork } from "../domain";
import {
  pgLeadRepository,
  pgLostReasonSource,
  pgOutboxWriter,
  pgPersonRepository,
  pgStageEventRepository,
  pgTerritoryRuleSource,
} from "./repositories";

export function repositoriesFor(q: Queryable, ids: IdGenerator): Repositories {
  return {
    leads: pgLeadRepository(q),
    persons: pgPersonRepository(q),
    stageEvents: pgStageEventRepository(q),
    outbox: pgOutboxWriter(q, ids),
    territories: pgTerritoryRuleSource(q),
    lostReasons: pgLostReasonSource(q),
  };
}

/** Postgres transaction'ı: fn içindeki her repository çağrısı aynı bağlantıda, BEGIN…COMMIT arasında. */
export class PgUnitOfWork implements UnitOfWork {
  constructor(
    private readonly db: Db,
    private readonly ids: IdGenerator,
  ) {}
  run<T>(fn: (repos: Repositories) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) => fn(repositoriesFor(tx, this.ids)));
  }
}
