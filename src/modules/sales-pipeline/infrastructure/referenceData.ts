import type { Queryable } from "../../shared/db";

/** Arayüzün görünen adları: aşama sözlüğü ve kayıp nedenleri (TR/EN). Kodlar sabit, adlar tablodan. */
export interface StageDefinition {
  code: string;
  nameTr: string;
  nameEn: string;
  sortOrder: number;
  isTerminal: boolean;
  requiresValue: boolean;
  requiresReason: boolean;
}

export interface LostReason {
  code: string;
  nameTr: string;
  nameEn: string;
}

export async function readStageDefinitions(q: Queryable): Promise<StageDefinition[]> {
  const rows = await q.query<{
    code: string;
    name_tr: string;
    name_en: string;
    sort_order: number;
    is_terminal: boolean;
    requires_value: boolean;
    requires_reason: boolean;
  }>(
    "SELECT code, name_tr, name_en, sort_order, is_terminal, requires_value, requires_reason FROM stage_definitions ORDER BY sort_order",
  );
  return rows.map((r) => ({
    code: r.code,
    nameTr: r.name_tr,
    nameEn: r.name_en,
    sortOrder: Number(r.sort_order),
    isTerminal: r.is_terminal,
    requiresValue: r.requires_value,
    requiresReason: r.requires_reason,
  }));
}

export async function readLostReasons(q: Queryable): Promise<LostReason[]> {
  const rows = await q.query<{ code: string; name_tr: string; name_en: string }>(
    "SELECT code, name_tr, name_en FROM lost_reasons WHERE is_active ORDER BY sort_order",
  );
  return rows.map((r) => ({ code: r.code, nameTr: r.name_tr, nameEn: r.name_en }));
}
