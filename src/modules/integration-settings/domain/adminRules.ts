/**
 * Yönetim ekranından girilen eşlemelerin kuralları (Faz 7b). Saf kod; sağlayıcı yalnız metindir.
 *  - Aşama eşlemesi: açık satırın olay adı boş olamaz; sağlayıcı başına en çok bir optimizasyon hedefi; aşama kodu
 *    bilinen kodlardan olmalı; aynı aşama iki kez gelemez.
 *  - Alan eşlemesi: alan adı dolu, hedef bilinen hedeflerden; form boşsa sağlayıcı varsayılanıdır.
 */
import { RuleError, err, ok, type Result } from "../../shared/kernel";
import { isMappingTarget, type MappingTarget } from "./mapping";

export interface StageMappingInput {
  stageCode: string;
  platformEventName: string;
  enabled: boolean;
  isOptimizationTarget: boolean;
}

const MAX_TEXT = 200;

export function validateStageMappings(
  rows: readonly unknown[],
  knownStages: readonly string[],
): Result<StageMappingInput[], RuleError> {
  const out: StageMappingInput[] = [];
  const seen = new Set<string>();
  for (const raw of rows) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const stageCode = String(r["stageCode"] ?? "").trim();
    if (!knownStages.includes(stageCode) || seen.has(stageCode)) {
      return err(new RuleError("mapping.stage_invalid", "Aşama kodu geçersiz ya da iki kez verilmiş.", { stageCode }));
    }
    seen.add(stageCode);
    const platformEventName = String(r["platformEventName"] ?? "").trim();
    const enabled = r["enabled"] === true;
    if (platformEventName.length > MAX_TEXT) {
      return err(new RuleError("mapping.event_name_too_long", "Olay adı en çok 200 karakter olabilir.", { stageCode }));
    }
    if (enabled && !platformEventName) {
      return err(new RuleError("mapping.event_name_required", "Açık satırın olay adı boş olamaz.", { stageCode }));
    }
    out.push({ stageCode, platformEventName, enabled, isOptimizationTarget: r["isOptimizationTarget"] === true });
  }
  if (out.filter((r) => r.isOptimizationTarget).length > 1) {
    return err(new RuleError("mapping.multiple_targets", "Sağlayıcı başına en çok bir optimizasyon hedefi seçilir."));
  }
  return ok(out);
}

export interface FieldMappingInput {
  /** Varsa o satır güncellenir; yoksa yeni satır açılır. */
  id: string | null;
  /** null: sağlayıcı varsayılanı (bütün formlar). */
  formId: string | null;
  platformField: string;
  target: MappingTarget;
  isActive: boolean;
}

export function validateFieldMapping(raw: unknown): Result<FieldMappingInput, RuleError> {
  const r = (raw ?? {}) as Record<string, unknown>;
  const platformField = String(r["platformField"] ?? "").trim();
  if (!platformField || platformField.length > MAX_TEXT) {
    return err(new RuleError("mapping.field_required", "Form alanı adı boş olamaz (en çok 200 karakter)."));
  }
  if (!isMappingTarget(r["target"])) {
    return err(new RuleError("mapping.target_invalid", "Hedef alan geçersiz.", { target: r["target"] }));
  }
  const form = String(r["formId"] ?? "").trim();
  if (form.length > MAX_TEXT) {
    return err(new RuleError("mapping.form_invalid", "Form kimliği en çok 200 karakter olabilir."));
  }
  const id = String(r["id"] ?? "").trim();
  return ok({
    id: id || null,
    formId: form && form !== "*" ? form : null,
    platformField,
    target: r["target"],
    isActive: r["isActive"] !== false,
  });
}
