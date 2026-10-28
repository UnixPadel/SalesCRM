// Eski JSON veriyi yeni pipeline'a taşır.
//   npm run db:migrate-legacy -- --owners "Yuşa=32,Ahlem=47,Salah=46,Elshan=12" [--dry-run] [--file server/data/crm.json]
// --owners verilmezse ve AUTH_DB_URL tanımlıysa adlar kullanıcı tablosundan (Ad → KullaniciID) çözülür.
// --dry-run: bellekte PGlite ile çalışır, hiçbir şey yazmaz, yalnız rapor basar.
import "../server/env.mjs";
import { readFileSync } from "node:fs";
import { listTeam } from "../server/authDb.mjs";
import { migrateLegacy, type LegacySnapshot } from "../src/bootstrap/migrateLegacy";
import { openDatabase } from "../src/modules/shared/db";
import { createLogger, loadConfig } from "../src/modules/shared/kernel";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? (args[i + 1] ?? "") : undefined;
};
const dryRun = args.includes("--dry-run");
const file = flag("--file") ?? process.env["CRM_DATA"] ?? "server/data/crm.json";

const ownerIds: Record<string, string> = {};
const ownersArg = flag("--owners");
if (ownersArg) {
  for (const pair of ownersArg.split(",")) {
    const [name, id] = pair.split("=").map((s) => s.trim());
    if (name && id) ownerIds[name] = id;
  }
} else if (process.env["AUTH_DB_URL"]) {
  const team = await listTeam();
  for (const m of team) {
    ownerIds[m.first] = m.id;
    ownerIds[m.login] = m.id;
  }
  // Eski panodaki yazım farkı (README): "Yusa" → "Yuşa".
  if (ownerIds["Yusa"] && !ownerIds["Yuşa"]) ownerIds["Yuşa"] = ownerIds["Yusa"];
}

const raw = JSON.parse(readFileSync(file, "utf8")) as { tables: LegacySnapshot };
const snap = raw.tables;
console.log(
  `[legacy] kaynak ${file}: ${snap.leads.length} form lead'i, ${snap.deals.length} fırsat, ${snap.contacts.length} kişi`,
);
console.log(
  `[legacy] sorumlu eşlemesi: ${
    Object.keys(ownerIds).length
      ? Object.entries(ownerIds)
          .map(([k, v]) => `${k}→${v}`)
          .join(", ")
      : "YOK (hepsi havuza düşer)"
  }`,
);

const config = loadConfig();
const db = await openDatabase(config, { memory: dryRun });
const report = await migrateLegacy(db, snap, {
  ownerIds,
  logger: createLogger({ module: "legacy-migration" }, () => {}),
});
await db.close();

console.log(
  `[legacy] ${dryRun ? "DRY-RUN (yazılmadı)" : config.databaseUrl ? "postgres" : `pglite (${config.pgliteDir})`}`,
);
console.log(
  `[legacy] form lead'leri: ${report.leads.created} açıldı, ${report.leads.existing} zaten vardı, ${report.leads.skipped.length} atlandı`,
);
console.log(
  `[legacy] fırsatlar: ${report.deals.created} açıldı, ${report.deals.existing} zaten vardı, ${report.deals.skipped.length} atlandı, ${report.deals.stageErrors.length} aşama hatası`,
);
if (report.unknownOwners.length)
  console.log(`[legacy] eşlenmeyen sorumlu adları (havuza düştü): ${report.unknownOwners.join(", ")}`);
const skipped = [...report.leads.skipped, ...report.deals.skipped, ...report.deals.stageErrors];
if (skipped.length) {
  const byReason = new Map<string, number>();
  for (const s of skipped) byReason.set(s.reason, (byReason.get(s.reason) ?? 0) + 1);
  console.log(`[legacy] atlanma nedenleri: ${[...byReason].map(([r, n]) => `${r}×${n}`).join(", ")}`);
}

// mysql2 havuzu ve PGlite worker süreci açık tutabilir; CLI işi bitince çıkar.
process.exit(0);
