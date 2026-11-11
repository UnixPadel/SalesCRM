// Excel satış takip listesini (UNIXPADEL_Satis_Takip_*.xlsx) CRM'e aktarır (Faz 7g, iş emri §6).
//   npm run db:import-excel -- <dosya.xlsx> [--dry-run] [--owners owners.json] [--apply-to-pool]
//                                           [--no-seed-follow-ups] [--verify]
// Kişisel veri yazdırılmaz: çıktıda yalnız sayılar, lead kimlikleri, Excel No, ekip adları, KullaniciID'ler ve kodlar.
// --dry-run (PGlite): veri klasörünün geçici bir kopyasında gerçek aktarımı çalıştırır, raporu basar, kopyayı siler.
// --verify: salt okunur; Excel ÖZET RAPOR ile CRM Özet raporunu karşılaştırır (çıkış 0 = eşit, 1 = fark, 2 = formül).
import "../server/env.mjs";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import ExcelJS from "exceljs";
import { importExcel, IMPORT_ACTOR, type ImportExcelReport } from "../src/bootstrap/importExcel";
import { compareRows, excelSummary } from "../src/bootstrap/excelVerify";
import { readSnapshot, SnapshotError, type SheetLike, type WorkbookLike } from "../src/bootstrap/excelSnapshot";
import { labelParts, matchTeamLabel, type DirectoryEntry } from "../src/bootstrap/teamMatch";
import { createSalesPipeline } from "../src/modules/sales-pipeline/application";
import { PgUnitOfWork } from "../src/modules/sales-pipeline/infrastructure";
import { openDatabase, schemaVersion, type Db } from "../src/modules/shared/db";
import { DEFAULT_TIME_ZONE } from "../src/modules/sales-pipeline/domain";
import { loadConfig, silentLogger, systemClock, uuidGenerator } from "../src/modules/shared/kernel";

const args = process.argv.slice(2);
const flagValue = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const file = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--owners");
const dryRun = args.includes("--dry-run");
const verify = args.includes("--verify");
const applyToPool = args.includes("--apply-to-pool");
const seedFollowUps = !args.includes("--no-seed-follow-ups");
const ownersFile = flagValue("--owners");
const tz = DEFAULT_TIME_ZONE;
const fail = (msg: string, code = 1): never => {
  console.error(`[excel] ${msg}`);
  process.exit(code);
};

if (!file) fail("Kullanım: npm run db:import-excel -- <dosya.xlsx> [--dry-run] [--owners owners.json] [--verify]");
if (!existsSync(file!)) fail("Dosya bulunamadı.");

// ---- Çalışma kitabı → anlık görüntü (başlık metniyle sütun bulma).
const wbx = new ExcelJS.Workbook();
await wbx.xlsx.readFile(resolve(file!));
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
            return cell.text ?? "";
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
let snap;
try {
  snap = readSnapshot(wb);
} catch (e) {
  if (e instanceof SnapshotError) fail(e.message);
  throw e;
}

// ---- Ekip dizini (KullaniciBilgileri) ve elle eşleme.
let directory: DirectoryEntry[] | null = null;
if (process.env["AUTH_DB_URL"]) {
  try {
    const { listDirectory } = await import("../server/authDb.mjs");
    directory = (await listDirectory()).map((u) => ({
      id: String(u.id),
      first: u.first,
      last: u.last,
      email: u.email,
      role: u.role,
      active: u.active,
    }));
  } catch (e) {
    console.warn(`[excel] kullanıcı tablosu okunamadı (${(e as Error).message}); yalnız --owners eşlemesi çalışır`);
  }
}
const overrides: Record<string, string | null> = ownersFile ? JSON.parse(readFileSync(ownersFile, "utf8")) : {};
if (directory) {
  const active = new Set(directory.filter((u) => u.active && u.role !== "viewer").map((u) => u.id));
  for (const [label, id] of Object.entries(overrides)) {
    if (id !== null && !active.has(String(id))) fail(`--owners: "${label}" → ${id} aktif bir satış kullanıcısı değil.`);
  }
}
const nameOf = (id: string | null) => {
  if (id === null) return "ortak havuz";
  const u = directory?.find((x) => x.id === id);
  return u ? `${u.first} (${id})` : id;
};

// ---- Veritabanı: PGlite tek süreçtir; sunucu açıksa dur.
const config = loadConfig();
if (!config.databaseUrl) {
  const port = Number(process.env["API_PORT"]) || 8787;
  const busy = await new Promise<boolean>((res) => {
    const s = createConnection({ port, host: "127.0.0.1" });
    s.once("connect", () => (s.destroy(), res(true)));
    s.once("error", () => res(false));
  });
  if (busy) fail("Sunucu çalışıyor; içe aktarmadan önce durdurun (PGlite tek süreç).");
}

async function open(dir?: string): Promise<Db> {
  const db = await openDatabase(config, { migrate: false, ...(dir ? { pgliteDir: dir } : {}) });
  if ((await schemaVersion(db)) < 12) {
    await db.close();
    fail("Önce sunucuyu başlatıp migration'ları uygulayın (şema sürümü 12 gerekli).");
  }
  return db;
}

const pct = (n: number, d: number) => (d > 0 ? `%${((n / d) * 100).toFixed(1).replace(".", ",")}` : "–");

function printReport(r: ImportExcelReport, label: string) {
  const o = (k: string) => console.log(`[excel] ${k}`);
  o(`${label}`);
  o(
    `Excel: SATIŞ TAKİP ${r.rows} satır · TEMAS GEÇMİŞİ ${r.contactRows} satır · LİSTELER bölge ${r.territoryRows} satır`,
  );
  const resolved = r.owners.filter((x) => x.match.kind === "user");
  const pooled = r.owners.filter((x) => x.match.kind !== "user");
  o(
    `Sorumlu: ${resolved.map((x) => `${x.name} → ${(x.match as { userId: string }).userId} (${x.count})`).join(" · ") || "—"}`,
  );
  if (pooled.length) {
    o(
      `  Çözülemedi → ortak havuz, etiket saklanır: ${pooled
        .map((x) => {
          const m = x.match;
          const why =
            m.kind !== "unresolved"
              ? m.kind === "pool" && m.via === "override"
                ? " (elle havuza)"
                : ""
              : m.reason === "ambiguous"
                ? ` (${m.candidates.length} aktif kullanıcıda: ${m.candidates.join(", ")})`
                : m.reason === "inactive_only"
                  ? ` (yalnız pasif kullanıcı ${m.candidates.join(", ")})`
                  : " (tabloda yok)";
          return `${x.name} ${x.count}${why}`;
        })
        .join(" · ")}`,
    );
  }
  o(
    `Bölge kuralı: ${r.territory.written.length} yazıldı (${r.territory.written.join(" ") || "—"}) · ${r.territory.existing} zaten vardı · ${r.territory.skipped} yazılmadı · ${r.territory.conflicts.length} çakışma${r.territory.conflicts.length ? ` (${r.territory.conflicts.join(" ")})` : ""}`,
  );
  o(
    `Lead: ${r.leads.created} yeni · ${r.leads.enriched.length} zenginleştirildi${r.leads.enriched.length ? ` (${r.leads.enriched.map((e) => `lead ${e.leadId}, Excel No ${e.no}`).join("; ")})` : ""} · ${r.leads.rerun} yeniden çalıştırma · ${r.leads.personConflicts.length} kişi çakışması · ${r.leads.renumbered.length} yeniden numaralanmış · ${r.leads.noIdentity.length} kimliksiz`,
  );
  if (r.leads.failed.length) o(`  Hata: ${r.leads.failed.map((f) => `No ${f.no} ${f.code}`).join(" · ")}`);
  o(
    `Aşama (yeni lead'ler): ${
      Object.entries(r.newLeadStages)
        .map(([k, v]) => `${k} ${v}`)
        .join(" · ") || "—"
    } · bu koşudaki geçişler: ${
      Object.entries(r.stages)
        .map(([k, v]) => `${k} ${v}`)
        .join(" · ") || "yok"
    }`,
  );
  o(
    `Temas: e-posta gönderimi ${r.contacts.mailSent} (tahmini) · WhatsApp gönderimi ${r.contacts.waSent} · e-posta dönüşü ${r.contacts.mailReply} · WhatsApp dönüşü ${r.contacts.waReply} · TEMAS ${r.contacts.temas} · sonraki takip ${r.contacts.next}`,
  );
  o(
    `Alan: müşteri durumu ${r.fields.status} · ürün ${r.fields.products} · form cevabı ${r.fields.formAnswers} · platform ${r.fields.platform} · kampanya ${r.fields.campaign} · çakışan alan ${r.fieldConflicts}`,
  );
  o(
    `İçe aktarma sorunu: ${
      Object.entries(r.issues)
        .map(([k, v]) => `${k} ${v}`)
        .join(" · ") || "yok"
    } → import_review uyarısı alacak lead: ${r.issueLeads}`,
  );
  for (const h of r.hints) o(`  İpucu: ${h}`);
  o(`Telefon: ${r.phoneUnreadable} okunamadı (kaydedilmedi; e-posta geçerli)`);
  o(
    `Takip tohumu: ${
      Object.entries(r.seeds)
        .map(([k, v]) => `${nameOf(k)} ${v} (${r.seedDays[k]} iş günü)`)
        .join(" · ") || "yok"
    }`,
  );
  o(
    `Havuz: ${r.pool.open} açık lead${
      applyToPool
        ? ` · atanan: ${
            Object.entries(r.pool.assigned)
              .map(([k, v]) => `${nameOf(k)} ${v}`)
              .join(" · ") || "yok"
          }`
        : ""
    }`,
  );
  if (r.candidates.won.length)
    o(`Kazanıldı adayı (tutar gerekir, otomatik yok): Excel No ${r.candidates.won.join(", ")}`);
  if (r.candidates.lost.length)
    o(`Kaybedildi adayı (neden gerekir, otomatik yok): Excel No ${r.candidates.lost.join(", ")}`);
  o(r.changes === 0 ? "Değişiklik yok." : `Toplam yazma: ${r.changes}`);
}

const options = { directory, overrides, applyToPool, seedFollowUps, now: new Date(), timeZone: tz };

if (verify) {
  const db = await open();
  const sp = createSalesPipeline({
    uow: new PgUnitOfWork(db, uuidGenerator),
    clock: systemClock,
    ids: uuidGenerator,
    platforms: { enabledProviders: () => [] },
    events: { publish: async () => {} },
    logger: silentLogger,
    undoWindowMs: 0,
    timeZone: tz,
  });
  const leads = await sp.queries.list({ actor: IMPORT_ACTOR, scope: "excel", includeTest: true, limit: 5000 });
  const ownerOf = (row: { owner: string }) => {
    const m = matchTeamLabel(row.owner, directory ?? [], overrides);
    return m.kind === "user" ? m.userId : null;
  };
  const res = compareRows(snap, leads, ownerOf, tz);
  const ex = excelSummary(snap);
  const rep = await sp.reports.tracking({ actor: IMPORT_ACTOR, scope: "excel" });
  await db.close();
  if (!rep.ok) fail(rep.error.code);
  const t = rep.ok ? rep.value : null;
  const line = (label: string, excel: unknown, crm: unknown, note = "") =>
    console.log(
      `  ${label.padEnd(28)} Excel ${String(excel).padStart(6)} | CRM ${String(crm).padStart(6)}${excel === crm ? "" : `  fark ${note}`}`,
    );
  console.log("[excel] §1 Temel göstergeler");
  line("Toplam lead", ex["B7"], t!.basics.total);
  line("Mail atılan", ex["C7"], t!.basics.mailSent, "A1/A7/A10");
  line("WhatsApp'tan aranan", ex["D7"], t!.basics.whatsappSent, "A1/A7");
  line("Hiç ulaşılmamış", ex["E7"], t!.basics.neverReached, "A1/A4/A7/A10");
  line("Dönüş alınan", ex["F7"], t!.basics.replied, "A4/A7");
  line("Teklif verilen", ex["G7"], t!.basics.proposalGiven, "A4/A7");
  line("Alıcı müşteri", ex["H7"], t!.basics.buyers, "A4");
  console.log("[excel] §2 Sorumlu (CRM satırları; havuz = çözülmeyen etiketler, A3)");
  for (const row of t!.byOwner) {
    console.log(
      `  ${nameOf(row.ownerId).padEnd(28)} lead ${row.lead} · mail ${row.mailSent} · WA ${row.whatsappSent} · hiç ${row.neverReached} · dönüş ${row.replied} · teklif ${row.proposalGiven} · ulaşma ${pct(row.contacted, row.lead - row.legacyNoContact)} · dönüş oranı ${pct(row.replied, row.contacted)}`,
    );
  }
  console.log("[excel] §4 Ürünler (Excel tercih → CRM tercih)");
  ["standard", "panoramic", "full_panoramic", "roof"].forEach((code, i) => {
    const p = t!.products.find((x) => x.code === code)!;
    line(code, ex[`C${42 + i}`], p.preferred, "A2/A9");
  });
  line("Kapatma potansiyeli", ex["C46"], t!.closingPotential);
  console.log("[excel] §5 Kurulum zamanı (Excel lead/hiç → CRM)");
  ["m0_3", "m3_6", "m6_12", "researching"].forEach((code, i) => {
    const x = t!.byInstallTimeline.find((y) => y.timeline === code);
    line(`${code} lead`, ex[`C${51 + i}`], x?.lead ?? 0);
    line(`${code} hiç`, ex[`D${51 + i}`], x?.neverReached ?? 0, "A1/A7/A10");
  });
  console.log(
    `[excel] izinli farklar: ${
      Object.entries(res.reasons)
        .map(([k, v]) => `${k} ×${v}`)
        .join(" · ") || "yok"
    } · zenginleştirilen ${res.enriched.length}`,
  );
  if (res.formulaDiffs.length) {
    for (const d of res.formulaDiffs)
      console.log(`  formül farkı ${d.cell}: önbellek ${d.cached} | hesap ${d.computed}`);
    fail("Formül sağlaması tutmadı (çeviri hatası).", 2);
  }
  const bad = [...res.rowDiffs, ...res.ownerDiffs];
  if (res.missing.length) console.log(`  CRM'de bulunmayan Excel No: ${res.missing.join(", ")}`);
  for (const d of bad.slice(0, 50)) console.log(`  ✘ No ${d.no} ${d.field}: beklenen ${d.expected} | CRM ${d.actual}`);
  if (bad.length || res.missing.length) fail(`${bad.length + res.missing.length} gerekçesiz fark.`, 1);
  console.log("[excel] ✔ CRM Özet rapor = Excel ÖZET RAPOR (izinli farklar dışında)");
  process.exit(0);
}

if (dryRun) {
  if (config.databaseUrl) fail("Postgres'te kuru çalıştırma yok; önce bir kopya veritabanında deneyin.");
  const tmp = mkdtempSync(join(tmpdir(), "crm-excel-dry-"));
  const copy = join(tmp, "pglite");
  cpSync(config.pgliteDir, copy, { recursive: true });
  try {
    const db = await open(copy);
    const report = await importExcel(db, snap, options);
    await db.close();
    printReport(report, "KURU ÇALIŞTIRMA (geçici kopyada; gerçek veriye yazılmadı)");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  process.exit(0);
}

const db = await open();
const report = await importExcel(db, snap, options);
await db.close();
printReport(report, config.databaseUrl ? "postgres" : `pglite (${config.pgliteDir})`);
console.log(`[excel] etiketler: ${[...new Set(snap.rows.map((r) => labelParts(r.owner).name))].length} sorumlu adı`);
process.exit(0);
