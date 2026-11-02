import { queryOne, type Queryable } from "../../shared/db";
import type { Organization, OrganizationFields, OrganizationListFilter, OrganizationRepository } from "../domain";
import { organizationFromRow, type OrganizationRow } from "./rows";

const COLS = "id, name, type, country, website, notes, legacy_id, created_at, updated_at";

const FIELD_COLUMN: Record<keyof OrganizationFields, string> = {
  name: "name",
  type: "type",
  country: "country",
  website: "website",
  notes: "notes",
};

export function pgOrganizationRepository(q: Queryable): OrganizationRepository {
  return {
    async findById(id) {
      const r = await queryOne<OrganizationRow>(q, `SELECT ${COLS} FROM organizations WHERE id = $1`, [id]);
      return r && organizationFromRow(r);
    },
    async findByIds(ids) {
      if (!ids.length) return [];
      return (
        await q.query<OrganizationRow>(`SELECT ${COLS} FROM organizations WHERE id = ANY($1::uuid[]) ORDER BY name`, [
          [...ids],
        ])
      ).map(organizationFromRow);
    },
    async findByLegacyId(legacyId) {
      const r = await queryOne<OrganizationRow>(q, `SELECT ${COLS} FROM organizations WHERE legacy_id = $1`, [
        legacyId,
      ]);
      return r && organizationFromRow(r);
    },
    async findByName(name, country) {
      const r = await queryOne<OrganizationRow>(
        q,
        `SELECT ${COLS} FROM organizations WHERE lower(name) = lower($1) AND coalesce(country, '') = coalesce($2, '')`,
        [name.trim(), country ? country.toUpperCase() : null],
      );
      return r && organizationFromRow(r);
    },
    async list(f: OrganizationListFilter) {
      const where: string[] = [];
      const params: unknown[] = [];
      const p = (v: unknown) => {
        params.push(v);
        return `$${params.length}`;
      };
      if (f.search) {
        const like = p(`%${f.search.toLowerCase()}%`);
        where.push(
          `(lower(name) LIKE ${like} OR lower(website) LIKE ${like} OR lower(coalesce(country, '')) LIKE ${like})`,
        );
      }
      if (f.country) where.push(`country = ${p(f.country.toUpperCase())}`);
      if (f.type) where.push(`type = ${p(f.type)}`);
      const sql = `SELECT ${COLS} FROM organizations ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY name, id ${
        f.limit ? `LIMIT ${p(f.limit)}` : ""
      }`;
      return (await q.query<OrganizationRow>(sql, params)).map(organizationFromRow);
    },
    async insert(o: Organization) {
      await q.query(`INSERT INTO organizations (${COLS}) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [
        o.id,
        o.name,
        o.type,
        o.country,
        o.website,
        o.notes,
        o.legacyId,
        o.createdAt,
        o.updatedAt,
      ]);
    },
    async update(id, fields, updatedAt) {
      const sets: string[] = [];
      const params: unknown[] = [id, updatedAt];
      for (const key of Object.keys(FIELD_COLUMN) as (keyof OrganizationFields)[]) {
        if (!(key in fields)) continue;
        params.push(fields[key] ?? null);
        sets.push(`${FIELD_COLUMN[key]} = $${params.length}`);
      }
      if (!sets.length) return;
      await q.query(`UPDATE organizations SET ${sets.join(", ")}, updated_at = $2 WHERE id = $1`, params);
    },
  };
}
