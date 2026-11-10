// Şirket MySQL veritabanındaki müşteri listesini (MusteriBilgileri, Clients, SiparisAlTablo) yeni pipeline'a taşır.
//   npm run db:import-mysql -- [--dry-run] [--limit 50]
// Bağlantı: .env içindeki AUTH_DB_URL (giriş tablosuyla aynı veritabanı). --dry-run: bellekte PGlite, hiçbir
// şey yazılmaz, yalnız rapor. Kişisel veri ekrana yazılmaz; yalnız sayılar ve kimlikler.
import "../server/env.mjs";
import mysql from "mysql2/promise";
import { importMysqlCustomers, type MysqlSnapshot } from "../src/bootstrap/importMysql";
import { openDatabase } from "../src/modules/shared/db";
import { createLogger, loadConfig } from "../src/modules/shared/kernel";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? (args[i + 1] ?? "") : undefined;
};
const dryRun = args.includes("--dry-run");
const limit = Number(flag("--limit")) || 0;

const url = process.env["AUTH_DB_URL"];
if (!url) {
  console.error("AUTH_DB_URL tanımlı değil (.env). Aktarım için şirket MySQL bağlantısı gerekir.");
  process.exit(1);
}
const u = new URL(url);
const conn = await mysql.createConnection({
  host: u.hostname,
  port: Number(u.port) || 3306,
  user: decodeURIComponent(u.username),
  password: decodeURIComponent(u.password),
  database: u.pathname.slice(1),
  connectTimeout: 15000,
});
const rows = async <T>(sql: string): Promise<T[]> => (await conn.query(sql))[0] as T[];
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const lim = limit ? ` LIMIT ${limit}` : "";

interface CustomerRow {
  MusteriID: number;
  MusteriAd: string;
  Telefon: string | null;
  ZipKod: string | null;
  E_Mail: string | null;
  Adres: string | null;
  VATNumarasi: string | null;
  IsoKodu: string | null;
  NumaraBirimi: string | null;
  CreatedByKullaniciID: number | null;
}
interface ClientRow {
  id: number;
  first_name: string;
  last_name: string;
  phone: string | null;
  email: string | null;
  details: string | null;
  country: string | null;
  City: string | null;
  Platform: string | null;
  createdAt: Date | string | null;
  createdBy: string | null;
}
interface OrderRow {
  SiparisAlID: number;
  MusteriId: number | null;
  ClientId: number | null;
  SiparisMiTeklifMi: string | null;
  Silindi: number | null;
  ToplamFiyat: string | number | null;
  ParaTipi: string | null;
  Tarih: Date | string | null;
  KullaniciID: number | null;
}
interface CountryRow {
  UlkeAdi: string;
  IsoKodu: string | null;
}

const customers = await rows<CustomerRow>(
  `SELECT m.MusteriID, m.MusteriAd, m.Telefon, m.ZipKod, m.E_Mail, m.Adres, m.VATNumarasi, u.IsoKodu, u.NumaraBirimi, m.CreatedByKullaniciID
     FROM MusteriBilgileri m LEFT JOIN UlkelerBilgileri u ON u.UlkelerID = m.UlkelerID ORDER BY m.MusteriID${lim}`,
);
const clients = await rows<ClientRow>(
  `SELECT id, first_name, last_name, phone, email, details, country, City, Platform, createdAt, createdBy FROM Clients ORDER BY id${lim}`,
);
const orders = await rows<OrderRow>(
  "SELECT SiparisAlID, MusteriId, ClientId, SiparisMiTeklifMi, Silindi, ToplamFiyat, ParaTipi, Tarih, KullaniciID FROM SiparisAlTablo",
);
const countries = await rows<CountryRow>("SELECT UlkeAdi, IsoKodu FROM UlkelerBilgileri");
// Açan kişi eşlemesi: tablodaki her kullanıcı (aktif/pasif, her rol). Tabloda olmayan kimlik → havuz.
const users = await rows<{ KullaniciID: number }>("SELECT KullaniciID FROM KullaniciBilgileri");
await conn.end();

const iso = (d: Date | string | null): string | null => {
  if (!d) return null;
  const x = d instanceof Date ? d : new Date(d);
  return Number.isNaN(x.getTime()) ? null : x.toISOString();
};
const snap: MysqlSnapshot = {
  customers: customers.map((c) => ({
    id: c.MusteriID,
    name: c.MusteriAd,
    phone: c.Telefon,
    email: c.E_Mail,
    address: c.Adres,
    vat: c.VATNumarasi,
    zip: c.ZipKod,
    countryIso: c.IsoKodu ? c.IsoKodu.toUpperCase() : null,
    dialCode: c.NumaraBirimi,
    createdByUserId: str(c.CreatedByKullaniciID),
  })),
  clients: clients.map((k) => ({
    id: k.id,
    firstName: k.first_name,
    lastName: k.last_name,
    phone: k.phone,
    email: k.email,
    country: k.country,
    city: k.City,
    details: k.details,
    platform: k.Platform,
    createdAt: iso(k.createdAt),
    createdByUserId: str(k.createdBy),
  })),
  orders: orders.map((o) => ({
    id: o.SiparisAlID,
    customerId: o.MusteriId,
    clientId: o.ClientId,
    kind: o.SiparisMiTeklifMi,
    deleted: Number(o.Silindi) === 1,
    total: o.ToplamFiyat === null ? null : Number(o.ToplamFiyat),
    currency: o.ParaTipi,
    date: iso(o.Tarih),
    userId: str(o.KullaniciID),
  })),
  countryNames: Object.fromEntries(
    countries.filter((c) => c.IsoKodu).map((c) => [c.UlkeAdi.trim().toLowerCase(), c.IsoKodu!.toUpperCase()]),
  ),
};

const teamIds = users.map((u) => String(u.KullaniciID));
console.log(
  `[mysql] kaynak: ${snap.customers.length} müşteri, ${snap.clients.length} talep, ${snap.orders.length} sipariş/teklif satırı; kullanıcı tablosu ${teamIds.length} kişi`,
);

const config = loadConfig();
const db = await openDatabase(config, { memory: dryRun });
const report = await importMysqlCustomers(db, snap, {
  teamIds,
  logger: createLogger({ module: "mysql-import" }, () => {}),
});
await db.close();

console.log(
  `[mysql] ${dryRun ? "DRY-RUN (yazılmadı)" : config.databaseUrl ? "postgres" : `pglite (${config.pgliteDir})`}`,
);
console.log(
  `[mysql] müşteriler: ${report.customers.created} açıldı, ${report.customers.existing} zaten vardı (${report.customers.reassigned} sorumlusu düzeltildi), ${report.customers.skipped.length} atlandı, ${report.customers.stageErrors.length} aşama hatası`,
);
console.log(
  `[mysql] talepler: ${report.clients.created} açıldı, ${report.clients.existing} zaten vardı (${report.clients.reassigned} sorumlusu düzeltildi), ${report.clients.skipped.length} atlandı`,
);
console.log(
  `[mysql] aşamalar: ${Object.entries(report.stages)
    .map(([k, v]) => `${k}×${v}`)
    .join(", ")}`,
);
if (report.unknownOwners.length)
  console.log(`[mysql] kullanıcı tablosunda olmayan kimlikler (havuza düştü): ${report.unknownOwners.join(", ")}`);
const skipped = [...report.customers.skipped, ...report.clients.skipped, ...report.customers.stageErrors];
if (skipped.length) {
  const byReason = new Map<string, number>();
  for (const s of skipped) byReason.set(s.reason, (byReason.get(s.reason) ?? 0) + 1);
  console.log(`[mysql] atlanma nedenleri: ${[...byReason].map(([r, n]) => `${r}×${n}`).join(", ")}`);
}
process.exit(0);
