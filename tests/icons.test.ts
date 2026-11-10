// İkon anahtarları (Faz 7g, iş emri §3.2 [K-M2]): anlam renk tek başına değil ikon + metinle verilir. Domain ve
// arayüz tablolarındaki her ikon anahtarı `src/components/ui.tsx` PATHS'te tanımlı olmalı; yoksa `Icon` sessizce
// belge ikonuna düşer. Dosyalar metin olarak okunur, React yüklenmez.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CUSTOMER_STATUS_STYLE } from "../src/modules/sales-pipeline/domain";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

/** `const NAME… = { … };` bloğunun metni. */
function block(file: string, name: string): string {
  const src = readFileSync(join(SRC, file), "utf8");
  const start = src.indexOf(`const ${name}`);
  expect(start, `${file}: ${name} bulunamadı`).toBeGreaterThanOrEqual(0);
  return src.slice(start, src.indexOf("\n};", start));
}

const iconNames = (): Set<string> =>
  new Set([...block("components/ui.tsx", "PATHS").matchAll(/^\s+([A-Za-z0-9]+):/gm)].map((m) => m[1]!));

describe("ikon anahtarları tanımlı", () => {
  it("PATHS okunur", () => {
    const names = iconNames();
    expect(names.size).toBeGreaterThan(30);
    expect(names.has("file")).toBe(true);
  });

  it("müşteri durumu ikonları (CUSTOMER_STATUS_STYLE)", () => {
    const names = iconNames();
    const missing = Object.entries(CUSTOMER_STATUS_STYLE)
      .filter(([, s]) => !names.has(s.icon))
      .map(([code, s]) => `${code}: ${s.icon}`);
    expect(missing, "src/components/ui.tsx PATHS'e ekleyin").toEqual([]);
  });

  it("aktivite türü ikonları (activityBits.tsx ACTIVITY_ICON)", () => {
    const names = iconNames();
    const used = [...block("pipeline/activityBits.tsx", "ACTIVITY_ICON").matchAll(/:\s*"([A-Za-z0-9]+)"/g)].map(
      (m) => m[1]!,
    );
    expect(used.length).toBeGreaterThanOrEqual(7);
    expect(used.filter((n) => !names.has(n))).toEqual([]);
  });
});
