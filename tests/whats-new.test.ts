import { describe, expect, it } from "vitest";
import { LANGS } from "../src/i18n/lang";
import { LATEST_WHATS_NEW, WHATS_NEW } from "../src/whatsNew";

describe("Neler yeni notları", () => {
  it("en yeni en üstte, kimlikler tekrarsız, en yeni kimlik açılış penceresini belirler", () => {
    const ids = WHATS_NEW.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort().reverse()).toEqual(ids);
    expect(LATEST_WHATS_NEW).toBe(ids[0]);
  });

  it("her not her dilde aynı sayıda, dolu madde taşır", () => {
    for (const r of WHATS_NEW) {
      expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      const n = r.items.tr.length;
      expect(n).toBeGreaterThan(0);
      for (const l of LANGS) {
        expect(r.items[l.code], `${r.id} ${l.code}`).toHaveLength(n);
        for (const x of r.items[l.code]) expect(x.title.trim() && x.text.trim()).toBeTruthy();
      }
    }
  });
});
