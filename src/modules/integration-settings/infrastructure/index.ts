import type { Queryable } from "../../shared/db";
import {
  isMappingTarget,
  type FieldMapping,
  type FieldMappingRepository,
  type Setting,
  type SettingsRepository,
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

export function pgFieldMappingRepository(q: Queryable): FieldMappingRepository {
  return {
    async forProvider(provider) {
      const rows = await q.query<MappingRow>(
        "SELECT id, provider, form_id, platform_field, target_field, is_active FROM form_field_mappings WHERE provider = $1 ORDER BY form_id NULLS FIRST, platform_field",
        [provider],
      );
      return rows.flatMap((r): FieldMapping[] =>
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
          : [],
      );
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
