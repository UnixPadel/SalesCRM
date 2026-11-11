// Unixpadel CRM server.
//  - Login = IMAP login to the company mail server. Nobody has to hand over passwords:
//    each rep types their own at login, it is held in this process's memory for the session
//    and is never written to disk or sent anywhere except mail.unixpadel.com.
//  - The local "Admin" account (admin@unixpadel.com) has no mailbox: its password lives in
//    server/data/config.json (or CRM_ADMIN_PASSWORD).
//  - /api/mail/* e-mails exchanged with a customer, read live from a mailbox
import "./env.mjs";
import express from "express";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { authDbEnabled, authDbLabel, checkLogin, checkTable, listDirectory, listTeam } from "./authDb.mjs";
import { emailsOf, USERS, userFor } from "./users.mjs";
import { bootSalesPipeline } from "../src/bootstrap/salesPipeline.ts";
import { bootLeadIntake } from "../src/bootstrap/leadIntake.ts";
import { bootAdFeedback } from "../src/bootstrap/adFeedback.ts";
import { bootSheetSync } from "../src/bootstrap/sheetSync.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// API_PORT (not PORT): dev tooling sets PORT for the Vite dev server.
const PORT = Number(process.env.API_PORT) || 8787;
const IMAP_HOST = process.env.IMAP_HOST || "mail.unixpadel.com";
const IMAP_PORT = Number(process.env.IMAP_PORT) || 993;
const MAIL_DOMAIN = (process.env.MAIL_DOMAIN || "unixpadel.com").toLowerCase();
const DATA_DIR = path.join(__dirname, "data");
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

/**
 * Kullanıcı rehberi (bildirim e-postaları): KullaniciID → ad, e-posta. Şirket tablosu 5 dakika önbellekte;
 * tablo kapalıysa boş döner (e-posta gönderilmez, uygulama içi bildirim yine yazılır).
 */
function userDirectory() {
  let cache = { at: 0, rows: [] };
  const team = async () => {
    if (Date.now() - cache.at > 5 * 60_000) {
      try {
        cache = { at: Date.now(), rows: authDbEnabled() ? await listTeam() : [] };
      } catch (e) {
        console.warn("[crm] kullanıcı rehberi okunamadı:", e?.message || e);
        cache.at = Date.now();
      }
    }
    return cache.rows;
  };
  return {
    async findById(id) {
      const r = (await team()).find((u) => String(u.id) === String(id));
      return r
        ? { id: String(r.id), name: `${r.first} ${r.last}`.trim() || r.login, email: r.email || null }
        : undefined;
    },
  };
}

/**
 * Ekip dizini (Faz 7g): Özet rapor satırları (aktif satış kullanıcıları) ve bölge atamasında pasif kullanıcı.
 * 5 dk önbellek; tablo kapalıysa ya da okunamazsa null (fail-open: süzme yapılmaz).
 */
function teamDirectory() {
  let cache = { at: 0, rows: null };
  const rows = async () => {
    if (!authDbEnabled()) return null;
    if (Date.now() - cache.at > 5 * 60_000) {
      try {
        cache = { at: Date.now(), rows: await listDirectory() };
      } catch (e) {
        console.warn("[crm] ekip dizini okunamadı:", e?.message || e);
        cache = { at: Date.now(), rows: cache.rows };
      }
    }
    return cache.rows;
  };
  return {
    async activeSalesUserIds() {
      const r = await rows();
      return r ? r.filter((u) => u.active && u.role !== "viewer").map((u) => u.id) : null;
    },
    async inactiveUserIds() {
      const r = await rows();
      return r ? new Set(r.filter((u) => !u.active).map((u) => u.id)) : null;
    },
    rows,
  };
}
const team = teamDirectory();

/* ---------------- app ---------------- */

const app = express();
app.disable("x-powered-by");

/* ---- satış pipeline'ı ve gelen lead akışı (src/modules) ----
 * Webhook'lar ve web formu ucu oturumsuzdur ve imza için ham gövde ister: genel JSON ayrıştırıcıdan
 * ÖNCE bağlanır. İnternete yalnız /webhooks/* ve /forms/* açılır (ADR-0005). */
const salesPipeline = await bootSalesPipeline({ users: userDirectory(), team });
const leadIntake = bootLeadIntake(salesPipeline);
app.use("/webhooks", leadIntake.webhooks);
app.use("/forms", leadIntake.forms);
/* Giden olaylar (Faz 4): dakikalık dağıtıcı ve günlük dead-letter raporu aynı süreçte. */
bootAdFeedback(salesPipeline, leadIntake.settings);
/* Form tablosu (Google E-Tablolar'daki Meta form dökümü) → CRM; SHEET_SYNC_CSV_URL yoksa kapalı. */
const sheetSync = bootSheetSync(salesPipeline);

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
app.get("/api/users", auth, async (req, res) => {
  // Faz 7g: ?all=1 pasifler dahil bütün dizin (ad gösterimi "Sena (pasif)"); yalnız yönetici ve görüntüleyici.
  if (req.query.all === "1") {
    const role = req.session?.role;
    if (role !== "admin" && role !== "viewer")
      return res.status(403).json({ error: "Yalnız yönetici.", code: "admin_only" });
    const rows = await team.rows();
    if (!rows) {
      return res.json(
        USERS.filter((u) => !u.local).map((u) => ({
          id: u.emails[0],
          name: u.name,
          email: u.emails[0],
          role: u.role,
          active: true,
        })),
      );
    }
    return res.json(
      rows.map((r) => ({ id: r.id, name: r.first || r.login, email: r.email, role: r.role, active: r.active })),
    );
  }
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

/* ---- veri: tamamı satış pipeline'ında (Postgres). Eski /api/db/* JSON deposu Faz 6d ile kaldırıldı. ---- */

/* ---- form tablosu eşitlemesi: durum (yönetici ve görüntüleyici) ve elle tetikleme (yönetici). Adres hiç dönmez. ---- */
app.get("/api/sheet-sync", auth, (req, res) => {
  const role = req.session?.role;
  if (role !== "admin" && role !== "viewer")
    return res.status(403).json({ error: "Yalnız yönetici.", code: "admin_only" });
  res.json(sheetSync ? sheetSync.status() : { enabled: false });
});
app.post("/api/sheet-sync/run", auth, async (req, res) => {
  if (req.session?.role !== "admin") return res.status(403).json({ error: "Yalnız yönetici.", code: "admin_only" });
  if (!sheetSync)
    return res.status(409).json({ error: "Form tablosu eşitlemesi kapalı.", code: "sheet_sync.disabled" });
  res.json(await sheetSync.runNow());
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
  console.log(`[crm] server on http://localhost:${PORT}`);
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
