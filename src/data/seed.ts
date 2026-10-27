// First-load seed: realistic customers across all five columns + the 955 real form-campaign
// leads from the original tracker. Dates are relative to "now" so overdue states stay visible.
import { languageFor, normalizeOwner, STAGES } from "../domain/constants";
import type {
  Activity,
  ActivityType,
  Contact,
  Currency,
  Deal,
  DealStageChange,
  Lead,
  LeadSource,
  Organization,
  OrgType,
  StageKey,
  Urgency,
} from "../domain/types";
import rawLeads from "../seed/leads.json";
import type { CrmRepository } from "./repository";

const DAY = 86_400_000;
const ago = (days: number, hour = 10) => {
  const d = new Date(Date.now() - days * DAY);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};
const inDays = (days: number, hour = 10, min = 0) => {
  const d = new Date(Date.now() + days * DAY);
  d.setHours(hour, min, 0, 0);
  return d.toISOString();
};
const dateIn = (days: number) => inDays(days).slice(0, 10);

interface SeedDeal {
  org: [name: string, country: string, type: OrgType, website: string];
  contact: [name: string, role: string, email: string, phone: string];
  title: string;
  stage: StageKey;
  value: number;
  currency: Currency;
  courts: number;
  model: string;
  /** "" = shared pool */
  owner: string;
  createdDaysAgo: number;
  inStageDays: number;
  closeInDays: number | null;
  won?: boolean;
  lostReason?: string;
  lostFrom?: StageKey;
  notes?: string;
  /** [type, subject, dueOffsetDays (negative = past), hour, done] */
  acts: [ActivityType, string, number, number, boolean][];
}

const DEALS: SeedDeal[] = [
  {
    org: ["Ataşehir Padel Kulübü", "TR", "club", "atasehirpadel.com"],
    contact: ["Murat Kaya", "Kulüp müdürü", "murat@atasehirpadel.com", "+905321112233"],
    title: "Ataşehir Padel Kulübü",
    stage: "contacted",
    value: 2_950_000,
    currency: "TRY",
    courts: 4,
    model: "Panoramik",
    owner: "Elshan",
    createdDaysAgo: 2,
    inStageDays: 2,
    closeInDays: 60,
    acts: [["call", "İhtiyaç analizi araması", 1, 11, false]],
  },
  {
    org: ["Smash Padel Ltd", "GB", "club", "smashpadel.co.uk"],
    contact: ["James Whitmore", "Founder", "james@smashpadel.co.uk", "+447700900123"],
    title: "Smash Padel London",
    stage: "contacted",
    value: 96_000,
    currency: "GBP",
    courts: 3,
    model: "Roof Top Kanopi",
    owner: "",
    createdDaysAgo: 6,
    inStageDays: 6,
    closeInDays: 75,
    notes: "Instagram reklamından geldi, kapalı alan istiyor.",
    acts: [["email", "Katalog ve referans listesi gönderildi", -5, 15, true]],
  },
  {
    org: ["Toronto Padel Co.", "CA", "club", "torontopadel.ca"],
    contact: ["Emily Chen", "Operations Director", "emily@torontopadel.ca", "+14165550142"],
    title: "Toronto Padel Co.",
    stage: "contacted",
    value: 165_000,
    currency: "USD",
    courts: 6,
    model: "Süper Panoramik",
    owner: "Yuşa",
    createdDaysAgo: 1,
    inStageDays: 1,
    closeInDays: 90,
    acts: [["email", "Teknik şartname ve nakliye bilgisi", 0, 16, false]],
  },
  {
    org: ["Lyon Padel Indoor", "FR", "club", "lyonpadel.fr"],
    contact: ["Camille Durand", "Directrice", "camille@lyonpadel.fr", "+33478123456"],
    title: "Lyon Padel Indoor",
    stage: "contacted",
    value: 104_000,
    currency: "EUR",
    courts: 4,
    model: "Panoramik",
    owner: "Salah",
    createdDaysAgo: 12,
    inStageDays: 5,
    closeInDays: 40,
    acts: [["call", "Bütçe ve renk seçimi görüşmesi", -2, 11, false]],
  },
  {
    org: ["Bavaria Sports Invest GmbH", "DE", "investor", "bavaria-sports.de"],
    contact: ["Thomas Berger", "Geschäftsführer", "t.berger@bavaria-sports.de", "+4989123456"],
    title: "Bavaria Sports Invest",
    stage: "interested",
    value: 210_000,
    currency: "EUR",
    courts: 8,
    model: "Panoramik",
    owner: "Ahlem",
    createdDaysAgo: 18,
    inStageDays: 9,
    closeInDays: 45,
    acts: [
      ["call", "İlk görüşme — yatırım takvimi", -15, 10, true],
      ["meeting", "Online sunum (Teams)", 4, 14, false],
    ],
  },
  {
    org: ["Athens Padel Centre", "GR", "club", "athenspadel.gr"],
    contact: ["Nikos Papadopoulos", "Owner", "nikos@athenspadel.gr", "+302101234567"],
    title: "Athens Padel Centre",
    stage: "interested",
    value: 58_000,
    currency: "EUR",
    courts: 2,
    model: "Süper Panoramik",
    owner: "",
    createdDaysAgo: 25,
    inStageDays: 14,
    closeInDays: 30,
    acts: [["call", "Zemin ve ölçü teyidi", -14, 12, true]],
  },
  {
    org: ["Adriatic Padel d.o.o.", "HR", "distributor", "adriaticpadel.hr"],
    contact: ["Ivan Horvat", "Sales Manager", "ivan@adriaticpadel.hr", "+38521123456"],
    title: "Adriatic Padel (distribütör)",
    stage: "proforma_sent",
    value: 235_000,
    currency: "EUR",
    courts: 10,
    model: "Panoramik",
    owner: "Salah",
    createdDaysAgo: 30,
    inStageDays: 2,
    closeInDays: 21,
    acts: [
      ["meeting", "Split showroom toplantısı", -10, 13, true],
      ["proforma_sent", "Proforma PF-2026-118 gönderildi", -2, 10, true],
    ],
  },
  {
    org: ["Dubai Marina Sports LLC", "AE", "club", "dubaimarinasports.ae"],
    contact: ["Omar Al Mansoori", "Project Manager", "omar@dmsports.ae", "+971501234567"],
    title: "Dubai Marina Sports",
    stage: "proforma_sent",
    value: 175_000,
    currency: "USD",
    courts: 5,
    model: "Roof Top Kanopi",
    owner: "Yuşa",
    createdDaysAgo: 34,
    inStageDays: 8,
    closeInDays: 14,
    acts: [
      ["site_visit", "Çatı ölçümü — saha ziyareti", -20, 9, true],
      ["proforma_sent", "Proforma PF-2026-109 gönderildi", -8, 10, true],
    ],
  },
  {
    org: ["Warsaw Padel Group Sp. z o.o.", "PL", "investor", "warsawpadel.pl"],
    contact: ["Piotr Nowak", "CEO", "piotr@warsawpadel.pl", "+48221234567"],
    title: "Warsaw Padel Group",
    stage: "site_visit",
    value: 148_000,
    currency: "EUR",
    courts: 6,
    model: "Panoramik",
    owner: "Elshan",
    createdDaysAgo: 48,
    inStageDays: 12,
    closeInDays: 10,
    acts: [
      ["proforma_sent", "Proforma PF-2026-097", -20, 10, true],
      ["site_visit", "Varşova arsa keşfi", 2, 9, false],
    ],
  },
  {
    org: ["Costa Blanca Construcciones SL", "ES", "contractor", "costablanca-construcciones.es"],
    contact: ["Javier Martínez", "Jefe de proyecto", "jmartinez@cbconstrucciones.es", "+34965123456"],
    title: "Costa Blanca Construcciones",
    stage: "site_visit",
    value: 276_000,
    currency: "EUR",
    courts: 12,
    model: "Klasik",
    owner: "Ahlem",
    createdDaysAgo: 62,
    inStageDays: 21,
    closeInDays: 5,
    notes: "İhale usulü, 3 tedarikçi arasında. Kurulum dahil fiyat istiyor.",
    acts: [
      ["proforma_sent", "Proforma PF-2026-081", -35, 10, true],
      ["site_visit", "Alicante şantiye ziyareti", -21, 16, true],
    ],
  },
  {
    org: ["Antalya Resort Yatırım A.Ş.", "TR", "investor", "antalyaresort.com.tr"],
    contact: ["Selin Demir", "Satın alma müdürü", "selin.demir@antalyaresort.com.tr", "+905421234567"],
    title: "Antalya Resort Yatırım",
    stage: "site_visit",
    value: 2_250_000,
    currency: "TRY",
    courts: 4,
    model: "Panoramik",
    owner: "Elshan",
    createdDaysAgo: 70,
    inStageDays: 9,
    closeInDays: null,
    won: true,
    acts: [
      ["site_visit", "Otel sahası keşif ziyareti", -40, 10, true],
      ["meeting", "Sözleşme imzası", -9, 15, true],
      ["call", "Kurulum tarihini teyit et", 6, 10, false],
    ],
  },
  {
    org: ["Belgrade Padel Arena", "RS", "club", "padelarena.rs"],
    contact: ["Marko Jovanović", "Vlasnik", "marko@padelarena.rs", "+381641234567"],
    title: "Belgrade Padel Arena",
    stage: "site_visit",
    value: 92_000,
    currency: "EUR",
    courts: 4,
    model: "Panoramik",
    owner: "Salah",
    createdDaysAgo: 110,
    inStageDays: 58,
    closeInDays: null,
    won: true,
    acts: [["meeting", "Sözleşme ve avans", -58, 12, true]],
  },
  {
    org: ["Nordic Court Solutions ApS", "DK", "distributor", "nordiccourts.dk"],
    contact: ["Lars Jensen", "Partner", "lars@nordiccourts.dk", "+4533123456"],
    title: "Nordic Court Solutions",
    stage: "site_visit",
    value: 64_000,
    currency: "EUR",
    courts: 2,
    model: "Süper Panoramik",
    owner: "Ahlem",
    createdDaysAgo: 160,
    inStageDays: 122,
    closeInDays: null,
    won: true,
    acts: [["email", "Sözleşme taslağı onayı", -123, 11, true]],
  },
  {
    org: ["Milano Sport Costruzioni Srl", "IT", "contractor", "milanosport.it"],
    contact: ["Giulia Rossi", "Responsabile acquisti", "g.rossi@milanosport.it", "+390212345678"],
    title: "Milano Sport Costruzioni",
    stage: "lost",
    value: 150_000,
    currency: "EUR",
    courts: 6,
    model: "Klasik",
    owner: "Salah",
    createdDaysAgo: 75,
    inStageDays: 31,
    closeInDays: null,
    lostReason: "Rakip firma seçildi — yerel üretici %12 daha ucuz teklif verdi",
    lostFrom: "proforma_sent",
    acts: [["proforma_sent", "Proforma PF-2026-064", -50, 10, true]],
  },
  {
    org: ["Texas Padel Partners LLC", "US", "investor", "texaspadel.com"],
    contact: ["Michael Johnson", "Managing Partner", "mj@texaspadel.com", "+15125550199"],
    title: "Texas Padel Partners",
    stage: "lost",
    value: 290_000,
    currency: "USD",
    courts: 10,
    model: "Panoramik",
    owner: "Yuşa",
    createdDaysAgo: 140,
    inStageDays: 88,
    closeInDays: null,
    lostReason: "Proje ertelendi / iptal",
    lostFrom: "site_visit",
    acts: [["proforma_sent", "Proforma PF-2026-031", -100, 10, true]],
  },
];

/** Builds a plausible column path from "contacted" to the customer's current column. */
function stagePath(stage: StageKey, lostFrom: StageKey = "proforma_sent"): StageKey[] {
  const order: StageKey[] = STAGES.map((s) => s.key).filter((k) => k !== "lost");
  if (stage === "lost") return [...order.slice(0, order.indexOf(lostFrom) + 1), "lost"];
  return order.slice(0, order.indexOf(stage) + 1);
}

function buildDeals() {
  const orgs: Organization[] = [];
  const contacts: Contact[] = [];
  const deals: Deal[] = [];
  const acts: Activity[] = [];
  const changes: DealStageChange[] = [];

  DEALS.forEach((s, i) => {
    const created = ago(s.createdDaysAgo, 9);
    const org: Organization = {
      id: `org_seed_${i + 1}`,
      name: s.org[0],
      country: s.org[1],
      type: s.org[2],
      website: s.org[3],
      notes: "",
      created_at: created,
    };
    const contact: Contact = {
      id: `con_seed_${i + 1}`,
      name: s.contact[0],
      role: s.contact[1],
      email: s.contact[2],
      phone: s.contact[3],
      organization_id: org.id,
      preferred_language: languageFor(org.country),
      country: org.country,
      created_at: created,
    };
    const entered = ago(s.inStageDays, 11);
    const deal: Deal = {
      id: `deal_seed_${i + 1}`,
      title: s.title,
      organization_id: org.id,
      contact_id: contact.id,
      stage: s.stage,
      value: s.value,
      currency: s.currency,
      court_count: s.courts,
      court_model: s.model,
      expected_close_date: s.closeInDays == null ? null : dateIn(s.closeInDays),
      owner: s.owner,
      lost_reason: s.lostReason ?? null,
      notes: s.notes ?? "",
      lead_id: null,
      created_at: created,
      stage_entered_at: entered,
      won_at: s.won ? entered : null,
      lost_at: s.stage === "lost" ? entered : null,
    };

    // Column history spread evenly between creation and the current column entry.
    const path = stagePath(s.stage, s.lostFrom);
    const span = s.createdDaysAgo - s.inStageDays;
    path.forEach((to, j) => {
      const daysAgo =
        j === path.length - 1
          ? s.inStageDays
          : s.createdDaysAgo - Math.round((span * j) / Math.max(1, path.length - 1));
      changes.push({
        id: `sc_seed_${i + 1}_${j}`,
        deal_id: deal.id,
        from_stage: j ? path[j - 1] : null,
        to_stage: to,
        changed_at: j === 0 ? created : j === path.length - 1 ? entered : ago(daysAgo, 11),
      });
    });

    s.acts.forEach(([type, subject, offset, hour, done], j) => {
      const due = offset < 0 ? ago(-offset, hour) : inDays(offset, hour);
      acts.push({
        id: `act_seed_${i + 1}_${j}`,
        type,
        subject,
        due_at: due,
        done,
        done_at: done ? due : null,
        deal_id: deal.id,
        notes: "",
        auto_created: false,
        created_at: created,
      });
    });
    // Rule 2 on seed data: proforma-column customers carry their auto follow-up (Dubai's is overdue).
    if (s.stage === "proforma_sent") {
      acts.push({
        id: `act_seed_${i + 1}_auto`,
        type: "call",
        subject: "Proforma takibi — müşteri dönüşü",
        due_at: inDays(3 - s.inStageDays, 9),
        done: false,
        done_at: null,
        deal_id: deal.id,
        notes: "Proforma gönderildi; 3 gün sonra otomatik takip.",
        auto_created: true,
        created_at: entered,
      });
    }

    orgs.push(org);
    contacts.push(contact);
    deals.push(deal);
  });
  return { orgs, contacts, deals, acts, changes };
}

interface RawLead {
  id: string;
  n: string;
  e: string;
  p: string;
  c: string;
  city: string;
  pr: string;
  co: string;
  u: string;
  src: string;
  d: string;
  rep: string;
  mail: string;
  tel: string;
  wa: string;
  st: string;
  flags: string[];
  ans: string;
  dup: number;
}

function buildLeads() {
  const contacts: Contact[] = [];
  const leads: Lead[] = [];
  const push = (r: RawLead, source: LeadSource) => {
    const created = (r.d || new Date().toISOString().slice(0, 10)) + "T09:00:00.000Z";
    const contactId = "con_" + r.id;
    contacts.push({
      id: contactId,
      name: r.n || "(isimsiz)",
      role: "",
      email: r.e || "",
      phone: r.p || "",
      organization_id: null,
      preferred_language: languageFor(r.c),
      country: r.c || "",
      created_at: created,
    });
    leads.push({
      id: r.id,
      source,
      status: /^lost/.test(r.st) ? "discarded" : "new",
      contact_id: contactId,
      campaign: r.src || "",
      product: r.pr || "",
      court_count: r.co || "",
      urgency: (["asap", "m13", "m36", "m612"].includes(r.u) ? r.u : "") as Urgency,
      location: r.city || "",
      owner: normalizeOwner(r.rep || ""),
      form_answers: r.ans || "",
      flags: r.flags || [],
      submissions: r.dup || 1,
      mail: r.mail === "sent" ? "sent" : "none",
      phone_call: (r.tel as Lead["phone_call"]) || "none",
      whatsapp: (r.wa as Lead["whatsapp"]) || "none",
      deal_id: null,
      created_at: created,
    });
  };
  // The tracker's leads came from Meta (Instagram/Facebook) lead-form campaigns.
  (rawLeads as RawLead[]).forEach((r) => push(r, "instagram"));

  const extra: [LeadSource, string, string, string, string, string, string, string][] = [
    ["fair", "Carlos Ruiz", "carlos@padelmadrid.es", "+34612345678", "ES", "Madrid — World Padel Expo", "6", ""],
    [
      "fair",
      "Ahmet Yılmaz",
      "ahmet@izmirspor.com.tr",
      "+905331234567",
      "TR",
      "İzmir — Spor Fuarı standı",
      "3",
      "Elshan",
    ],
    [
      "referral",
      "Sophie Müller",
      "sophie@tennisclub-wien.at",
      "+436641234567",
      "AT",
      "Viyana — Belgrade Arena referansı",
      "2",
      "Ahlem",
    ],
    [
      "referral",
      "Andreas Georgiou",
      "andreas@limassolpadel.cy",
      "+35799123456",
      "CY",
      "Limasol — Athens Centre referansı",
      "4",
      "",
    ],
    ["website_form", "Daniel Novak", "daniel@ljubljanapadel.si", "+38640123456", "SI", "Ljubljana", "2", "Salah"],
  ];
  extra.forEach(([source, n, e, p, c, city, co, rep], i) =>
    push(
      {
        id: `lead_extra_${i + 1}`,
        n,
        e,
        p,
        c,
        city,
        pr: "Padel Court",
        co,
        u: i % 2 ? "m36" : "m13",
        src: source === "fair" ? "Fuar" : source === "referral" ? "Referans" : "unixpadel.com",
        d: new Date(Date.now() - (i + 1) * 2 * DAY).toISOString().slice(0, 10),
        rep,
        mail: "none",
        tel: "none",
        wa: "none",
        st: "new",
        flags: [],
        ans: "",
        dup: 1,
      },
      source,
    ),
  );
  return { contacts, leads };
}

// Single-flight: React StrictMode mounts effects twice in dev; both calls must share one seed run.
let inflight: Promise<boolean> | null = null;
export function seedIfEmpty(repo: CrmRepository) {
  inflight ??= seed(repo).finally(() => (inflight = null));
  return inflight;
}

async function seed(repo: CrmRepository) {
  if (!(await repo.isEmpty())) return false;
  await repo.reset();
  const d = buildDeals();
  const l = buildLeads();
  await repo.organizations.insertMany(d.orgs);
  await repo.contacts.insertMany([...d.contacts, ...l.contacts]);
  await repo.deals.insertMany(d.deals);
  await repo.activities.insertMany(d.acts);
  await repo.stageChanges.insertMany(d.changes);
  await repo.leads.insertMany(l.leads);
  await repo.markSeeded();
  return true;
}
