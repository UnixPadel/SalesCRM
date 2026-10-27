// Sales team: login address → display name + role. Mirrors USERS in src/domain/constants.ts.
//  admin: sees and controls everything (all reps' customers, reassigning, deleting, data reset).
//  rep:   own customers + the shared pool.
export const USERS = [
  { name: "Admin", emails: ["admin@unixpadel.com"], role: "admin", local: true },
  { name: "Elshan", emails: ["elshan@unixpadel.com"], role: "admin" },
  { name: "Salah", emails: ["export3@unixpadel.com"], role: "rep" },
  { name: "Yuşa", emails: ["yusa@unixpadel.com", "yusa.bedir@unixpadel.com"], role: "rep" },
  { name: "Ahlem", emails: ["export2@unixpadel.com"], role: "rep" },
];

/** Login name → team member. Matches a full address or just its local part ("elshan" = elshan@…). */
export function userFor(email) {
  const e = String(email).trim().toLowerCase();
  const u = USERS.find((x) => x.emails.includes(e) || (!e.includes("@") && x.emails.some((m) => m.split("@")[0] === e)));
  if (u) return { name: u.name, role: u.role, local: !!u.local };
  const local = e.split("@")[0] || e;
  return { name: local.charAt(0).toUpperCase() + local.slice(1), role: "rep", local: false };
}

/** All login addresses of a rep (for reading their mailbox with an IMAP master user). */
export const emailsOf = (name) => USERS.find((u) => u.name === name)?.emails ?? [];
