// Genel plan, Mimari: "sales-pipeline çekirdeğinde 'Meta' veya 'Google' kelimesi geçmez."
// Platformlar yalnız lead-intake ve ad-feedback adaptörlerinde bilinir.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "modules");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(name) && !name.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

/** `gclid`/`fbclid` sütun adları sektör standardı parametre adlarıdır, platform adı değil (Faz 2). */
const FORBIDDEN = /\b(meta|facebook|graph api|google|leadgen|capi|data manager)\b/i;

/** Yorumlar ve `import.meta` kural dışı: kural kodun platforma bağlanmasını yasaklar, açıklamayı değil. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/import\.meta/g, "import_meta");
}

describe("platform-agnostic core (sales-pipeline, integration-settings/domain, shared)", () => {
  const dirs = ["sales-pipeline", join("integration-settings", "domain"), "shared"];

  for (const dir of dirs) {
    it(`${dir} does not mention an ad platform`, () => {
      const offenders: string[] = [];
      for (const file of sourceFiles(join(ROOT, dir))) {
        const lines = stripComments(readFileSync(file, "utf8")).split("\n");
        lines.forEach((line, i) => {
          if (FORBIDDEN.test(line)) offenders.push(`${relative(ROOT, file)}:${i + 1}: ${line.trim()}`);
        });
      }
      expect(offenders, "platform adı çekirdekte geçemez; adaptöre taşıyın").toEqual([]);
    });
  }
});
