/**
 * Ürün dosyası (CSV) okuyucusu: dışarıdaki sistemden indirilen "UrunKategorileri" dosyası. Yalnız ürün numarası
 * (`KategoriID`) ve adı (`KategoriAdi`) alınır; fiyat, stok, resim gibi diğer sütunlar yok sayılır. Ayırıcı virgül
 * ya da noktalı virgül olabilir; tırnaklı alanlar ve tırnak içindeki ayırıcı desteklenir. Saf: DOM yok.
 */

export interface CatalogCsvRow {
  id: string;
  name: string;
}

export type CatalogCsvResult = { ok: true; rows: CatalogCsvRow[] } | { ok: false; reason: "columns" | "empty" };

/** Tek CSV satırı → alanlar (RFC 4180 tırnak kuralı). */
function splitLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

const ID_HEADERS = ["kategoriid", "id", "urunid", "productid"];
const NAME_HEADERS = ["kategoriadi", "name", "urunadi", "productname", "ad"];
const norm = (s: string) =>
  s
    .replace(/^\uFEFF/, "")
    .trim()
    .toLocaleLowerCase("tr")
    .replace(/ı/g, "i")
    .replace(/ü/g, "u")
    .replace(/[^a-z0-9]/g, "");

export function parseCatalogCsv(text: string): CatalogCsvResult {
  const lines = text.replace(/^\uFEFF/, "").split(/\r\n|\n|\r/);
  const head = lines.findIndex((l) => l.trim() !== "");
  if (head < 0) return { ok: false, reason: "empty" };
  const headerLine = lines[head]!;
  const sep = (headerLine.match(/;/g)?.length ?? 0) > (headerLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const header = splitLine(headerLine, sep).map(norm);
  const idCol = header.findIndex((h) => ID_HEADERS.includes(h));
  const nameCol = header.findIndex((h) => NAME_HEADERS.includes(h));
  if (idCol < 0 || nameCol < 0) return { ok: false, reason: "columns" };
  const rows: CatalogCsvRow[] = [];
  for (const line of lines.slice(head + 1)) {
    if (!line.trim()) continue;
    const cells = splitLine(line, sep);
    const id = cells[idCol] ?? "";
    const name = cells[nameCol] ?? "";
    if (!id && !name) continue;
    rows.push({ id, name });
  }
  return rows.length ? { ok: true, rows } : { ok: false, reason: "empty" };
}
