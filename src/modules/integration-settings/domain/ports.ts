import type { FieldMapping } from "./mapping";

export interface Setting {
  provider: string;
  key: string;
  value: string;
  updatedAt: Date;
}

export interface FieldMappingRepository {
  forProvider(provider: string): Promise<FieldMapping[]>;
}

export interface SettingsRepository {
  get(provider: string, key: string): Promise<Setting | undefined>;
  list(provider: string): Promise<Setting[]>;
  set(provider: string, key: string, value: string, now: Date): Promise<void>;
}
