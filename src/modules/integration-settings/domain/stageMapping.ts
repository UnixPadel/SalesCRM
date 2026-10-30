/**
 * Aşama → platform olayı eşlemesi (platform_stage_mappings). Saf kod; sağlayıcı yalnız metindir.
 * `enabled = false` satır: dağıtıcı o aşamanın olayını `skipped (mapping_disabled)` yapar.
 */
export interface StageMapping {
  id: string;
  stageCode: string;
  provider: string;
  /** Meta olay adı ya da Google dönüşüm işlemi kimliği. */
  platformEventName: string;
  enabled: boolean;
  isOptimizationTarget: boolean;
}

/** Sağlayıcı satırları → aşama kodu anahtarlı harita. */
export type ResolvedStageMapping = ReadonlyMap<string, StageMapping>;

export function resolveStageMappings(rows: readonly StageMapping[]): ResolvedStageMapping {
  const out = new Map<string, StageMapping>();
  for (const r of rows) out.set(r.stageCode, r);
  return out;
}
