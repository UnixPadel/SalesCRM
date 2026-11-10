// Lists the tables of the company MySQL database (AUTH_DB_URL in .env) and describes the ones that
// look like customer tables. Prints structure, row counts and a few masked sample rows; never passwords.
// Usage: node scripts/inspect-mysql.mjs [table]
import "../server/env.mjs";
import mysql from "mysql2/promise";

const u = new URL(process.env.AUTH_DB_URL || "");
const conn = await mysql.createConnection({
  host: u.hostname,
  port: Number(u.port) || 3306,
  user: decodeURIComponent(u.username),
  password: decodeURIComponent(u.password),
  database: u.pathname.slice(1),
  connectTimeout: 15000,
});
const only = process.argv[2];
const [tables] = await conn.query("SHOW TABLE STATUS");
console.log("tables:");
for (const t of tables) console.log(`  ${t.Name.padEnd(32)} rows≈${t.Rows}`);

const secret = /sifre|parola|pass|pwd|hash|token/i;
const pick = only
  ? tables.filter((t) => t.Name === only)
  : tables.filter((t) => /musteri|customer|firma|cari|kisi|contact|lead/i.test(t.Name));
for (const t of pick) {
  console.log(`\n== ${t.Name}`);
  const [cols] = await conn.query(`SHOW COLUMNS FROM \`${t.Name}\``);
  for (const c of cols)
    console.log(`  ${c.Field.padEnd(28)} ${c.Type}${c.Null === "NO" ? "  not null" : ""}${c.Key ? "  " + c.Key : ""}`);
  const [[{ n }]] = await conn.query(`SELECT COUNT(*) AS n FROM \`${t.Name}\``);
  console.log(`  rows: ${n}`);
  const [rows] = await conn.query(`SELECT * FROM \`${t.Name}\` ORDER BY 1 DESC LIMIT 3`);
  for (const r of rows) {
    const safe = Object.fromEntries(
      Object.entries(r).map(([k, v]) => [
        k,
        secret.test(k) ? "<gizli>" : typeof v === "string" && v.length > 60 ? v.slice(0, 60) + "…" : v,
      ]),
    );
    console.log("  " + JSON.stringify(safe));
  }
}
await conn.end();
