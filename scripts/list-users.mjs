// Lists who can log in (no passwords). Usage: node scripts/list-users.mjs
import "../server/env.mjs";
import mysql from "mysql2/promise";
const u = new URL(process.env.AUTH_DB_URL || "");
const c = await mysql.createConnection({ host: u.hostname, port: Number(u.port) || 3306, user: decodeURIComponent(u.username), password: decodeURIComponent(u.password), database: u.pathname.slice(1) });
const [rows] = await c.query("select KullaniciAdi, Ad, Soyad, Email, YetkiTuru, Durum from KullaniciBilgileri order by Durum, YetkiTuru, Ad");
for (const r of rows) console.log(`${r.Durum.padEnd(6)} ${r.YetkiTuru.padEnd(9)} ${r.Ad} ${r.Soyad}  (${r.KullaniciAdi}, ${r.Email})`);
await c.end();
