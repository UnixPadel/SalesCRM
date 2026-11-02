import { RuleError, err, ok, type Result } from "../../shared/kernel";

/**
 * Kuruluş (satış panosu, Faz 6d; ADR-0013 madde 4): kulüp, yatırımcı, distribütör, yüklenici ya da diğer.
 * Kişiler ve lead'ler kuruluşa bağlanır. Saf kurallar: alan doğrulama.
 */
export const ORGANIZATION_TYPES = ["club", "investor", "distributor", "contractor", "other"] as const;
export type OrganizationType = (typeof ORGANIZATION_TYPES)[number];
export const isOrganizationType = (v: unknown): v is OrganizationType =>
  typeof v === "string" && (ORGANIZATION_TYPES as readonly string[]).includes(v);

export interface Organization {
  id: string;
  name: string;
  type: OrganizationType;
  /** ISO 3166-1 alpha-2 ya da null. */
  country: string | null;
  website: string;
  notes: string;
  /** Eski panodaki kimlik; yalnız taşıma betiği doldurur. */
  legacyId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrganizationFields {
  name: string;
  type: OrganizationType;
  country: string | null;
  website: string;
  notes: string;
}

export const ORGANIZATION_LIMITS = { name: 200, website: 200, notes: 4000 } as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

/**
 * Ham girdi → doğrulanmış kısmi alan seti. `requireName` (oluşturma) adın verilmesini zorunlu kılar; güncellemede
 * yalnız verilen anahtarlar döner. Ülke iki harfe büyütülür; boş metin null olur.
 */
export function parseOrganizationFields(
  raw: Record<string, unknown>,
  opts: { requireName?: boolean } = {},
): Result<Partial<OrganizationFields>, RuleError> {
  const out: Partial<OrganizationFields> = {};
  if ("name" in raw || opts.requireName) {
    const v = raw["name"];
    const name = typeof v === "string" ? v.trim() : "";
    if (v !== undefined && v !== null && typeof v !== "string") {
      return err(new RuleError("organization.name_invalid", "Kuruluş adı metin olmalı.", {}));
    }
    if (!name) return err(new RuleError("organization.name_required", "Kuruluş adı zorunlu.", {}));
    if (name.length > ORGANIZATION_LIMITS.name) {
      return err(
        new RuleError("organization.name_too_long", `Kuruluş adı en fazla ${ORGANIZATION_LIMITS.name} karakter.`, {}),
      );
    }
    out.name = name;
  }
  if ("type" in raw) {
    const v = raw["type"];
    if (!isOrganizationType(v)) {
      return err(new RuleError("organization.type_unknown", "Bilinmeyen kuruluş türü.", { type: v }));
    }
    out.type = v;
  }
  if ("country" in raw) {
    const v = raw["country"];
    if (v === null || v === undefined || v === "") out.country = null;
    else if (typeof v !== "string" || !/^[A-Za-z]{2}$/.test(v.trim())) {
      return err(new RuleError("organization.country_invalid", "Ülke iki harfli ISO kodu olmalı.", { value: v }));
    } else out.country = v.trim().toUpperCase();
  }
  for (const [key, max] of [
    ["website", ORGANIZATION_LIMITS.website],
    ["notes", ORGANIZATION_LIMITS.notes],
  ] as const) {
    if (!(key in raw)) continue;
    const v = raw[key];
    if (v !== null && v !== undefined && typeof v !== "string") {
      return err(new RuleError(`organization.${key}_invalid`, "Metin olmalı.", { field: key }));
    }
    const s = (v ?? "").toString().trim();
    if (s.length > max) {
      return err(new RuleError(`organization.${key}_too_long`, `En fazla ${max} karakter.`, { field: key, max }));
    }
    out[key] = s;
  }
  return ok(out);
}
