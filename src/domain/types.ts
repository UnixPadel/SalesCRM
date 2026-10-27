// Domain entities. Field names are snake_case on purpose: they map 1:1 to the
// Postgres columns in db/schema.sql, so swapping the storage driver needs no mapping layer.

export type ID = string;
export type ISODate = string; // "2026-10-15" or full ISO timestamp

export type OrgType = "club" | "investor" | "distributor" | "contractor";
export type LeadSource = "website_form" | "instagram" | "referral" | "fair";
export type LeadStatus = "new" | "qualified" | "discarded";
/**
 * The five board columns, in order:
 *  contacted      1 — every customer we reached out to
 *  interested     2 — "green line": replied and asked for a price
 *  proforma_sent  3 — proforma sent
 *  site_visit     4 — site visit / project planning
 *  lost           5 — "red line": replied but ended negatively (reason mandatory)
 */
export type StageKey = "contacted" | "interested" | "proforma_sent" | "site_visit" | "lost";
export type ActivityType = "call" | "email" | "meeting" | "proforma_sent" | "site_visit";
export type Currency = "EUR" | "USD" | "GBP" | "TRY";
export type Urgency = "asap" | "m13" | "m36" | "m612" | "";
export type TouchState = "none" | "ok" | "fail" | "sent";

export interface Organization {
  id: ID;
  name: string;
  country: string; // ISO-3166 alpha-2
  type: OrgType;
  website: string;
  notes: string;
  created_at: ISODate;
}

export interface Contact {
  id: ID;
  name: string;
  role: string;
  email: string;
  phone: string;
  organization_id: ID | null;
  preferred_language: string; // ISO-639-1
  country: string;
  created_at: ISODate;
}

export interface Lead {
  id: ID;
  source: LeadSource;
  status: LeadStatus;
  contact_id: ID;
  // Form-campaign data carried over from the original lead tracker
  campaign: string;
  product: string;
  court_count: string;
  urgency: Urgency;
  location: string;
  /** Sales rep name; empty string = shared pool (not tagged yet). */
  owner: string;
  form_answers: string;
  flags: string[];
  submissions: number;
  mail: TouchState;
  phone_call: TouchState;
  whatsapp: TouchState;
  deal_id: ID | null;
  created_at: ISODate;
}

export interface Deal {
  id: ID;
  title: string;
  organization_id: ID | null;
  contact_id: ID | null;
  stage: StageKey;
  value: number;
  currency: Currency;
  court_count: number;
  court_model: string;
  expected_close_date: ISODate | null;
  /** Sales rep name; empty string = shared pool (not tagged yet). */
  owner: string;
  lost_reason: string | null;
  notes: string;
  lead_id: ID | null;
  created_at: ISODate;
  stage_entered_at: ISODate;
  /** Set when the sale is closed; the card stays in its column with a "sold" mark. */
  won_at: ISODate | null;
  lost_at: ISODate | null;
}

export interface Activity {
  id: ID;
  type: ActivityType;
  subject: string;
  due_at: ISODate;
  done: boolean;
  done_at: ISODate | null;
  deal_id: ID;
  notes: string;
  auto_created: boolean;
  created_at: ISODate;
}

/** Audit trail of stage moves — powers "conversion per stage" and the deal timeline. */
export interface DealStageChange {
  id: ID;
  deal_id: ID;
  from_stage: StageKey | null;
  to_stage: StageKey;
  changed_at: ISODate;
}

export interface Snapshot {
  organizations: Organization[];
  contacts: Contact[];
  leads: Lead[];
  deals: Deal[];
  activities: Activity[];
  stageChanges: DealStageChange[];
}

/** admin: everything · rep: own customers + pool · viewer: read-only (accounting, factory, logistics, observer). */
export type Role = "admin" | "rep" | "viewer";
/** Logged-in person (company user table, or the local Admin account). */
export interface TeamMember {
  name: string;
  email: string;
  role: Role;
}
/** Logged-in person (company user table, or the local Admin account). */
export interface User {
  email: string;
  name: string;
  role: Role;
  /** false for the local Admin account: no mailbox of its own. */
  hasMailbox: boolean;
}

/** One e-mail exchanged with a customer, as listed by the mail server. */
export interface MailSummary {
  id: string;
  folder: string;
  uid: number;
  direction: "in" | "out";
  from: string;
  to: string;
  subject: string;
  date: ISODate;
  attachments: number;
}
/** Result of a mailbox scan for one customer address. */
export interface MailResult {
  list: MailSummary[];
  /** Folders that were searched and how many messages each holds. */
  scanned: { folder: string; total: number }[];
  /** The search pattern used: the full address, or "@domain" for company domains. */
  pattern: string;
  byDomain: boolean;
  mailbox: string;
  sentFolder: string | null;
}
export interface MailBody {
  text: string;
}
