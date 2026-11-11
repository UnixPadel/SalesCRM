/**
 * integration-settings/application: diğer modüllerin (lead-intake, Faz 6 ekranları) ayar ve eşleme
 * okuma yüzü. Faz 2'de eşlemeler seed ve SQL ile girilir; ekran Faz 6.
 */
import { NotFoundError, RuleError, err, ok, type Clock, type Result } from "../../shared/kernel";
import {
  applyMappings,
  resolveMappings,
  resolveStageMappings,
  validateFieldMapping,
  validateStageMappings,
  type FieldMapping,
  type FieldMappingRepository,
  type ResolvedMapping,
  type ResolvedStageMapping,
  type Setting,
  type SettingsRepository,
  type StageMapping,
  type StageMappingRepository,
} from "../domain";

/** Adaptörlerin, lead-intake'in ve ad-feedback'in ihtiyacı olan domain tipleri ve saf fonksiyonlar, bu kapıdan. */
export { applyMappings, resolveStageMappings };
export { MAPPING_TARGETS } from "../domain";
export type {
  FieldMapping,
  FieldMappingInput,
  Setting,
  StageMappingInput,
  MappedFields,
  MappingTarget,
  RawField,
  ResolvedMapping,
  ResolvedStageMapping,
  StageMapping,
  UnmappedPolicy,
} from "../domain";

/** Giden akış acil durdurma anahtarı (integration_settings `<provider>/outbound_enabled`). */
export const OUTBOUND_ENABLED_KEY = "outbound_enabled";

export interface IntegrationSettingsDeps {
  mappings: FieldMappingRepository;
  settings: SettingsRepository;
  clock: Clock;
  /** Faz 4: aşama → platform olayı. Verilmezse her sağlayıcı için boş harita döner. */
  stageMappings?: StageMappingRepository | undefined;
}

export class IntegrationSettings {
  constructor(private readonly deps: IntegrationSettingsDeps) {}

  /** Sağlayıcı + form için çözümlenmiş eşleme (form satırı varsayılanı ezer). */
  async mappingsFor(provider: string, formId: string | null): Promise<ResolvedMapping> {
    return resolveMappings(await this.deps.mappings.forProvider(provider), formId);
  }

  listMappings(provider: string): Promise<FieldMapping[]> {
    return this.deps.mappings.forProvider(provider);
  }

  /** Sağlayıcının aşama eşlemesi (aşama kodu → satır); satır yoksa o aşama gönderilmez. */
  async stageMappingsFor(provider: string): Promise<ResolvedStageMapping> {
    const rows = this.deps.stageMappings ? await this.deps.stageMappings.forProvider(provider) : [];
    return resolveStageMappings(rows);
  }

  /** Acil durdurma: anahtar yoksa akış kapalı sayılır (açıkça true yazılmalı). */
  outboundEnabled(provider: string): Promise<boolean> {
    return this.getBoolean(provider, OUTBOUND_ENABLED_KEY, false);
  }

  async get(provider: string, key: string): Promise<string | null> {
    return (await this.deps.settings.get(provider, key))?.value ?? null;
  }

  /** JSON değer; yoksa ya da bozuksa `fallback`. */
  async getJson<T>(provider: string, key: string, fallback: T): Promise<T> {
    const raw = await this.get(provider, key);
    if (raw === null || raw === "") return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }

  async getBoolean(provider: string, key: string, fallback: boolean): Promise<boolean> {
    const raw = await this.get(provider, key);
    return raw === null ? fallback : raw === "true" || raw === "1";
  }

  set(provider: string, key: string, value: string): Promise<void> {
    return this.deps.settings.set(provider, key, value, this.deps.clock.now());
  }

  setJson(provider: string, key: string, value: unknown): Promise<void> {
    return this.set(provider, key, JSON.stringify(value));
  }

  list(provider: string): Promise<Setting[]> {
    return this.deps.settings.list(provider);
  }

  /* ---- Faz 7b: yönetim ekranından yazma. Kaydedilen eşleme hemen geçerlidir (önbellek yok). ---- */

  async listStageMappings(provider: string): Promise<StageMapping[]> {
    return this.deps.stageMappings ? this.deps.stageMappings.forProvider(provider) : [];
  }

  /** Sağlayıcının aşama satırlarını doğrular ve yazar; verilmeyen aşamaya dokunmaz. */
  async saveStageMappings(
    provider: string,
    rows: readonly unknown[],
    knownStages: readonly string[],
  ): Promise<Result<StageMapping[], RuleError>> {
    const parsed = validateStageMappings(rows, knownStages);
    if (!parsed.ok) return parsed;
    if (!this.deps.stageMappings)
      return err(new RuleError("mapping.unavailable", "Aşama eşlemesi deposu bağlı değil."));
    // Hedef başka (bu istekte gelmeyen) bir satırdaysa ve yeni hedef seçildiyse eskisi düşer: tek hedef kuralı.
    const incoming = parsed.value;
    const chosen = incoming.find((r) => r.isOptimizationTarget);
    const others = (await this.deps.stageMappings.forProvider(provider)).filter(
      (m) => m.isOptimizationTarget && !incoming.some((r) => r.stageCode === m.stageCode),
    );
    const demoted = chosen
      ? others.map((m) => ({
          stageCode: m.stageCode,
          platformEventName: m.platformEventName,
          enabled: m.enabled,
          isOptimizationTarget: false,
        }))
      : [];
    await this.deps.stageMappings.saveAll(provider, [...incoming, ...demoted]);
    return ok(await this.deps.stageMappings.forProvider(provider));
  }

  async saveFieldMapping(provider: string, raw: unknown): Promise<Result<FieldMapping, RuleError>> {
    const parsed = validateFieldMapping(raw);
    if (!parsed.ok) return parsed;
    const saved = await this.deps.mappings.save(provider, parsed.value, this.deps.clock.now());
    if (saved === "duplicate") {
      return err(new RuleError("mapping.duplicate", "Bu form alanı için zaten bir eşleme var."));
    }
    if (saved === "not_found") return err(new NotFoundError("field_mapping", parsed.value.id ?? ""));
    return ok(saved);
  }

  async removeFieldMapping(provider: string, id: string): Promise<Result<true, RuleError>> {
    return (await this.deps.mappings.remove(provider, id)) ? ok(true) : err(new NotFoundError("field_mapping", id));
  }
}

/** Bellek içi uygulama: lead-intake ve adaptör testleri bunu kullanır. */
export class InMemoryIntegrationSettings {
  mappings: FieldMapping[] = [];
  stageMappings: StageMapping[] = [];
  settings = new Map<string, Setting>();

  constructor(
    mappings: FieldMapping[] = [],
    settings: Record<string, Record<string, string>> = {},
    stageMappings: StageMapping[] = [],
  ) {
    this.mappings = mappings;
    this.stageMappings = stageMappings;
    for (const [provider, kv] of Object.entries(settings))
      for (const [key, value] of Object.entries(kv))
        this.settings.set(`${provider}/${key}`, { provider, key, value, updatedAt: new Date(0) });
  }

  repos(): Pick<IntegrationSettingsDeps, "mappings" | "settings" | "stageMappings"> {
    const sameKey = (m: FieldMapping, p: string, formId: string | null, field: string) =>
      m.provider === p && (m.formId ?? "") === (formId ?? "") && m.platformField === field;
    return {
      mappings: {
        forProvider: async (p) => this.mappings.filter((m) => m.provider === p).map((m) => ({ ...m })),
        save: async (p, input) => {
          if (this.mappings.some((m) => m.id !== input.id && sameKey(m, p, input.formId, input.platformField)))
            return "duplicate";
          const fields = {
            formId: input.formId,
            platformField: input.platformField,
            target: input.target,
            isActive: input.isActive,
          };
          if (input.id) {
            const row = this.mappings.find((m) => m.id === input.id && m.provider === p);
            if (!row) return "not_found";
            Object.assign(row, fields);
            return { ...row };
          }
          const row: FieldMapping = { id: `fm-${this.mappings.length + 1}`, provider: p, ...fields };
          this.mappings.push(row);
          return { ...row };
        },
        remove: async (p, id) => {
          const i = this.mappings.findIndex((m) => m.id === id && m.provider === p);
          if (i < 0) return false;
          this.mappings.splice(i, 1);
          return true;
        },
      },
      stageMappings: {
        forProvider: async (p) => this.stageMappings.filter((m) => m.provider === p).map((m) => ({ ...m })),
        saveAll: async (p, rows) => {
          for (const r of rows) {
            const row = this.stageMappings.find((m) => m.provider === p && m.stageCode === r.stageCode);
            if (row) Object.assign(row, r);
            else this.stageMappings.push({ id: `${p}:${r.stageCode}`, provider: p, ...r });
          }
        },
      },
      settings: {
        get: async (p, k) => this.settings.get(`${p}/${k}`),
        list: async (p) => [...this.settings.values()].filter((s) => s.provider === p),
        set: async (p, k, value, now) => {
          this.settings.set(`${p}/${k}`, { provider: p, key: k, value, updatedAt: now });
        },
      },
    };
  }
}

/** Testlerde aşama eşlemesi satırı üretmek için. */
export const stageMappingRow = (
  provider: string,
  stageCode: string,
  platformEventName: string,
  over: Partial<Pick<StageMapping, "enabled" | "isOptimizationTarget">> = {},
): StageMapping => ({
  id: `${provider}:${stageCode}`,
  provider,
  stageCode,
  platformEventName,
  enabled: over.enabled ?? true,
  isOptimizationTarget: over.isOptimizationTarget ?? false,
});

/** Sağlayıcı varsayılanı; testlerde eşleme satırı üretmek için. */
export const mappingRow = (
  provider: string,
  platformField: string,
  target: FieldMapping["target"],
  formId: string | null = null,
): FieldMapping => ({
  id: `${provider}:${formId ?? "*"}:${platformField}`,
  provider,
  formId,
  platformField,
  target,
  isActive: true,
});
