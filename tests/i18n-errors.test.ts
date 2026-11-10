// Hata kodu çevirileri (Faz 7g, iş emri §5.10 [M-M16]): `src/modules` içindeki her `new RuleError("…")` kodu için
// arayüz sözlüğünde `err.<kod>` anahtarı olmalı; yoksa kullanıcı sunucunun Türkçe metnini görür (EN arayüzde de).
// Sözlük birden çok dosyaya yayılabilir (src/i18n/*.ts, *.tsx); anahtarlar metin olarak okunur, React yüklenmez.
// Şablonla kurulan kodlar (`lead.${snake(key)}_invalid` gibi) TEMPLATE_CODES'ta alan listesinden açılır; listede
// olmayan yeni bir şablon testi kırar (açılımını buraya ekleyin).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LEAD_TEXT_FIELDS, ORGANIZATION_TEXT_FIELDS } from "../src/modules/sales-pipeline/domain";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

function files(dir: string, keep: (name: string) => boolean): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...files(full, keep));
    else if (keep(name)) out.push(full);
  }
  return out;
}

const isSource = (name: string) => name.endsWith(".ts") && !name.endsWith(".test.ts") && name !== "fakes.ts";

/** opportunity.ts `snake` ile aynı: camelCase → snake_case. */
const snake = (s: string) => s.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase());

/** Kaynaktaki şablon metni → ürettiği kodlar. */
const TEMPLATE_CODES: Readonly<Record<string, readonly string[]>> = {
  "lead.${snake(key)}_invalid": LEAD_TEXT_FIELDS.map((k) => `lead.${snake(k)}_invalid`),
  "lead.${snake(key)}_too_long": LEAD_TEXT_FIELDS.map((k) => `lead.${snake(k)}_too_long`),
  "organization.${key}_invalid": ORGANIZATION_TEXT_FIELDS.map((k) => `organization.${k}_invalid`),
  "organization.${key}_too_long": ORGANIZATION_TEXT_FIELDS.map((k) => `organization.${k}_too_long`),
};

function ruleErrorCodes(): { codes: Map<string, string[]>; unknownTemplates: string[] } {
  const codes = new Map<string, string[]>();
  const unknownTemplates: string[] = [];
  const add = (code: string, file: string) => codes.set(code, [...(codes.get(code) ?? []), relative(SRC, file)]);
  for (const file of files(join(SRC, "modules"), isSource)) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/new RuleError\(\s*(["'])([^"'`]+)\1/g)) add(m[2]!, file);
    for (const m of src.matchAll(/new RuleError\(\s*`([^`]+)`/g)) {
      const expanded = TEMPLATE_CODES[m[1]!];
      if (expanded) for (const code of expanded) add(code, file);
      else unknownTemplates.push(`${m[1]} (${relative(SRC, file)})`);
    }
  }
  return { codes, unknownTemplates };
}

function dictionaryKeys(): Set<string> {
  const keys = new Set<string>();
  for (const file of files(join(SRC, "i18n"), (n) => /\.tsx?$/.test(n) && !n.endsWith(".test.ts"))) {
    for (const m of readFileSync(file, "utf8").matchAll(/["'](err\.[A-Za-z0-9_.]+)["']\s*:/g)) keys.add(m[1]!);
  }
  return keys;
}

describe("RuleError kodlarının çevirisi", () => {
  it("kodlar bulunur (tarayıcı kırılmadı)", () => {
    const { codes } = ruleErrorCodes();
    expect(codes.size).toBeGreaterThan(30);
    expect(codes.has("lead.forbidden")).toBe(true);
    expect(codes.has("lead.company_too_long")).toBe(true);
    expect(codes.has("organization.website_invalid")).toBe(true);
    expect(dictionaryKeys().has("err.lead.forbidden")).toBe(true);
  });

  it("şablonla kurulan her kodun açılımı tanımlı", () => {
    expect(ruleErrorCodes().unknownTemplates, "TEMPLATE_CODES'a şablonun ürettiği kodları ekleyin").toEqual([]);
  });

  it("her kod için err.<kod> anahtarı var", () => {
    const keys = dictionaryKeys();
    const missing = [...ruleErrorCodes().codes]
      .filter(([code]) => !keys.has(`err.${code}`))
      .map(([code, where]) => `${code} (${[...new Set(where)].join(", ")})`)
      .sort();
    expect(missing, "src/i18n sözlüğüne TR/EN err.<kod> ekleyin").toEqual([]);
  });
});
