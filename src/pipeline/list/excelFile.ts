/**
 * Lead listesinin .xlsx dosyası: yazma ve okuma. `exceljs` yalnız düğmeye basılınca yüklenir (ayrı parça), liste
 * sayfasının açılışını ağırlaştırmaz. Hücre metinleri dosyada metin olarak durur; Excel onları formül diye çalıştırmaz.
 */
import { cellText, type CellValue } from "./excelSync";

const load = async () => {
  const m = await import("exceljs");
  return m.default ?? m;
};

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Başlık renkleri arayüzün `--ok-*` ve `--col-slate-*` tonlarıdır (açık zemin, 4.5:1 üstü karşıtlık). */
const HEAD = {
  editable: { fill: "FFDCF1E5", ink: "FF16603A" },
  readonly: { fill: "FFE9ECEF", ink: "FF3F4852" },
} as const;

export interface WorkbookSpec {
  sheetName: string;
  header: readonly string[];
  /** Başlıkla aynı uzunlukta: sütun içe aktarımda alınır mı (başlık rengi). */
  editable: readonly boolean[];
  rows: readonly (readonly CellValue[])[];
  rtl: boolean;
  info: { sheetName: string; lines: readonly string[] };
  /** Dışa aktarım anındaki hücre metinleri (satır başına; sonda kimlik): gizli sayfaya yazılır. */
  snapshot: readonly (readonly string[])[];
}

/** Excel sayfa adı: en çok 31 karakter, `: \ / ? * [ ]` olmaz. */
/**
 * Gizli sayfa: dışa aktarım anındaki hücre metinleri. İçe aktarım yalnız bu metinden farklı hücreleri "Excel'de
 * değiştirilmiş" sayar; kullanıcı görmez (Excel'in "Göster" listesinde de çıkmaz).
 */
const SNAPSHOT_SHEET = "_crm";

const sheetName = (s: string) => s.replace(/[:\\/?*[\]]/g, " ").slice(0, 31) || "Sheet";

export async function buildWorkbook(spec: WorkbookSpec): Promise<ArrayBuffer> {
  const ExcelJS = await load();
  const wb = new ExcelJS.Workbook();
  wb.created = new Date();
  // İlk satır ve ilk iki sütun (tarih, ad) listede olduğu gibi yerinde kalır.
  const ws = wb.addWorksheet(sheetName(spec.sheetName), {
    views: [{ state: "frozen", xSplit: 2, ySplit: 1, rightToLeft: spec.rtl }],
  });
  ws.addRow([...spec.header]);
  ws.addRows(spec.rows.map((r) => [...r]));
  const last = spec.header.length;
  const head = ws.getRow(1);
  head.height = 32;
  for (let i = 1; i <= last; i++) {
    const tone = spec.editable[i - 1] ? HEAD.editable : HEAD.readonly;
    const cell = head.getCell(i);
    cell.font = { bold: true, color: { argb: tone.ink } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: tone.fill } };
    cell.alignment = { vertical: "middle", wrapText: true };
    cell.border = { bottom: { style: "thin", color: { argb: tone.ink } } };
    const longest = spec.rows.slice(0, 300).reduce(
      (n, r) => {
        const v = r[i - 1];
        return Math.max(n, v instanceof Date ? 10 : String(v ?? "").length);
      },
      spec.header[i - 1]!.length,
    );
    const col = ws.getColumn(i);
    col.width = Math.min(44, Math.max(10, longest + 2));
    if (spec.rows.some((r) => r[i - 1] instanceof Date)) col.numFmt = "dd.mm.yyyy";
  }
  // Kimlik sütunu soluk yazılır: okunur ama düzenlenecek bir bilgi gibi durmaz.
  ws.getColumn(last).font = { color: { argb: "FF6B6355" } };
  head.getCell(last).font = { bold: true, color: { argb: HEAD.readonly.ink } };
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: last } };

  const info = wb.addWorksheet(sheetName(spec.info.sheetName), { views: [{ rightToLeft: spec.rtl }] });
  info.getColumn(1).width = 110;
  spec.info.lines.forEach((line, i) => {
    const cell = info.addRow([line]).getCell(1);
    cell.alignment = { wrapText: true, vertical: "top" };
    if (i === 0) cell.font = { bold: true };
  });
  const snap = wb.addWorksheet(SNAPSHOT_SHEET, { state: "veryHidden" });
  snap.addRows(spec.snapshot.map((r) => [...r]));
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

export interface ReadSheet {
  header: string[];
  /** Boş olmayan veri satırları; `n` Excel'deki satır numarası. */
  rows: { n: number; cells: string[] }[];
  /** Dosyanın oluşturulduğu an (ms); bilinmiyorsa null. */
  createdAt: number | null;
  /** Gizli sayfadaki dışa aktarım metinleri (satır başına); sayfa yoksa null. */
  snapshot: string[][] | null;
}

type Sheet = InstanceType<Awaited<ReturnType<typeof load>>["Workbook"]>["worksheets"][number];

/** Sayfanın dolu hücreleri, satır satır; seyrek satırlar `width` uzunluğuna getirilir. */
function readLines(ws: Sheet): { n: number; cells: string[] }[] {
  const lines: { n: number; cells: string[] }[] = [];
  let width = 0;
  ws.eachRow({ includeEmpty: false }, (row, n) => {
    const cells: string[] = [];
    row.eachCell({ includeEmpty: false }, (cell, col) => {
      const v = cell.value;
      const raw =
        v !== null && typeof v === "object" && !(v instanceof Date) ? ("result" in v ? v.result : cell.text) : v;
      const text = cellText(raw);
      if (!text) return;
      cells[col - 1] = text;
      width = Math.max(width, col);
    });
    if (cells.length) lines.push({ n, cells });
  });
  // Başlıksız ama dolu sütun da genişliğe sayılır (düzen denetimi yakalar).
  return lines.map((l) => ({ n: l.n, cells: Array.from({ length: width }, (_, k) => l.cells[k] ?? "") }));
}

/** İlk sayfayı (ve varsa gizli dışa aktarım kopyasını) okur. Dosya .xlsx değilse ya da bozuksa hata fırlatır. */
export async function readWorkbook(data: ArrayBuffer): Promise<ReadSheet> {
  const ExcelJS = await load();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data);
  const ws = wb.worksheets.find((w) => w.name !== SNAPSHOT_SHEET);
  if (!ws) throw new Error("no worksheet");
  const lines = readLines(ws);
  const first = lines[0]?.n === 1 ? lines.shift()! : null;
  const snap = wb.getWorksheet(SNAPSHOT_SHEET);
  return {
    header: first ? first.cells : [],
    rows: lines,
    createdAt: wb.created instanceof Date && !Number.isNaN(wb.created.getTime()) ? wb.created.getTime() : null,
    snapshot: snap ? readLines(snap).map((l) => l.cells) : null,
  };
}
