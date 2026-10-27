// Exercises checkLogin against the real table using one active row's own credentials.
// Prints only ok/fail and the derived name/role — never the password.
import "../server/env.mjs";
import mysql from "mysql2/promise";
import { checkLogin } from "../server/authDb.mjs";
const u = new URL(process.env.AUTH_DB_URL || "");
const c = await mysql.createConnection({
  host: u.hostname,
  port: Number(u.port) || 3306,
  user: decodeURIComponent(u.username),
  password: decodeURIComponent(u.password),
  database: u.pathname.slice(1),
});
const [[active]] = await c.query(
  "select KullaniciAdi, Email, Sifre from KullaniciBilgileri where Durum='Aktif' and YetkiTuru='Temsilci' limit 1",
);
const [[passive]] = await c.query("select KullaniciAdi, Sifre from KullaniciBilgileri where Durum='Pasif' limit 1");
await c.end();
const show = (label, r) =>
  console.log(
    label,
    JSON.stringify({
      ok: r.ok,
      inactive: r.inactive,
      name: r.name,
      email: r.email,
      isAdmin: r.isAdmin,
      role: r.roleLabel,
    }),
  );
show("username+ok  ", await checkLogin(active.KullaniciAdi, active.Sifre));
show("EMAIL+ok     ", await checkLogin(active.Email.toUpperCase(), active.Sifre));
show("wrong pass   ", await checkLogin(active.KullaniciAdi, active.Sifre + "x"));
show("unknown user ", await checkLogin("nobody", "x"));
show("passive user ", await checkLogin(passive.KullaniciAdi, passive.Sifre));
process.exit(0);
