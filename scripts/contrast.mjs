// WCAG 2.2 contrast check for the design tokens in src/styles.css.
// Usage: node scripts/contrast.mjs   (exits 1 if any pair fails)
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

function block(selector) {
  const i = css.indexOf(selector);
  const start = css.indexOf("{", i) + 1;
  let depth = 1, j = start;
  while (depth) { if (css[j] === "{") depth++; if (css[j] === "}") depth--; j++; }
  const out = {};
  for (const m of css.slice(start, j).matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)) out[m[1]] = m[2];
  return out;
}
const themes = { light: block(":root {"), dark: { ...block(":root {"), ...block(':root[data-theme="dark"] {') } };

const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

// [foreground, background, minimum]
const PAIRS = [
  ["text-1", "surface-0", 4.5], ["text-1", "surface-1", 4.5], ["text-2", "surface-1", 4.5], ["text-2", "surface-2", 4.5],
  ["text-3", "surface-1", 4.5], ["text-3", "surface-0", 4.5], ["text-2", "surface-3", 4.5], ["text-3", "surface-2", 4.5],
  ["brand-text", "brand", 4.5], ["brand-ink", "brand-weak", 4.5], ["brand-ink", "surface-1", 4.5],
  ["bad-ink", "bad-weak", 4.5], ["ok-ink", "ok-weak", 4.5], ["warn-ink", "warn-weak", 4.5], ["info-ink", "info-weak", 4.5],
  ["col-slate-ink", "col-slate-weak", 4.5], ["col-green-ink", "col-green-weak", 4.5], ["col-blue-ink", "col-blue-weak", 4.5],
  ["col-amber-ink", "col-amber-weak", 4.5], ["col-red-ink", "col-red-weak", 4.5], ["col-red-ink", "surface-1", 4.5],
  ["border-strong", "surface-1", 3], ["focus", "surface-1", 3], ["bad", "surface-1", 3], ["ok", "surface-1", 3],
  ["col-slate", "surface-2", 3], ["col-green", "surface-2", 3], ["col-blue", "surface-2", 3], ["col-amber", "surface-2", 3], ["col-red", "surface-2", 3],
];
const WHITE_ON = { light: ["bad", "ok", "col-slate", "col-green", "col-blue", "col-amber", "col-red"], dark: [] };
const DARK_ON = { light: [], dark: ["bad", "ok", "col-slate", "col-green", "col-blue", "col-amber", "col-red"] };

let fail = 0;
for (const [name, t] of Object.entries(themes)) {
  console.log(`\n${name}`);
  const check = (label, fg, bg, min) => {
    const r = ratio(fg, bg);
    const ok = r >= min;
    if (!ok) fail++;
    console.log(`${ok ? "  ok " : "FAIL "} ${label.padEnd(30)} ${r.toFixed(2)}:1 (min ${min})`);
  };
  for (const [f, b, min] of PAIRS) check(`${f} on ${b}`, t[f], t[b], min);
  for (const b of WHITE_ON[name]) check(`#fff on ${b}`, "#ffffff", t[b], 4.5);
  for (const b of DARK_ON[name]) check(`#15171a on ${b}`, "#15171a", t[b], 4.5);
}
console.log(fail ? `\n${fail} pair(s) fail` : "\nAll pairs pass WCAG AA");
process.exit(fail ? 1 : 0);
