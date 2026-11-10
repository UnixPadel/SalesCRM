/**
 * Excel'e aktar (CSV; Faz 7g, iş emri §5.4): UTF-8 BOM, ";" ayraç, CRLF, çift tırnak kaçışı; formül enjeksiyonuna
 * karşı `= + - @`, sekme ya da CR ile başlayan hücreye "'" öneki. Türkçe Excel ";" ayraçlı CSV'yi sütunlara açar. Saf.
 */
const DANGEROUS = /^[=+\-@\t\r]/;

export function csvCell(v: string): string {
  let s = v ?? "";
  if (DANGEROUS.test(s)) s = `'${s}`;
  return /[";\r\n]/.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const lines = [header, ...rows].map((r) => r.map(csvCell).join(";"));
  return "﻿" + lines.join("\r\n") + "\r\n";
}

/** Tarayıcıda indirme (yalnız arayüz katmanı çağırır). */
export function downloadCsv(name: string, text: string): void {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
