// Login against the company user table in the Clever Cloud MySQL database.
//
//   KullaniciBilgileri: KullaniciID, Durum ('Aktif'|'Pasif'), KullaniciAdi, Ad, Soyad, Sifre (plain),
//                       Email, Telefon, YetkiTuru ('Yonetici'|'Temsilci'|'Muhasebe'|'Fabrika'|'Lojistik'|'Gozlemci'), …
//
//   AUTH_DB_URL   mysql://user:pass@host:port/dbname   (postgres:// also works)
//   AUTH_DB_TABLE default KullaniciBilgileri; column names below can be overridden with AUTH_DB_*_COL.
//
// People log in with KullaniciAdi OR Email, plus Sifre. Only Durum = 'Aktif' rows may log in.
// Passwords are plain text in that table (customer's decision): the comparison happens here in
// the server; the password never reaches the browser or the logs.

const env = (k, d) => process.env[k] || d;
const TABLE = env("AUTH_DB_TABLE", "KullaniciBilgileri");
const COL = {
  user: env("AUTH_DB_USER_COL", "KullaniciAdi"),
  email: env("AUTH_DB_EMAIL_COL", "Email"),
  pass: env("AUTH_DB_PASS_COL", "Sifre"),
  first: env("AUTH_DB_FIRSTNAME_COL", "Ad"),
  last: env("AUTH_DB_LASTNAME_COL", "Soyad"),
  role: env("AUTH_DB_ROLE_COL", "YetkiTuru"),
  active: env("AUTH_DB_ACTIVE_COL", "Durum"),
};
/** Role values that make someone an admin of the board; everyone else is a sales rep. */
const ADMIN_ROLES = env("AUTH_DB_ADMIN_ROLES", "Yonetici").split(",").map((s) => s.trim().toLowerCase());
const ACTIVE_VALUE = env("AUTH_DB_ACTIVE_VALUE", "Aktif").toLowerCase();

const url = () => process.env.AUTH_DB_URL || "";
export const authDbEnabled = () => !!url();
export const authDbLabel = () => url().replace(/\/\/([^:]+):[^@]*@/, "//$1:***@");
export const authDbColumns = () => ({ table: TABLE, ...COL, adminRoles: ADMIN_ROLES, activeValue: ACTIVE_VALUE });

let driver = null; // { quote(id), query(sql, params) -> rows[] }

async function connect() {
  if (driver) return driver;
  const u = new URL(url());
  const ssl = process.env.AUTH_DB_SSL ? { rejectUnauthorized: false } : undefined;
  if (/^mysql/.test(u.protocol)) {
    const mysql = await import("mysql2/promise");
    const pool = mysql.createPool({
      host: u.hostname,
      port: Number(u.port) || 3306,
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      database: u.pathname.replace(/^\//, ""),
      ssl,
      connectionLimit: 3,
      connectTimeout: 10000,
    });
    driver = {
      quote: (id) => "`" + String(id).replace(/`/g, "``") + "`",
      query: async (sql, params = []) => (await pool.query(sql, params))[0],
    };
  } else if (/^postgres/.test(u.protocol)) {
    const { default: pg } = await import("pg");
    const pool = new pg.Pool({ connectionString: url(), ssl, max: 3, connectionTimeoutMillis: 10000 });
    driver = {
      quote: (id) => '"' + String(id).replace(/"/g, '""') + '"',
      query: async (sql, params = []) => {
        let i = 0;
        return (await pool.query(sql.replace(/\?/g, () => `$${++i}`), params)).rows;
      },
    };
  } else {
    throw new Error(`AUTH_DB_URL şeması desteklenmiyor: ${u.protocol} (mysql:// ya da postgres:// kullanın)`);
  }
  return driver;
}

/** Roles that may own customers on the board (the sales team); other active users log in as viewers. */
const SALES_ROLES = env("AUTH_DB_SALES_ROLES", "Yonetici,Temsilci").split(",").map((s) => s.trim().toLowerCase());
export const roleKind = (roleLabel) => {
  const r = String(roleLabel ?? "").toLowerCase();
  return ADMIN_ROLES.includes(r) ? "admin" : SALES_ROLES.includes(r) ? "rep" : "viewer";
};

/** Active users who may own customers: [{ login, email, first, last, role }]. */
export async function listTeam() {
  const d = await connect();
  const q = d.quote;
  const rows = await d.query(
    `select ${q(COL.user)} as login, ${q(COL.email)} as email, ${q(COL.first)} as first, ${q(COL.last)} as last, ${q(COL.role)} as role
       from ${q(TABLE)} where lower(${q(COL.active)}) = ? order by ${q(COL.first)}`,
    [ACTIVE_VALUE],
  );
  return rows
    .map((r) => ({ login: String(r.login ?? ""), email: String(r.email ?? "").toLowerCase(), first: String(r.first ?? "").trim(), last: String(r.last ?? "").trim(), role: roleKind(r.role) }))
    .filter((r) => r.role !== "viewer");
}

/** Quick connectivity + column check for the startup log. Returns the row count. */
export async function checkTable() {
  const d = await connect();
  const q = d.quote;
  const cols = [COL.user, COL.email, COL.pass, COL.first, COL.last, COL.role, COL.active].map(q).join(", ");
  const rows = await d.query(`select count(*) as n from (select ${cols} from ${q(TABLE)}) t`);
  return Number(rows[0]?.n ?? rows[0]?.N ?? 0);
}

/**
 * Checks a login (username or e-mail, case-insensitive) against the table.
 * Returns { ok: true, name, email, isAdmin } | { ok: false, inactive?: true }.
 * Display name = first name; a surname initial is added only when another active user shares it,
 * so names stay the short "Elshan" / "Salah" form the board already uses as `owner`.
 */
export async function checkLogin(login, password) {
  const d = await connect();
  const q = d.quote;
  const key = String(login).trim().toLowerCase();
  const rows = await d.query(
    `select * from ${q(TABLE)} where lower(${q(COL.user)}) = ? or lower(${q(COL.email)}) = ? limit 5`,
    [key, key],
  );
  const row = rows.find((r) => String(r[COL.pass] ?? "") === password);
  if (!row) return { ok: false };
  if (String(row[COL.active] ?? "").toLowerCase() !== ACTIVE_VALUE) return { ok: false, inactive: true };

  const first = String(row[COL.first] ?? "").trim();
  const last = String(row[COL.last] ?? "").trim();
  let name = first || String(row[COL.user] ?? key);
  const twins = await d.query(
    `select count(*) as n from ${q(TABLE)} where lower(${q(COL.first)}) = ? and lower(${q(COL.active)}) = ? and ${q(COL.user)} <> ?`,
    [first.toLowerCase(), ACTIVE_VALUE, row[COL.user]],
  );
  if (Number(twins[0]?.n ?? 0) > 0 && last) name = `${first} ${last[0].toLocaleUpperCase("tr")}.`;

  const role = roleKind(row[COL.role]);
  return { ok: true, name, email: String(row[COL.email] ?? "").toLowerCase(), role, isAdmin: role === "admin", roleLabel: row[COL.role] };
}
