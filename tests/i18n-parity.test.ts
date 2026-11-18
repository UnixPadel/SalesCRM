// Üç dilin sözlük uyumu: Arapçada eksik ya da fazla anahtar olmamalı, her anahtarın yer tutucuları ({n}, {name}…)
// üç dilde aynı olmalı ve ICU çoğul blokları her sayı için çözülmeli. Çevirmen yer tutucuyu silerse ya da
// adını çevirirse bu test kırılır.
import { describe, expect, it } from "vitest";
import { DICT, translate } from "../src/i18n/dict";
import { LANGS, type Lang } from "../src/i18n/lang";
import { AR, AR_REF } from "../src/i18n/ar";

const entries = Object.entries(DICT) as [string, readonly [string, string]][];
const text = (key: string, lang: Lang): string =>
  lang === "ar" ? (AR as Record<string, string>)[key]! : DICT[key as keyof typeof DICT][lang === "tr" ? 0 : 1];

/** Metindeki değişken adları: çoğul bloğunun değişkeni (`{n, plural, …}`) ve blok dışındaki düz `{ad}`'lar. */
function placeholders(s: string): string[] {
  const names = new Set<string>();
  for (const m of s.matchAll(/\{(\w+), plural,/g)) names.add(m[1]!);
  // Çoğul bloklarının gövdesi (`one {has} other {have}`) değişken değildir; önce bloklar çıkarılır.
  const flat = s.replace(/\{\w+, plural,(?:\s*(?:=\d+|\w+) \{(?:[^{}]|\{\w+\})*\})+\s*\}/g, "");
  for (const m of flat.matchAll(/\{(\w+)\}/g)) names.add(m[1]!);
  return [...names].sort();
}

describe("sözlük uyumu (TR / EN / AR)", () => {
  it("Arapça sözlükte eksik ya da fazla anahtar yok", () => {
    expect(Object.keys(AR).sort()).toEqual(entries.map(([k]) => k).sort());
  });

  it("hiçbir metin boş değil", () => {
    const empty = entries.flatMap(([k]) => LANGS.filter((l) => !text(k, l.code).trim()).map((l) => `${k} (${l.code})`));
    expect(empty).toEqual([]);
  });

  it("yer tutucular üç dilde aynı", () => {
    const diff = entries
      .filter(([k]) => new Set(LANGS.map((l) => placeholders(text(k, l.code)).join(","))).size > 1)
      .map(([k]) => `${k}: ${LANGS.map((l) => `${l.code}=[${placeholders(text(k, l.code))}]`).join(" ")}`);
    expect(diff).toEqual([]);
  });

  it("çoğul blokları her sayı için çözülür", () => {
    const bad: string[] = [];
    for (const [k] of entries) {
      for (const { code } of LANGS) {
        if (!text(k, code).includes(", plural,")) continue;
        for (const n of [0, 1, 2, 3, 11, 100, 101]) {
          const out = translate(code, k, { n });
          if (out.includes("plural") || out.includes("#") || /\{n\b/.test(out))
            bad.push(`${k} (${code}, n=${n}): ${out}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it("sayı uyumu", () => {
    expect(translate("en", "list.count", { n: 1 })).toBe("1 lead");
    expect(translate("en", "list.count", { n: 12 })).toBe("12 leads");
    expect(translate("tr", "list.count", { n: 12 })).toBe("12 lead");
    expect(translate("en", "today.hot", { n: 1 })).toContain("1 open lead planning installation within 3 months has");
    expect(translate("ar", "list.count", { n: 2 })).toBe("عميلان محتملان");
    expect(translate("ar", "list.count", { n: 5 })).toBe("5 عملاء محتملين");
    expect(translate("ar", "list.count", { n: 25 })).toBe("25 عميلًا محتملًا");
    expect(translate("ar", "list.count", { n: 100 })).toBe("100 عميل محتمل");
  });

  it("aşama ve kayıp nedeni adlarının Arapçası var", () => {
    for (const code of ["NEW", "CONTACTED", "QUALIFIED", "PROPOSAL", "WON", "LOST"]) {
      expect(AR_REF[`stage.${code}`], code).toBeTruthy();
    }
  });
});
