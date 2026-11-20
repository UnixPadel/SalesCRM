/** Kelime başı sayılmayan önceki karakter: harf, rakam, birleşik işaret, kesme işareti, alt çizgi (Chromium kuralı). */
const IN_WORD = /[\p{L}\p{N}\p{M}'’_]/u;

/**
 * Kelime başındaki küçük "i"leri "İ" yapar (DOM'suz; testler buradan okur). `prev`: metinden hemen önce gelen
 * karakter (yoksa kelime başı sayılır). Kullanımı: turkishTitleCase.ts.
 */
export function dotTurkishI(text: string, prev = ""): string {
  if (!text.includes("i")) return text;
  let out = "";
  let before = prev;
  for (const ch of text) {
    out += ch === "i" && !IN_WORD.test(before) ? "İ" : ch;
    before = ch;
  }
  return out;
}
