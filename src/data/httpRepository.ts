import type { ID } from "../domain/types";
import { api, ApiError } from "./api";
import type { CrmRepository, Table } from "./repository";

const TABLES = ["organizations", "contacts", "leads", "deals", "activities", "stageChanges"] as const;

/** One REST resource per table; the server keeps the rows in a shared JSON store. */
function httpTable<T extends { id: ID }>(name: string): Table<T> {
  const base = `/api/db/${name}`;
  return {
    list: () => api<T[]>("GET", base),
    async get(id) {
      try {
        return await api<T>("GET", `${base}/${encodeURIComponent(id)}`);
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return undefined;
        throw e;
      }
    },
    insert: (row) => api<T>("POST", base, row),
    insertMany: (rows) => api<void>("POST", base, rows),
    update: (id, patch) => api<T>("PATCH", `${base}/${encodeURIComponent(id)}`, patch),
    remove: (id) => api<void>("DELETE", `${base}/${encodeURIComponent(id)}`),
  };
}

export function createHttpRepository(): CrmRepository {
  const t = Object.fromEntries(TABLES.map((n) => [n, httpTable(n)])) as unknown as {
    [K in (typeof TABLES)[number]]: Table<any>;
  };
  const repo: CrmRepository = {
    organizations: t.organizations,
    contacts: t.contacts,
    leads: t.leads,
    deals: t.deals,
    activities: t.activities,
    stageChanges: t.stageChanges,
    // Single Node process, writes applied in order: running the callback is atomic enough.
    transaction: (fn) => fn(repo),
    async isEmpty() {
      return !(await api<{ seeded: boolean }>("GET", "/api/db-meta")).seeded;
    },
    markSeeded: () => api<void>("POST", "/api/db-meta/seeded"),
    reset: () => api<void>("POST", "/api/db-meta/reset"),
  };
  return repo;
}
