// Unixpadel CRM server.
//  - Login = IMAP login to the company mail server. Nobody has to hand over passwords:
//    each rep types their own at login, it is held in this process's memory for the session
//    and is never written to disk or sent anywhere except mail.unixpadel.com.
//  - The local "Admin" account (admin@unixpadel.com) has no mailbox: its password lives in
//    server/data/config.json (or CRM_ADMIN_PASSWORD).
//  - /api/db/*   shared JSON store for the whole team (server/data/crm.json)
//  - /api/mail/* e-mails exchanged with a customer, read live from a mailbox
import "./env.mjs";
import express from "express";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { authDbEnabled, authDbLabel, checkLogin, checkTable, listTeam } from "./authDb.mjs";
import { emailsOf, USERS, userFor } from "./users.mjs";
import { bootSalesPipeline } from "../src/bootstrap/salesPipeline.ts";
import { bootLeadIntake } from "../src/bootstrap/leadIntake.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// API_PORT (not PORT): dev tooling sets PORT for the Vite dev server.
const PORT = Number(process.env.API_PORT) || 8787;
const IMAP_HOST = process.env.IMAP_HOST || "mail.unixpadel.com";
const IMAP_PORT = Number(process.env.IMAP_PORT) || 993;
const MAIL_DOMAIN = (process.env.MAIL_DOMAIN || "unixpadel.com").toLowerCase();
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = process.env.CRM_DATA || path.join(DATA_DIR, "crm.json");
const CONFIG_FILE = path.join(DATA_DIR, "config.json");
// Optional Dovecot "master user": lets admins read a rep's mailbox without the rep's password.
// Login becomes "<rep address>*<master user>" with the master password.
const IMAP_MASTER_USER = process.env.IMAP_MASTER_USER || "";
const IMAP_MASTER_PASSWORD = process.env.IMAP_MASTER_PASSWORD || "";
/** E-mail reading is paused for now: set MAIL_ENABLED=1 to bring the IMAP features back. */
const MAIL_ENABLED = process.env.MAIL_ENABLED === "1";
const SESSION_TTL = 12 * 3600e3;
const MAIL_CACHE_TTL = 90e3;
const LIST_LIMIT = 40; // newest messages per folder
/** Free-mail domains: searching by domain would match unrelated people, so match the full address. */
const FREEMAIL =
  /^(gmail|googlemail|hotmail|outlook|live|msn|yahoo|icloud|me|mac|aol|proton|protonmail|gmx|web|yandex|mail|zoho)\./i;

/* ---------------- local config (admin password) ---------------- */

function loadConfig() {
  mkdirSync(DATA_DIR, { recursive: true });
  let cfg = {};
  try {
    if (existsSync(CONFIG_FILE)) cfg = JSON.parse(readFileSync(CONFIG_FILE, "utf8"));
  } catch (e) {
    console.error("[config] could not read", CONFIG_FILE, e.message);
  }
  if (!cfg.adminPassword) {
    cfg.adminPassword = randomBytes(9).toString("base64url");
    writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
    console.log(`[crm] Admin hesabı için şifre üretildi → ${CONFIG_FILE} (adminPassword alanı; değiştirebilirsiniz)`);
  }
  return cfg;
}
const config = loadConfig();
const adminPassword = () => process.env.CRM_ADMIN_PASSWORD || config.adminPassword;

/* ---------------- shared JSON store ---------------- */

const TABLES = ["organizations", "contacts", "leads", "deals", "activities", "stageChanges"];
const emptyDb = () => ({ seeded: false, tables: Object.fromEntries(TABLES.map((t) => [t, []])) });

function loadDb() {
  try {
    if (!existsSync(DATA_FILE)) return emptyDb();
    const parsed = JSON.parse(readFileSync(DATA_FILE, "utf8"));
    const db = emptyDb();
    db.seeded = !!parsed.seeded;
    for (const t of TABLES) if (Array.isArray(parsed.tables?.[t])) db.tables[t] = parsed.tables[t];
    return db;
  } catch (e) {
    console.error("[db] could not read", DATA_FILE, e.message);
    return emptyDb();
  }
}
const db = loadDb();
let saveTimer = null;
function flush() {
  saveTimer = null;
  mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  const tmp = DATA_FILE + ".tmp";
  writeFileSync(tmp, JSON.stringify(db));
  renameSync(tmp, DATA_FILE);
}
function save() {
  if (!saveTimer) saveTimer = setTimeout(flush, 150);
}
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    if (saveTimer) flush();
    process.exit(0);
  });
}

/* ---------------- sessions (memory only) ---------------- */

const sessions = new Map();
function cookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function auth(req, res, next) {
  const s = sessions.get(cookies(req).crm_sid);
  if (!s || s.expires < Date.now()) {
    if (s) sessions.delete(cookies(req).crm_sid);
    return res.status(401).json({ error: "Oturum açılmamış ya da süresi dolmuş." });
  }
  s.expires = Date.now() + SESSION_TTL;
  req.session = s;
  next();
}
const adminOnly = (req, res, next) =>
  req.session.role === "admin" ? next() : res.status(403).json({ error: "Bu işlem için admin yetkisi gerekir." });
setInterval(() => {
  for (const [k, s] of sessions) if (s.expires < Date.now()) sessions.delete(k);
}, 600e3).unref();

/* ---------------- IMAP helpers ---------------- */

const imapClient = (user, pass) =>
  new ImapFlow({
    host: IMAP_HOST,
    port: IMAP_PORT,
    secure: true,
    auth: { user, pass },
    logger: false,
    emitLogs: false,
    connectionTimeout: 15000,
    greetingTimeout: 10000,
    socketTimeout: 90000,
  });

/**
 * Which mailbox a request may read, and with which credentials.
 *  - own mailbox: the session's own login.
 *  - another rep's mailbox (admins only): needs the IMAP master user.
 */
function mailboxAuth(session, mailbox) {
  const own = !mailbox || mailbox === session.email;
  if (own) {
    if (session.local)
      return {
        error:
          "Admin hesabının posta kutusu yok. Bir satışçının kutusunu okumak için IMAP master kullanıcı tanımlayın.",
      };
    return { user: session.email, pass: session.password, label: session.email };
  }
  if (session.role !== "admin") return { error: "Başka bir satışçının posta kutusunu yalnız admin okuyabilir." };
  if (!IMAP_MASTER_USER || !IMAP_MASTER_PASSWORD)
    return {
      error: `${mailbox} kutusunu okumak için sunucuda IMAP_MASTER_USER / IMAP_MASTER_PASSWORD tanımlı olmalı (Dovecot master user).`,
    };
  return { user: `${mailbox}*${IMAP_MASTER_USER}`, pass: IMAP_MASTER_PASSWORD, label: mailbox };
}

/** Runs `fn` with a fresh IMAP connection, one operation at a time per session. */
function withImap(session, creds, fn) {
  const run = async () => {
    const c = imapClient(creds.user, creds.pass);
    await c.connect();
    try {
      return await fn(c);
    } finally {
      try {
        await c.logout();
      } catch {
        /* connection already gone */
      }
    }
  };
  const p = session.queue.then(run, run);
  session.queue = p.catch(() => {});
  return p;
}

const fmtAddr = (list) =>
  (list || [])
    .map((a) => (a.name ? `${a.name} <${a.address}>` : a.address || ""))
    .filter(Boolean)
    .join(", ");

function countAttachments(node) {
  if (!node) return 0;
  let n = node.disposition === "attachment" ? 1 : 0;
  for (const child of node.childNodes || []) n += countAttachments(child);
  return n;
}

/** Human-readable reason for a failed mailbox read. */
function mailError(e) {
  if (e?.authenticationFailed || e?.responseStatus === "NO")
    return "Posta sunucusu bu oturumun şifresini kabul etmedi. Çıkış yapıp posta şifrenizle yeniden girin.";
  if (e?.code === "ETIMEOUT" || e?.code === "ECONNREFUSED" || e?.code === "ENOTFOUND")
    return `Posta sunucusuna (${IMAP_HOST}) ulaşılamadı.`;
  return e?.responseText || e?.message || "bilinmeyen hata";
}

function htmlToText(html) {
  return html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/* ---------------- app ---------------- */

const app = express();
app.disable("x-powered-by");

/* ---- satış pipeline'ı ve gelen lead akışı (src/modules) ----
 * Webhook'lar oturumsuzdur ve imza için ham gövde ister: genel JSON ayrıştırıcıdan ÖNCE bağlanır. */
const salesPipeline = await bootSalesPipeline();
const leadIntake = bootLeadIntake(salesPipeline);
app.use("/webhooks", leadIntake.webhooks);

app.use(express.json({ limit: "25mb" }));

const publicUser = (s) => ({
  id: s.userId,
  email: s.email,
  name: s.name,
  role: s.role,
  hasMailbox: MAIL_ENABLED && !s.local && s.email.includes("@"),
});

/**
 * Login. Three sources, in this order:
 *   1. the local Admin account (admin@domain + config.json password)
 *   2. the company user table when AUTH_DB_URL is set (KullaniciBilgileri: username + plain password)
 *   3. otherwise the mail server (IMAP), as before
 * CRM_DEV_PASSWORD (local testing only) accepts that password for anyone.
 */
app.post("/api/auth/login", async (req, res) => {
  let email = String(req.body?.email || "")
    .trim()
    .toLowerCase(); // login name; becomes the row's e-mail after a table login
  const password = String(req.body?.password || "");
  if (!email) return res.status(400).json({ error: "Kullanıcı adı girin." });
  if (!password) return res.status(400).json({ error: "Şifre girin." });
  const who = userFor(email);

  const devBypass = process.env.CRM_DEV_PASSWORD && password === process.env.CRM_DEV_PASSWORD;
  if (who.local) {
    if (password !== adminPassword()) return res.status(401).json({ error: "Admin şifresi hatalı." });
  } else if (devBypass) {
    /* accepted */
  } else if (authDbEnabled()) {
    let r;
    try {
      r = await checkLogin(email, password);
    } catch (e) {
      console.error("[login/db]", e.message);
      return res.status(502).json({ error: "Kullanıcı veritabanına bağlanılamadı: " + e.message });
    }
    if (!r.ok)
      return res
        .status(r.inactive ? 403 : 401)
        .json({ error: r.inactive ? "Bu hesap pasif. Yöneticinize başvurun." : "Kullanıcı adı ya da şifre hatalı." });
    // Known team members keep the spelling the board already uses as `owner` ("Yuşa"), others use the table's first name.
    const known = r.email ? userFor(r.email) : null;
    who.name =
      known && known.name !== r.email.split("@")[0].replace(/^./, (c) => c.toUpperCase()) ? known.name : r.name;
    who.role = r.role === "admin" || known?.role === "admin" ? "admin" : r.role;
    who.id = r.id;
    if (r.email) email = r.email;
  } else {
    if (!email.endsWith("@" + MAIL_DOMAIN))
      return res.status(400).json({ error: `Yalnız @${MAIL_DOMAIN} adresleriyle giriş yapılabilir.` });
    const c = imapClient(email, password);
    try {
      await c.connect();
      await c.logout();
    } catch (e) {
      if (e.authenticationFailed || e.responseStatus === "NO")
        return res.status(401).json({ error: "E-posta ya da şifre hatalı." });
      console.error("[login]", e.message);
      return res.status(502).json({ error: "Posta sunucusuna bağlanılamadı: " + e.message });
    }
  }
  const sid = randomBytes(24).toString("base64url");
  const session = {
    email,
    // Kalıcı kimlik: kullanıcı tablosundaki KullaniciID; yerel Admin "admin"; IMAP/dev girişinde e-posta.
    userId: who.local ? "admin" : who.id || email,
    name: who.name,
    role: who.role,
    local: who.local,
    password: who.local ? "" : password,
    expires: Date.now() + SESSION_TTL,
    queue: Promise.resolve(),
    cache: new Map(),
  };
  sessions.set(sid, session);
  res.setHeader("set-cookie", `crm_sid=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL / 1000}`);
  res.json({ user: publicUser(session) });
});

app.get("/api/auth/me", (req, res) => {
  const s = sessions.get(cookies(req).crm_sid);
  if (!s || s.expires < Date.now()) return res.status(401).json({ error: "Oturum yok." });
  res.json({ user: publicUser(s) });
});

app.post("/api/auth/logout", (req, res) => {
  sessions.delete(cookies(req).crm_sid);
  res.setHeader("set-cookie", "crm_sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
  res.status(204).end();
});

/* ---- mail ---- */

const MAIL_PAUSED = { error: "E-posta okuma şimdilik kapalı (MAIL_ENABLED=1 ile açılır).", noMailbox: true };
const mailOn = (_req, res, next) => (MAIL_ENABLED ? next() : res.status(503).json(MAIL_PAUSED));

/** Which search pattern to use: a company domain catches colleagues of the contact too. */
function searchPattern(address) {
  const domain = address.split("@")[1] || "";
  if (!domain || FREEMAIL.test(domain)) return { pattern: address, byDomain: false };
  return { pattern: "@" + domain, byDomain: true };
}

app.get("/api/mail", auth, mailOn, async (req, res) => {
  const address = String(req.query.address || "")
    .trim()
    .toLowerCase();
  if (!address.includes("@")) return res.status(400).json({ error: "Geçerli bir e-posta adresi gerekli." });
  const mailbox = String(req.query.mailbox || "")
    .trim()
    .toLowerCase();
  const creds = mailboxAuth(req.session, mailbox);
  if (creds.error) return res.status(409).json({ error: creds.error, noMailbox: true });

  const s = req.session;
  const key = `${creds.label}|${address}`;
  const cached = s.cache.get(key);
  if (cached && cached.at > Date.now() - MAIL_CACHE_TTL && !req.query.refresh) return res.json(cached.result);

  const { pattern, byDomain } = searchPattern(address);
  try {
    const result = await withImap(s, creds, async (c) => {
      const boxes = await c.list();
      const sentBox = boxes.find((b) => b.specialUse === "\\Sent") || boxes.find((b) => /(^|[./])sent/i.test(b.path));
      const list = [];
      const scanned = [];
      const collect = async (folder, query, direction) => {
        const lock = await c.getMailboxLock(folder);
        try {
          scanned.push({ folder, total: c.mailbox?.exists ?? 0 });
          let uids = await c.search(query, { uid: true });
          if (!uids || !uids.length) return;
          uids = uids.slice(-LIST_LIMIT);
          for await (const m of c.fetch(uids, { uid: true, envelope: true, bodyStructure: true }, { uid: true })) {
            const env = m.envelope || {};
            list.push({
              id: `${folder}:${m.uid}`,
              folder,
              uid: m.uid,
              direction,
              from: fmtAddr(env.from),
              to: fmtAddr(env.to),
              subject: env.subject || "(konu yok)",
              date: (env.date ? new Date(env.date) : new Date()).toISOString(),
              attachments: countAttachments(m.bodyStructure),
            });
          }
        } finally {
          lock.release();
        }
      };
      await collect("INBOX", { or: [{ from: pattern }, { cc: pattern }] }, "in");
      if (sentBox) await collect(sentBox.path, { or: [{ to: pattern }, { cc: pattern }] }, "out");
      list.sort((a, b) => b.date.localeCompare(a.date));
      return { list, scanned, pattern, byDomain, mailbox: creds.label, sentFolder: sentBox?.path ?? null };
    });
    s.cache.set(key, { at: Date.now(), result });
    res.json(result);
  } catch (e) {
    console.error("[mail]", e.message);
    res.status(502).json({ error: "Posta kutusu okunamadı: " + mailError(e) });
  }
});

app.get("/api/mail/body", auth, mailOn, async (req, res) => {
  const folder = String(req.query.folder || "");
  const uid = Number(req.query.uid);
  if (!folder || !uid) return res.status(400).json({ error: "folder ve uid gerekli." });
  const creds = mailboxAuth(
    req.session,
    String(req.query.mailbox || "")
      .trim()
      .toLowerCase(),
  );
  if (creds.error) return res.status(409).json({ error: creds.error });
  try {
    const text = await withImap(req.session, creds, async (c) => {
      const lock = await c.getMailboxLock(folder);
      try {
        const dl = await c.download(String(uid), undefined, { uid: true });
        const parsed = await simpleParser(dl.content);
        return (parsed.text && parsed.text.trim()) || htmlToText(parsed.html || "") || "(boş ileti)";
      } finally {
        lock.release();
      }
    });
    res.json({ text });
  } catch (e) {
    console.error("[mail/body]", e.message);
    res.status(502).json({ error: "İleti okunamadı: " + mailError(e) });
  }
});

/* ---- team roster (who may own customers) ---- */

let teamCache = { at: 0, list: null };
/** Active sales users from the user table; falls back to the static USERS list without a database. */
app.get("/api/users", auth, async (_req, res) => {
  if (!authDbEnabled()) {
    return res.json(
      USERS.filter((u) => !u.local).map((u) => ({ id: u.emails[0], name: u.name, email: u.emails[0], role: u.role })),
    );
  }
  if (!teamCache.list || teamCache.at < Date.now() - 300e3) {
    try {
      const rows = await listTeam();
      teamCache = {
        at: Date.now(),
        list: rows.map((r) => {
          const known = userFor(r.email);
          const generic = r.email.split("@")[0].replace(/^./, (c) => c.toUpperCase());
          return {
            id: r.id,
            name: known.name !== generic ? known.name : r.first || r.login,
            email: r.email,
            role: known.role === "admin" ? "admin" : r.role,
          };
        }),
      };
    } catch (e) {
      console.error("[users]", e.message);
      if (!teamCache.list) return res.status(502).json({ error: "Kullanıcı tablosu okunamadı: " + e.message });
    }
  }
  res.json(teamCache.list);
});

/* ---- shared data ---- */

app.get("/api/db-meta", auth, (_req, res) => res.json({ seeded: db.seeded }));
app.post("/api/db-meta/seeded", auth, (_req, res) => {
  db.seeded = true;
  save();
  res.status(204).end();
});
app.post("/api/db-meta/reset", auth, adminOnly, (_req, res) => {
  Object.assign(db, emptyDb());
  save();
  res.status(204).end();
});

function table(req, res, next) {
  if (!TABLES.includes(req.params.table)) return res.status(404).json({ error: "Böyle bir tablo yok." });
  req.rows = db.tables[req.params.table];
  next();
}
/** Reps may change only their own rows and the shared pool; admins may change anything; viewers nothing. */
function mayWrite(session, table, row, patch) {
  if (session.role === "admin") return true;
  if (session.role === "viewer") return false;
  if (!("owner" in row)) return true;
  if (row.owner && row.owner !== session.name) return false;
  // a rep may take a pool row or keep it, but not hand it to someone else
  if (patch && "owner" in patch && patch.owner && patch.owner !== session.name) return false;
  return true;
}
const FORBIDDEN = { error: "Bu kayıt başka bir satışçıya ait. Yalnız admin değiştirebilir." };

app.get("/api/db/:table", auth, table, (req, res) => res.json(req.rows));
app.get("/api/db/:table/:id", auth, table, (req, res) => {
  const row = req.rows.find((r) => r.id === req.params.id);
  row ? res.json(row) : res.status(404).json({ error: "Kayıt bulunamadı." });
});
app.post("/api/db/:table", auth, table, (req, res) => {
  const body = req.body;
  const rows = Array.isArray(body) ? body : [body];
  for (const r of rows) {
    if (!r || typeof r.id !== "string") return res.status(400).json({ error: "Kayıtta id eksik." });
    if (req.rows.some((x) => x.id === r.id)) return res.status(409).json({ error: `${r.id} zaten var.` });
  }
  if (!Array.isArray(body) && !mayWrite(req.session, req.params.table, body)) return res.status(403).json(FORBIDDEN);
  req.rows.push(...rows);
  save();
  Array.isArray(body) ? res.status(204).end() : res.status(201).json(body);
});
app.patch("/api/db/:table/:id", auth, table, (req, res) => {
  const i = req.rows.findIndex((r) => r.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: "Kayıt bulunamadı." });
  const { id: _ignored, ...patch } = req.body || {};
  if (!mayWrite(req.session, req.params.table, req.rows[i], patch)) return res.status(403).json(FORBIDDEN);
  req.rows[i] = { ...req.rows[i], ...patch };
  save();
  res.json(req.rows[i]);
});
app.delete("/api/db/:table/:id", auth, table, (req, res) => {
  const i = req.rows.findIndex((r) => r.id === req.params.id);
  if (i >= 0) {
    if (!mayWrite(req.session, req.params.table, req.rows[i])) return res.status(403).json(FORBIDDEN);
    req.rows.splice(i, 1);
    save();
  }
  res.status(204).end();
});

app.use("/api/pipeline", auth, salesPipeline.router);

app.use("/api", (_req, res) => res.status(404).json({ error: "Bilinmeyen uç nokta." }));

/* ---- production: serve the built app ---- */
const dist = path.join(__dirname, "..", "dist");
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.use((req, res, next) => (req.method === "GET" ? res.sendFile(path.join(dist, "index.html")) : next()));
} else {
  // Development: the UI is served by Vite. Point people who open the API port at the right place.
  const uiUrl = process.env.UI_URL || "http://localhost:5173";
  app.get("/", (_req, res) => {
    res
      .status(200)
      .type("html")
      .send(
        `<!doctype html><html lang="tr"><meta charset="utf-8"><title>Unixpadel CRM API</title>
<body style="font:16px/1.5 system-ui;max-width:52ch;margin:3rem auto;padding:0 1rem">
<h1 style="font-size:1.3rem">Bu adres sadece API (port ${PORT})</h1>
<p>Arayüz geliştirme modunda Vite tarafından sunulur: <a href="${uiUrl}">${uiUrl}</a></p>
<p>Tek porttan çalıştırmak için önce arayüzü derleyin: <code>npm run build</code>, sonra <code>npm start</code>.
O zaman arayüz bu adresten açılır.</p>
</body></html>`,
      );
  });
}

app.listen(PORT, async () => {
  console.log(`[crm] server on http://localhost:${PORT}  (data ${DATA_FILE})`);
  console.log(
    MAIL_ENABLED
      ? `[crm] e-posta okuma açık (imap ${IMAP_HOST}:${IMAP_PORT})`
      : "[crm] e-posta okuma kapalı (MAIL_ENABLED=0)",
  );
  if (IMAP_MASTER_USER) console.log(`[crm] IMAP master user etkin: adminler satışçı kutularını okuyabilir`);
  if (authDbEnabled()) {
    console.log(`[crm] giriş: kullanıcı tablosu ${authDbLabel()}`);
    try {
      const n = await checkTable();
      console.log(
        `[crm] kullanıcı tablosu okundu: ${n} kayıt (KullaniciAdi/Email + Sifre, Durum=Aktif, YetkiTuru → rol)`,
      );
    } catch (e) {
      console.error("[crm] kullanıcı tablosu okunamadı:", e.message);
    }
  } else {
    console.log(`[crm] giriş: posta sunucusu (AUTH_DB_URL tanımlı değil)`);
  }
  void emailsOf;
});
