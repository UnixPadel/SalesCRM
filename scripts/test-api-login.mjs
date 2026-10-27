// End-to-end login test against the running API (port 8787) using rows from the real table.
// Prints statuses, names and roles only — never a password. Usage: node scripts/test-api-login.mjs
import "../server/env.mjs";
import mysql from "mysql2/promise";
const API = process.env.API_URL || "http://localhost:8787";
const u = new URL(process.env.AUTH_DB_URL || "");
const c = await mysql.createConnection({
  host: u.hostname,
  port: Number(u.port) || 3306,
  user: decodeURIComponent(u.username),
  password: decodeURIComponent(u.password),
  database: u.pathname.slice(1),
});
const pick = async (where) =>
  (await c.query(`select KullaniciAdi, Email, Sifre, YetkiTuru from KullaniciBilgileri where ${where} limit 1`))[0][0];
const rep = await pick("Durum='Aktif' and YetkiTuru='Temsilci'");
const boss = await pick("Durum='Aktif' and KullaniciAdi='elshan.rasulov'");
const viewer = await pick("Durum='Aktif' and YetkiTuru='Muhasebe'");
const passive = await pick("Durum='Pasif'");
await c.end();

async function login(login, password) {
  const r = await fetch(API + "/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: login, password }),
  });
  const j = await r.json().catch(() => ({}));
  const cookie = (r.headers.get("set-cookie") || "").split(";")[0];
  return { status: r.status, user: j.user, error: j.error, cookie };
}
const show = (label, r) =>
  console.log(label.padEnd(26), r.status, r.user ? `${r.user.name} / ${r.user.role}` : r.error);

const a = await login(rep.KullaniciAdi, rep.Sifre);
show("rep (username)", a);
show("rep (EMAIL)", await login(rep.Email.toUpperCase(), rep.Sifre));
show("rep wrong password", await login(rep.KullaniciAdi, rep.Sifre + "x"));
const b = await login(boss.KullaniciAdi, boss.Sifre);
show("elshan.rasulov", b);
const v = await login(viewer.KullaniciAdi, viewer.Sifre);
show("muhasebe (viewer)", v);
show("passive user", await login(passive.KullaniciAdi, passive.Sifre));

const roster = await fetch(API + "/api/users", { headers: { cookie: b.cookie } }).then((r) => r.json());
console.log("roster:", roster.map((t) => `${t.name}(${t.role})`).join(", "));

// a viewer may read but not write
const deals = await fetch(API + "/api/db/deals", { headers: { cookie: v.cookie } }).then((r) => r.json());
const w = await fetch(API + "/api/db/deals/" + deals[0].id, {
  method: "PATCH",
  headers: { cookie: v.cookie, "content-type": "application/json" },
  body: JSON.stringify({ notes: "x" }),
});
console.log("viewer read:", Array.isArray(deals) ? deals.length + " deals" : deals, "| viewer write:", w.status);
process.exit(0);
