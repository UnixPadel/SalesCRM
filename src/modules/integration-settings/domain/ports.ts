import type { FieldMappingInput, StageMappingInput } from "./adminRules";
import type { FieldMapping } from "./mapping";
import type { StageMapping } from "./stageMapping";

export interface Setting {
  provider: string;
  key: string;
  value: string;
  updatedAt: Date;
}

export interface FieldMappingRepository {
  forProvider(provider: string): Promise<FieldMapping[]>;
  /**
   * Faz 7b: satırı yazar (kimlik varsa günceller, yoksa açar). Aynı sağlayıcı + form + alan başka satırda varsa
   * "duplicate"; güncellenecek satır yoksa "not_found".
   */
  save(provider: string, input: FieldMappingInput, now: Date): Promise<FieldMapping | "duplicate" | "not_found">;
  remove(provider: string, id: string): Promise<boolean>;
}

export interface StageMappingRepository {
  forProvider(provider: string): Promise<StageMapping[]>;
  /** Faz 7b: verilen aşamaların satırlarını yazar (yoksa açar); verilmeyen aşamaya dokunmaz. Tek transaction. */
  saveAll(provider: string, rows: readonly StageMappingInput[]): Promise<void>;
}

export interface SettingsRepository {
  get(provider: string, key: string): Promise<Setting | undefined>;
  list(provider: string): Promise<Setting[]>;
  set(provider: string, key: string, value: string, now: Date): Promise<void>;
}
