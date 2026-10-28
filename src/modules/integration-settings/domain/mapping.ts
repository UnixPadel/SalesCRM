/**
 * Alan eşlemesi: platform form alanı → lead alanı. Saf kod; hangi platform olduğu yalnız `provider`
 * metnidir. Form bazlı satır (formId dolu) sağlayıcı varsayılanını (formId null) ezer.
 */
export const MAPPING_TARGETS = [
  "full_name",
  "first_name",
  "last_name",
  "email",
  "phone",
  "country",
  "city",
  "company",
  "product_interest",
  "notes",
  "extra",
  "ignore",
] as const;
export type MappingTarget = (typeof MAPPING_TARGETS)[number];
export const isMappingTarget = (v: unknown): v is MappingTarget =>
  typeof v === "string" && (MAPPING_TARGETS as readonly string[]).includes(v);

export interface FieldMapping {
  id: string;
  provider: string;
  formId: string | null;
  platformField: string;
  target: MappingTarget;
  isActive: boolean;
}

/** Çözümlenmiş eşleme: platform alanı → hedef. Alan adı karşılaştırması büyük/küçük harf duyarsız. */
export type ResolvedMapping = ReadonlyMap<string, MappingTarget>;

export function resolveMappings(all: readonly FieldMapping[], formId: string | null): ResolvedMapping {
  const out = new Map<string, MappingTarget>();
  const put = (m: FieldMapping) => out.set(m.platformField.toLowerCase(), m.target);
  for (const m of all) if (m.isActive && m.formId === null) put(m);
  if (formId) for (const m of all) if (m.isActive && m.formId === formId) put(m);
  return out;
}

export interface RawField {
  /** Platformun alan anahtarı (ör. form alanı adı ya da sütun kimliği). */
  key: string;
  /** İnsan okur etiket; ek yanıtta anahtar olarak tercih edilir. */
  label?: string | undefined;
  value: unknown;
}

export interface MappedFields {
  fullName: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  country: string;
  city: string;
  company: string;
  productInterest: string;
  notes: string;
  /** Hedefi `extra` olan ya da (politika "extra" ise) eşlenmeyen alanlar. */
  extra: Record<string, unknown>;
  /** Eşlemesi olmayan alan anahtarları (log ve admin için). */
  unmapped: string[];
}

export type UnmappedPolicy = "extra" | "ignore";

const text = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.map(text).filter(Boolean).join(", ");
  return String(v).trim();
};

/**
 * Eşlemeyi uygular. Aynı hedefe birden çok alan düşerse ilk dolu değer kazanır (ör. email, work_email).
 * `extra` içinde anahtar olarak etiket (varsa) kullanılır; çakışırsa alan anahtarı.
 */
export function applyMappings(
  fields: readonly RawField[],
  mapping: ResolvedMapping,
  policy: UnmappedPolicy,
): MappedFields {
  const out: MappedFields = {
    fullName: "",
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    country: "",
    city: "",
    company: "",
    productInterest: "",
    notes: "",
    extra: {},
    unmapped: [],
  };
  const setFirst = (k: keyof Omit<MappedFields, "extra" | "unmapped">, v: string) => {
    if (!out[k] && v) out[k] = v;
  };
  const putExtra = (f: RawField) => {
    const key = f.label && !(f.label in out.extra) ? f.label : f.key;
    out.extra[key] = Array.isArray(f.value) ? f.value : text(f.value);
  };
  for (const f of fields) {
    const target = mapping.get(f.key.toLowerCase());
    const v = text(f.value);
    switch (target) {
      case "full_name":
        setFirst("fullName", v);
        break;
      case "first_name":
        setFirst("firstName", v);
        break;
      case "last_name":
        setFirst("lastName", v);
        break;
      case "email":
        setFirst("email", v);
        break;
      case "phone":
        setFirst("phone", v);
        break;
      case "country":
        setFirst("country", v);
        break;
      case "city":
        setFirst("city", v);
        break;
      case "company":
        setFirst("company", v);
        break;
      case "product_interest":
        setFirst("productInterest", v);
        break;
      case "notes":
        out.notes = out.notes ? `${out.notes}\n${v}` : v;
        break;
      case "extra":
        putExtra(f);
        break;
      case "ignore":
        break;
      default:
        out.unmapped.push(f.key);
        if (policy === "extra") putExtra(f);
    }
  }
  if (!out.fullName) out.fullName = [out.firstName, out.lastName].filter(Boolean).join(" ");
  return out;
}
