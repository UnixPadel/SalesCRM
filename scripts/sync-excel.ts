// Satışçının kişisel Excel takip dosyasını CRM'le eşitler (src/bootstrap/syncExcel.ts).
//   npm run db:sync-excel -- --as-of 2026-11-20T15:07:00+03:00 \
//        --file <amro.xlsx> --list amro --owner 51  [--file <salah.xlsx> --list salah --owner 46] [--apply]
//   npm run db:sync-excel -- --restore <geri yükleme noktası kimliği>
// Varsayılan kuru koşudur: yalnız okur, satır başına kararı basar, hiçbir şey yazmaz. --apply planı uygular ve
// geri yükleme noktası oluşturur (Yönetim > Teknik > Geri yükleme noktaları). Kişisel veri yazdırılmaz.
import "../server/env.mjs";
import { existsSync } from "node:fs";
import { createConnection } from "node:net";
import { resolve } from "node:path";
import ExcelJS from "exceljs";
import { readSnapshot, SnapshotError, type SheetLike, type WorkbookLike } from "../src/bootstrap/excelSnapshot";
import { restoreCheckpoint } from "../src/bootstrap/checkpoints";
import { applyExcelSync, planExcelSync, type SyncList } from "../src/bootstrap/syncExcel";
import { openDatabase, schemaVersion } from "../src/modules/shared/db";
import { loadConfig } from "../src/modules/shared/kernel";

const args = process.argv.slice(2);
const fail = (msg: string, code = 1): never => {
  console.error(`[sync] ${msg}`);
  process.exit(code);
};
const value = (i: number) => {
  const v = args[i + 1];
  if (!v || v.startsWith("--")) fail(`${args[i]} bir değer ister.`);
  return v!;
};

let asOfRaw: string | undefined;
let label: string | undefined;
let restoreId: string | undefined;
const apply = args.includes("--apply");
const files: { path: string; list?: string; owner?: string }[] = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--as-of") asOfRaw = value(i++);
  else if (a === "--label") label = value(i++);
  else if (a === "--restore") restoreId = value(i++);
  else if (a === "--file") files.push({ path: value(i++) });
  else if (a === "--list") (files.at(-1) ?? fail("--list, --file'dan sonra gelir.")).list = value(i++);
  else if (a === "--owner") (files.at(-1) ?? fail("--owner, --file'dan sonra gelir.")).owner = value(i++);
  else if (a !== "--apply") fail(`Bilinmeyen seçenek: ${a}`);
}

const config = loadConfig();
if (!config.databaseUrl) {
  const port = Number(process.env["API_PORT"]) || 8787;
  const busy = await new Promise<boolean>((res) => {
    const s = createConnection({ port, host: "127.0.0.1" });
    s.once("connect", () => (s.destroy(), res(true)));
    s.once("error", () => res(false));
  });
  if (busy) fail("Sunucu çalışıyor; önce durdurun (PGlite tek süreç).");
}
const db = await openDatabase(config, { migrate: false });
const version = await schemaVersion(db);
console.log(`[sync] veritabanı: ${config.databaseUrl ? "Postgres" : "PGlite"} · şema ${version}`);

if (restoreId) {
  if (version < 22) fail("Şema 22'den eski; geri yükleme noktası tablosu yok.");
  const r = await restoreCheckpoint(db, restoreId, "cli", new Date());
  console.log(
    `[sync] geri dönüldü: ${r.deleted} satır silindi · ${r.reinserted} geri eklendi · ${r.reverted} eski haline döndü` +
      (r.keptPersons ? ` · ${r.keptPersons} kişi kaydı başka lead'e bağlı olduğu için kaldı` : ""),
  );
  await db.close();
  process.exit(0);
}

if (!asOfRaw) fail("--as-of gerekli (Excel'in son düzenlenme zamanı, ör. 2026-11-20T15:07:00+03:00).");
const asOf = new Date(asOfRaw!);
if (Number.isNaN(asOf.getTime()) || !/[zZ]|[+-]\d\d:?\d\d$/.test(asOfRaw!))
  fail("--as-of saat dilimiyle verilmeli (ör. 2026-11-20T15:07:00+03:00).");
if (!files.length) fail("En az bir --file <dosya> --list <ad> --owner <KullaniciID> gerekli.");
if (version < 12) fail("Şema sürümü 12 gerekli.");
if (apply && version < 22) fail("--apply için şema 22 gerekli (geri yükleme noktası). Önce sunucuyu güncelleyin.");

async function snapshotOf(path: string) {
  if (!existsSync(path)) fail(`Dosya bulunamadı: ${path}`);
  const wbx = new ExcelJS.Workbook();
  await wbx.xlsx.readFile(resolve(path));
  const wb: WorkbookLike = {
    sheet(name) {
      const ws = wbx.getWorksheet(name);
      if (!ws) return undefined;
      const s: SheetLike = {
        rowCount: ws.rowCount,
        columnCount: ws.columnCount,
        cell: (r, c) => {
          const cell = ws.getCell(r, c);
          const text = (() => {
            try {
              // Sayı biçimli hücrede (telefon) ExcelJS metin yerine sayı döndürebilir.
              const t: unknown = cell.text;
              return typeof t === "string" ? t : t === null || t === undefined ? "" : String(t);
            } catch {
              return "";
            }
          })();
          return { value: cell.value, text };
        },
      };
      return s;
    },
  };
  try {
    return readSnapshot(wb);
  } catch (e) {
    if (e instanceof SnapshotError) fail(`${path}: ${e.message}`);
    throw e;
  }
}

const lists: SyncList[] = [];
for (const f of files) {
  if (!f.list || !f.owner) fail("Her --file için --list ve --owner verin.");
  lists.push({ name: f.list!, ownerId: f.owner!, snapshot: await snapshotOf(f.path) });
}

const now = new Date();
const report = await planExcelSync(db, lists, { asOf, now });
const o = (s: string) => console.log(`[sync] ${s}`);
o(`kesim zamanı ${asOf.toISOString()} · ${report.rows} satır`);
o(
  `karar: Excel esas ${report.counts.excel} · CRM esas ${report.counts.crm} · yeni ${report.counts.create} · atlanan ${report.counts.skip}`,
);
for (const p of report.plans) {
  const who = `${p.list} No ${p.no}`;
  const id = p.leadId ? p.leadId.slice(0, 8) : "—";
  const when = p.lastEditAt ? ` son düzenleme ${p.lastEditAt.slice(0, 16)}Z` : "";
  const what = p.changes.length ? p.changes.join(", ") : "değişiklik yok";
  const extra = [
    p.dateFixes.length ? `tarih düzeltmesi: ${p.dateFixes.join("/")}` : "",
    p.removeActivityIds.length ? `${p.removeActivityIds.length} içe aktarma teması silinecek` : "",
    p.addContacts.length ? `${p.addContacts.length} temas eklenecek` : "",
    p.hideDuplicates.length
      ? `${p.hideDuplicates.length} kopya gizlenecek (${p.hideDuplicates.map((x) => x.slice(0, 8)).join("/")})`
      : "",
    p.reason ? `not: ${p.reason}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  o(`  ${who.padEnd(14)} ${p.mode.padEnd(6)} ${id}${when} → ${what}${extra ? ` (${extra})` : ""}`);
}

if (!apply) {
  o("Kuru koşu: hiçbir şey yazılmadı. Uygulamak için aynı komutu --apply ile çalıştırın.");
  await db.close();
  process.exit(0);
}

const applied = await applyExcelSync(db, report, {
  asOf,
  now,
  label: label ?? `Excel eşitleme: ${lists.map((l) => l.name).join(" + ")} (kesim ${asOfRaw})`,
  actorId: "import",
});
o(
  `uygulandı: ${applied.created} yeni · ${applied.updated} güncellendi · ${applied.contactsAdded} temas eklendi · ` +
    `${applied.contactsRemoved} temas silindi · ${applied.hidden} kopya gizlendi · aşama ${JSON.stringify(applied.stageMoves)}`,
);
if (applied.failed.length) o(`hatalar: ${applied.failed.map((f) => `${f.list} No ${f.no} ${f.code}`).join(" · ")}`);
o(`geri yükleme noktası: ${applied.checkpointId}`);
await db.close();
