/**
 * integration-settings/application: diğer modüllerin (lead-intake, Faz 6 ekranları) ayar ve eşleme
 * okuma yüzü. Faz 2'de eşlemeler seed ve SQL ile girilir; ekran Faz 6.
 */
import type { Clock } from "../../shared/kernel";
import {
  applyMappings,
  resolveMappings,
  resolveStageMappings,
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
export type {
  FieldMapping,
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
    return {
      mappings: { forProvider: async (p) => this.mappings.filter((m) => m.provider === p).map((m) => ({ ...m })) },
      stageMappings: {
        forProvider: async (p) => this.stageMappings.filter((m) => m.provider === p).map((m) => ({ ...m })),
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
