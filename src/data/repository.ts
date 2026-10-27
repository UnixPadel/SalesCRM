// Storage-agnostic data access. The UI and services only depend on these interfaces.
// `createHttpRepository` talks to the Node server (server/index.mjs), which keeps one shared
// JSON store for the whole sales team. A Postgres version implements the same interfaces
// behind the same HTTP API (see db/schema.sql) — nothing else changes.
import type { Activity, Contact, Deal, DealStageChange, ID, Lead, Organization } from "../domain/types";

export interface Table<T extends { id: ID }> {
  list(): Promise<T[]>;
  get(id: ID): Promise<T | undefined>;
  insert(row: T): Promise<T>;
  insertMany(rows: T[]): Promise<void>;
  update(id: ID, patch: Partial<Omit<T, "id">>): Promise<T>;
  remove(id: ID): Promise<void>;
}

export interface CrmRepository {
  organizations: Table<Organization>;
  contacts: Table<Contact>;
  leads: Table<Lead>;
  deals: Table<Deal>;
  activities: Table<Activity>;
  stageChanges: Table<DealStageChange>;
  /** Groups writes that must succeed together (BEGIN/COMMIT on Postgres). */
  transaction<R>(fn: (repo: CrmRepository) => Promise<R>): Promise<R>;
  isEmpty(): Promise<boolean>;
  markSeeded(): Promise<void>;
  reset(): Promise<void>;
}

export const newId = (prefix: string) =>
  `${prefix}_${
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 16)
      : Math.random().toString(36).slice(2, 18)
  }`;
