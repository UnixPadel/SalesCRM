// Describes the login table in AUTH_DB_URL (from .env). Never prints password values.
// Usage: node scripts/inspect-users.mjs
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
const table = process.env.AUTH_DB_TABLE || "KullaniciBilgileri";
const [cols] = await conn.query(`SHOW COLUMNS FROM \`${table}\``);
console.log("columns:");
for (const c of cols)
  console.log(`  ${c.Field}  ${c.Type}${c.Null === "NO" ? "  not null" : ""}${c.Key ? "  " + c.Key : ""}`);
const [[{ n }]] = await conn.query(`SELECT COUNT(*) AS n FROM \`${table}\``);
console.log("rows:", n);
const secret = /sifre|parola|pass|pwd|hash|token/i;
const [rows] = await conn.query(`SELECT * FROM \`${table}\` LIMIT 8`);
for (const r of rows) {
  const safe = Object.fromEntries(
    Object.entries(r).map(([k, v]) => [k, secret.test(k) ? (v == null ? null : `<${String(v).length} karakter>`) : v]),
  );
  console.log(JSON.stringify(safe));
}
await conn.end();
