// Form tablosunu (Google E-Tablolar'daki Meta form dökümü) bir kez CRM'e işler; sunucu aynı işi zamanlanmış yapar.
//   npm run db:import-sheet -- [--dry-run] [--url <csv adresi>]
// Adres verilmezse .env'deki SHEET_SYNC_CSV_URL. --dry-run (PGlite): veri klasörünün geçici kopyasında çalışır, raporu
// basar, kopyayı siler. Bu komut bildirim göndermez (sunucudaki eşitleme gönderir). Kişisel veri yazdırılmaz.
import "../server/env.mjs";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchSheetCsv, readSheet, syncSheet } from "../src/bootstrap/sheetSync";
import { createSalesPipeline } from "../src/modules/sales-pipeline/application";
import { PgUnitOfWork } from "../src/modules/sales-pipeline/infrastructure";
import { openDatabase, schemaVersion, type Db } from "../src/modules/shared/db";
import { loadConfig, silentLogger, systemClock, uuidGenerator } from "../src/modules/shared/kernel";

const args = process.argv.slice(2);
const at = args.indexOf("--url");
const dryRun = args.includes("--dry-run");
const config = loadConfig();
const url = (at >= 0 ? args[at + 1] : config.sheetSync.csvUrl) ?? "";
const fail = (msg: string): never => {
  console.error(`[tablo] ${msg}`);
  process.exit(1);
};
if (!url) fail("Adres yok: .env'ye SHEET_SYNC_CSV_URL ekleyin ya da --url verin.");

// Kuru çalıştırma yalnız geçici kopyaya yazar; gerçek koşu PGlite'ta sunucuyla aynı anda yapılamaz.
if (!config.databaseUrl && !dryRun) {
  const port = Number(process.env["API_PORT"]) || 8787;
  const busy = await new Promise<boolean>((res) => {
    const s = createConnection({ port, host: "127.0.0.1" });
    s.once("connect", () => (s.destroy(), res(true)));
    s.once("error", () => res(false));
  });
  if (busy)
    fail("Sunucu çalışıyor; sunucu tabloyu zaten eşitliyor. Bu komut için sunucuyu durdurun (PGlite tek süreç).");
}

const text = await fetchSheetCsv(url).catch((e: Error) => fail(e.message));
const { rows, missing } = readSheet(text);
if (missing.length) fail(`Tabloda zorunlu sütun yok: ${missing.join(", ")}`);
console.log(`[tablo] ${rows.length} satır okundu`);

async function run(db: Db) {
  if ((await schemaVersion(db)) < 12) fail("Önce migration'ları uygulayın (şema sürümü 12 gerekli).");
  const pipeline = createSalesPipeline({
    uow: new PgUnitOfWork(db, uuidGenerator),
    clock: systemClock,
    ids: uuidGenerator,
    platforms: { enabledProviders: () => [] },
    events: { publish: async () => {} },
    logger: silentLogger,
    undoWindowMs: 0,
  });
  const r = await syncSheet({ pipeline, uow: new PgUnitOfWork(db, uuidGenerator), db, now: new Date() }, rows);
  console.log(
    `[tablo] yeni lead ${r.created} · CRM'de zaten olan ${r.matched} · daha önce eşitlenmiş ${r.rerun} · e-posta teması ${r.mailContacts} (CRM'de olan lead'lere ${r.mailOnExisting})`,
  );
  if (r.skipped.length)
    console.log(`[tablo] atlanan: ${r.skipped.map((s) => `satır ${s.rowNo} ${s.reason}`).join(" · ")}`);
  if (r.failed.length) console.log(`[tablo] hata: ${r.failed.map((f) => `satır ${f.rowNo} ${f.code}`).join(" · ")}`);
  console.log(r.changes ? `[tablo] toplam yazma: ${r.changes}` : "[tablo] Değişiklik yok.");
}

if (dryRun) {
  if (config.databaseUrl) fail("Postgres'te kuru çalıştırma yok; kopya veritabanında deneyin.");
  const tmp = mkdtempSync(join(tmpdir(), "crm-sheet-dry-"));
  const copy = join(tmp, "pglite");
  cpSync(config.pgliteDir, copy, { recursive: true });
  try {
    const db = await openDatabase(config, { migrate: false, pgliteDir: copy });
    console.log("[tablo] KURU ÇALIŞTIRMA (geçici kopyada; gerçek veriye yazılmadı)");
    await run(db);
    await db.close();
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
} else {
  const db = await openDatabase(config, { migrate: false });
  await run(db);
  await db.close();
}
process.exit(0);
