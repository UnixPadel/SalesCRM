/**
 * "Kaynak detayı" görünümü (Faz 7g, iş emri §5.2): `extra_answers` nesneleri bir düzey anahtar/değer olarak işlenir
 * ("[object Object]" hatası), bilinen anahtarlar etiketlenir, köken bilgisi (uyarı panelinde görünür) gizlenir. Saf.
 */
export const HIDDEN_EXTRA_KEYS = [
  "country_source",
  "country_raw",
  "dial_code_assumed",
  "phone_raw",
  "unmatched_answers",
  "import_issues",
  "dropped_fields",
] as const;

/** Bilinen anahtar → çeviri anahtarı. */
export const EXTRA_LABELS: Record<string, string> = {
  mysql: "extra.mysql",
  excel_no: "extra.excel_no",
  excel_owner: "extra.excel_owner",
  excel_warning: "extra.excel_warning",
  platform_lead_id: "extra.platform_lead_id",
};

function valueText(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map(valueText).join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export interface ExtraRow {
  key: string;
  /** Çeviri anahtarı ya da ham anahtar. */
  label: string;
  labelKey: boolean;
  value: string;
}

/** Satırlar: düz değerler olduğu gibi; nesneler "üst · alt" anahtarlarına açılır (yalnız bir düzey). */
export function extraAnswerRows(extra: Record<string, unknown>): ExtraRow[] {
  const out: ExtraRow[] = [];
  for (const [k, v] of Object.entries(extra ?? {})) {
    if ((HIDDEN_EXTRA_KEYS as readonly string[]).includes(k)) continue;
    const known = EXTRA_LABELS[k];
    if (v && typeof v === "object" && !Array.isArray(v)) {
      for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) {
        out.push({ key: `${k}.${k2}`, label: `${known ? k : k} · ${k2}`, labelKey: false, value: valueText(v2) });
      }
      continue;
    }
    out.push({ key: k, label: known ?? k, labelKey: !!known, value: valueText(v) });
  }
  return out;
}
