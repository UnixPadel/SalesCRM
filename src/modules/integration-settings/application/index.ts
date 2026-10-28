/**
 * integration-settings/application: diğer modüllerin (lead-intake, Faz 6 ekranları) ayar ve eşleme
 * okuma yüzü. Faz 2'de eşlemeler seed ve SQL ile girilir; ekran Faz 6.
 */
import type { Clock } from "../../shared/kernel";
import {
  resolveMappings,
  type FieldMapping,
  type FieldMappingRepository,
  type ResolvedMapping,
  type Setting,
  type SettingsRepository,
} from "../domain";

export interface IntegrationSettingsDeps {
  mappings: FieldMappingRepository;
  settings: SettingsRepository;
  clock: Clock;
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
  settings = new Map<string, Setting>();

  constructor(mappings: FieldMapping[] = [], settings: Record<string, Record<string, string>> = {}) {
    this.mappings = mappings;
    for (const [provider, kv] of Object.entries(settings))
      for (const [key, value] of Object.entries(kv))
        this.settings.set(`${provider}/${key}`, { provider, key, value, updatedAt: new Date(0) });
  }

  repos(): Pick<IntegrationSettingsDeps, "mappings" | "settings"> {
    return {
      mappings: { forProvider: async (p) => this.mappings.filter((m) => m.provider === p).map((m) => ({ ...m })) },
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
