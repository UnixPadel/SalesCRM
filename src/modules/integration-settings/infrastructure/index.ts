import type { Db, Queryable } from "../../shared/db";
import {
  isMappingTarget,
  type FieldMapping,
  type FieldMappingRepository,
  type Setting,
  type SettingsRepository,
  type StageMapping,
  type StageMappingRepository,
} from "../domain";

interface MappingRow extends Record<string, unknown> {
  id: string;
  provider: string;
  form_id: string | null;
  platform_field: string;
  target_field: string;
  is_active: boolean;
}

interface SettingRow extends Record<string, unknown> {
  provider: string;
  key: string;
  value: string;
  updated_at: Date | string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const toFieldMapping = (r: MappingRow): FieldMapping[] =>
  isMappingTarget(r.target_field)
    ? [
        {
          id: r.id,
          provider: r.provider,
          formId: r.form_id,
          platformField: r.platform_field,
          target: r.target_field,
          isActive: r.is_active,
        },
      ]
    : [];

export function pgFieldMappingRepository(q: Queryable): FieldMappingRepository {
  return {
    async forProvider(provider) {
      const rows = await q.query<MappingRow>(
        "SELECT id, provider, form_id, platform_field, target_field, is_active FROM form_field_mappings WHERE provider = $1 ORDER BY form_id NULLS FIRST, platform_field",
        [provider],
      );
      return rows.flatMap(toFieldMapping);
    },

    async save(provider, input, now) {
      if (input.id !== null && !UUID.test(input.id)) return "not_found";
      // Aynı sağlayıcı + form + alan başka satırda mı? (benzersiz indeks: provider, coalesce(form_id, ''), platform_field)
      const clash = await q.query<{ id: string }>(
        `SELECT id FROM form_field_mappings
          WHERE provider = $1 AND coalesce(form_id, '') = coalesce($2, '') AND platform_field = $3
            AND ($4::uuid IS NULL OR id <> $4::uuid)`,
        [provider, input.formId, input.platformField, input.id],
      );
      if (clash.length) return "duplicate";
      const rows = input.id
        ? await q.query<MappingRow>(
            `UPDATE form_field_mappings
                SET form_id = $3, platform_field = $4, target_field = $5, is_active = $6, updated_at = $7
              WHERE id = $1 AND provider = $2
              RETURNING id, provider, form_id, platform_field, target_field, is_active`,
            [input.id, provider, input.formId, input.platformField, input.target, input.isActive, now],
          )
        : await q.query<MappingRow>(
            `INSERT INTO form_field_mappings (id, provider, form_id, platform_field, target_field, is_active, updated_at)
             VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6)
             RETURNING id, provider, form_id, platform_field, target_field, is_active`,
            [provider, input.formId, input.platformField, input.target, input.isActive, now],
          );
      return rows.flatMap(toFieldMapping)[0] ?? "not_found";
    },

    async remove(provider, id) {
      if (!UUID.test(id)) return false;
      const rows = await q.query<{ id: string }>(
        "DELETE FROM form_field_mappings WHERE id = $1 AND provider = $2 RETURNING id",
        [id, provider],
      );
      return rows.length > 0;
    },
  };
}

interface StageMappingRow extends Record<string, unknown> {
  id: string;
  stage_code: string;
  provider: string;
  platform_event_name: string;
  enabled: boolean;
  is_optimization_target: boolean;
}

export function pgStageMappingRepository(db: Db): StageMappingRepository {
  return {
    async forProvider(provider) {
      const rows = await db.query<StageMappingRow>(
        "SELECT id, stage_code, provider, platform_event_name, enabled, is_optimization_target FROM platform_stage_mappings WHERE provider = $1 ORDER BY stage_code",
        [provider],
      );
      return rows.map((r): StageMapping => ({
        id: r.id,
        stageCode: r.stage_code,
        provider: r.provider,
        platformEventName: r.platform_event_name,
        enabled: r.enabled,
        isOptimizationTarget: r.is_optimization_target,
      }));
    },

    async saveAll(provider, rows) {
      await db.transaction(async (tx) => {
        for (const r of rows) {
          await tx.query(
            `INSERT INTO platform_stage_mappings (id, stage_code, provider, platform_event_name, enabled, is_optimization_target)
             VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)
             ON CONFLICT (stage_code, provider) DO UPDATE
               SET platform_event_name = EXCLUDED.platform_event_name, enabled = EXCLUDED.enabled,
                   is_optimization_target = EXCLUDED.is_optimization_target`,
            [r.stageCode, provider, r.platformEventName, r.enabled, r.isOptimizationTarget],
          );
        }
      });
    },
  };
}

const toSetting = (r: SettingRow): Setting => ({
  provider: r.provider,
  key: r.key,
  value: r.value,
  updatedAt: r.updated_at instanceof Date ? r.updated_at : new Date(r.updated_at),
});

export function pgSettingsRepository(q: Queryable): SettingsRepository {
  return {
    async get(provider, key) {
      const rows = await q.query<SettingRow>(
        "SELECT provider, key, value, updated_at FROM integration_settings WHERE provider = $1 AND key = $2",
        [provider, key],
      );
      return rows[0] && toSetting(rows[0]);
    },
    async list(provider) {
      return (
        await q.query<SettingRow>(
          "SELECT provider, key, value, updated_at FROM integration_settings WHERE provider = $1 ORDER BY key",
          [provider],
        )
      ).map(toSetting);
    },
    async set(provider, key, value, now) {
      await q.query(
        `INSERT INTO integration_settings (provider, key, value, updated_at) VALUES ($1, $2, $3, $4)
         ON CONFLICT (provider, key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
        [provider, key, value, now],
      );
    },
  };
}
