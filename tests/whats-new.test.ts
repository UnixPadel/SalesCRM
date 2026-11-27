import { describe, expect, it } from "vitest";
import { LANGS } from "../src/i18n/lang";
import { LATEST_WHATS_NEW, WHATS_NEW, WHATS_NEW_TEXT_MAX_WORDS, WHATS_NEW_TITLE_MAX_WORDS } from "../src/whatsNew";

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

  it("notlar kısa: başlık ve metin kelime sınırında, metin tek cümle", () => {
    const words = (s: string) => s.trim().split(/\s+/).length;
    for (const r of WHATS_NEW) {
      for (const l of LANGS) {
        for (const x of r.items[l.code]) {
          const where = `${r.id} ${l.code} "${x.title}"`;
          expect(words(x.title), where).toBeLessThanOrEqual(WHATS_NEW_TITLE_MAX_WORDS);
          expect(words(x.text), where).toBeLessThanOrEqual(WHATS_NEW_TEXT_MAX_WORDS);
          expect(x.text.trim(), where).not.toMatch(/[.!?؟]\s+\S/);
        }
      }
    }
  });
});
