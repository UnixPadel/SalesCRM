import { describe, expect, it } from "vitest";
import type { ActivityOutcome, ActivityType } from "./activity";
import type { ContactAggregateRow } from "./contact";
import { EMPTY_CAMPAIGN, emptyTrackingFields, type Lead, type StageEvent } from "./lead";
import type { InstallTimeline } from "./leadProfile";
import type { StageCode } from "./stage";
import {
  buildTrackingReport,
  isHotUncontacted,
  leadTracking,
  proposalFacts,
  STATUS_KEYS,
  type TrackingCounts,
  type TrackingItem,
} from "./trackingReport";
import { summarizeContacts } from "./contact";

const TZ = "Europe/Istanbul";
const NOW = new Date("2026-11-10T09:00:00Z");

const lead = (id: string, over: Partial<Lead> = {}): Lead => ({
  id,
  source: "import",
  platformLeadId: null,
  formId: null,
  personId: `p-${id}`,
  fullName: `Lead ${id}`,
  email: null,
  phoneE164: null,
  country: "TR",
  city: "",
  company: "",
  productInterest: "",
  campaign: EMPTY_CAMPAIGN,
  assignedUserId: null,
  currentStage: "NEW",
  isTest: false,
  notes: "",
  extraAnswers: {},
  courtCount: null,
  courtModel: "",
  expectedCloseDate: null,
  organizationId: null,
  ...emptyTrackingFields(),
  createdAt: new Date("2026-11-02T06:00:00Z"),
  updatedAt: new Date("2026-11-02T06:00:00Z"),
  ...over,
});

const contactRow = (
  leadId: string,
  type: ActivityType,
  outcome: ActivityOutcome | null,
  at: Date,
  over: Partial<ContactAggregateRow> = {},
): ContactAggregateRow => ({
  leadId,
  type,
  outcome,
  customerReplied: false,
  estimated: false,
  n: 1,
  firstAt: at,
  lastAt: at,
  ...over,
});

let seq = 0;
const ev = (leadId: string, stage: StageCode, at: string, over: Partial<StageEvent> = {}): StageEvent => ({
  id: `e${++seq}`,
  leadId,
  changeId: `c${seq}`,
  stageCode: stage,
  occurredAt: new Date(at),
  sequence: seq,
  actorUserId: null,
  origin: "manual",
  value: null,
  lostReasonCode: null,
  qualificationAnswers: null,
  undoneAt: null,
  ...over,
});

const item = (l: Lead, rows: ContactAggregateRow[] = [], events: StageEvent[] = []): TrackingItem => ({
  lead: l,
  t: leadTracking(l, events, rows, TZ),
});

const mailed = (l: Lead, at = l.createdAt) => [contactRow(l.id, "email", "awaiting_reply", at)];

const ZERO_COUNTS: TrackingCounts = {
  lead: 0,
  mailSent: 0,
  whatsappSent: 0,
  neverReached: 0,
  legacyNoContact: 0,
  contacted: 0,
  replied: 0,
  proposalGiven: 0,
  buyers: 0,
  reachRate: null,
  replyRate: null,
  proposalRate: null,
};

/** Ekrandaki "%56,9" ile aynı yuvarlama (bir ondalık yüzde). */
const pct = (r: number | null) => (r === null ? null : Math.round(r * 1000) / 10);

describe("proposalFacts (D3)", () => {
  const none = summarizeContacts([], false);
  const withProposalContact = (at: string) =>
    summarizeContacts([contactRow("l1", "email", "proposal_sent", new Date(at))], false);

  it("PROPOSAL aşama olayı (auto_fill dahil) → aşamadan, olay zamanıyla", () => {
    const events = [ev("l1", "PROPOSAL", "2026-11-03T08:00:00Z", { origin: "auto_fill" })];
    expect(proposalFacts("WON", events, none)).toEqual({
      given: true,
      at: new Date("2026-11-03T08:00:00Z"),
      via: "stage",
    });
  });

  it("geri alınmış olay sayılmaz; aşamadan geçmeden LOST teklif değildir", () => {
    const undone = [ev("l1", "PROPOSAL", "2026-11-03T08:00:00Z", { undoneAt: new Date("2026-11-03T08:05:00Z") })];
    expect(proposalFacts("QUALIFIED", undone, none)).toEqual({ given: false, at: null, via: null });
    expect(proposalFacts("LOST", [ev("l1", "LOST", "2026-11-03T08:00:00Z")], none).given).toBe(false);
  });

  it("teklif teması: aşama olmadan da verildi; ikisi varsa erken olan", () => {
    expect(proposalFacts("CONTACTED", [], withProposalContact("2026-11-04T08:00:00Z"))).toEqual({
      given: true,
      at: new Date("2026-11-04T08:00:00Z"),
      via: "contact",
    });
    const events = [ev("l1", "PROPOSAL", "2026-11-06T08:00:00Z")];
    expect(proposalFacts("PROPOSAL", events, withProposalContact("2026-11-04T08:00:00Z")).via).toBe("contact");
    expect(proposalFacts("PROPOSAL", events, withProposalContact("2026-11-07T08:00:00Z"))).toEqual({
      given: true,
      at: new Date("2026-11-06T08:00:00Z"),
      via: "stage",
    });
  });

  it("aşama PROPOSAL ama olay yok (taşınmış kayıt) → verildi, zaman bilinmiyor", () => {
    expect(proposalFacts("PROPOSAL", [], none)).toEqual({ given: true, at: null, via: "stage" });
  });
});

describe("leadTracking", () => {
  it("aşama 'Hiç ulaşılmadı'yı etkilemez: temassız Teklif aşamasındaki lead never [K-B1]", () => {
    const l = lead("l1", { currentStage: "PROPOSAL" });
    const t = leadTracking(l, [], [], TZ);
    expect(t.contact.state).toBe("never");
    expect(t.proposal.given).toBe(true);
    expect(leadTracking({ ...l, contactHistoryUnknown: true }, [], [], TZ).contact.state).toBe("legacy");
  });

  it("başka lead'in satırları ve olayları yok sayılır", () => {
    const l = lead("l1");
    const t = leadTracking(
      l,
      [ev("l2", "PROPOSAL", "2026-11-03T08:00:00Z")],
      [contactRow("l2", "email", "proposal_sent", new Date("2026-11-03T08:00:00Z"))],
      TZ,
    );
    expect(t.contact.state).toBe("never");
    expect(t.proposal.given).toBe(false);
  });

  it("kort toplamı (ürün yoksa null), çatı alanı, sıcak, uyarılar", () => {
    const l = lead("l1", {
      installTimeline: "m0_3",
      country: null,
      products: { standard: 2, panoramic: 1, fullPanoramic: null, roof: { wanted: true, widthM: 20, lengthM: 10 } },
    });
    const t = leadTracking(l, [], [], TZ);
    expect(t).toMatchObject({ hot: true, courtTotal: 3, roofAreaM2: 200 });
    expect(t.warnings.map((w) => w.code)).toEqual(["country_missing"]);
    expect(leadTracking(lead("l2"), [], [], TZ)).toMatchObject({ hot: false, courtTotal: null, roofAreaM2: null });
  });

  it("isHotUncontacted: sıcak ve hiç ulaşılmamış; eski kayıt ve temaslı değil; kapanmış lead sıcak değil [K-I8]", () => {
    const hot = lead("l1", { installTimeline: "m0_3" });
    expect(isHotUncontacted(hot, leadTracking(hot, [], [], TZ))).toBe(true);
    expect(isHotUncontacted(hot, leadTracking(hot, [], mailed(hot), TZ))).toBe(false);
    const legacy = { ...hot, contactHistoryUnknown: true };
    expect(isHotUncontacted(legacy, leadTracking(legacy, [], [], TZ))).toBe(false);
    const won = { ...hot, currentStage: "WON" as const };
    expect(isHotUncontacted(won, leadTracking(won, [], [], TZ))).toBe(false);
    const warm = lead("l2", { installTimeline: "m3_6" });
    expect(isHotUncontacted(warm, leadTracking(warm, [], [], TZ))).toBe(false);
  });
});

describe("buildTrackingReport: boş girdi", () => {
  it("paylar 0, oranlar null, sabit satırlar sıfırla", () => {
    const r = buildTrackingReport({ items: [], teamIds: ["u1", "u2"], now: NOW, timeZone: TZ });
    expect(r.header).toEqual({ firstLeadAt: null, lastLeadAt: null, reportDate: "2026-11-10" });
    expect(r.basics).toEqual({
      total: 0,
      mailSent: 0,
      whatsappSent: 0,
      neverReached: 0,
      legacyNoContact: 0,
      replied: 0,
      proposalGiven: 0,
      buyers: 0,
      share: { mailSent: 0, whatsappSent: 0, neverReached: 0, replied: 0, proposalGiven: 0, buyers: 0 },
    });
    expect(r.byOwner).toEqual([
      { ownerId: "u1", ...ZERO_COUNTS },
      { ownerId: "u2", ...ZERO_COUNTS },
      { ownerId: null, ...ZERO_COUNTS },
    ]);
    expect(r.byOwnerTotal).toEqual(ZERO_COUNTS);
    expect(r.poolBreakdown).toEqual([]);
    expect(r.statusTotal).toEqual({ counts: Object.fromEntries(STATUS_KEYS.map((k) => [k, 0])), total: 0 });
    expect(r.statusByOwner.map((s) => s.ownerId)).toEqual(["u1", "u2", null]);
    expect(r.products).toEqual([
      ...["standard", "panoramic", "full_panoramic"].map((code) => ({
        code,
        preferred: 0,
        amongProposals: 0,
        shareOfProposals: null,
        amongBuyers: 0,
        totalQty: 0,
        totalAreaM2: null,
      })),
      {
        code: "roof",
        preferred: 0,
        amongProposals: 0,
        shareOfProposals: null,
        amongBuyers: 0,
        totalQty: null,
        totalAreaM2: 0,
      },
    ]);
    expect(r.closingPotential).toBe(0);
    expect(r.byInstallTimeline.map((t) => [t.timeline, t.lead, t.neverRate])).toEqual([
      ["m0_3", 0, null],
      ["m3_6", 0, null],
      ["m6_12", 0, null],
      ["researching", 0, null],
    ]);
  });

  it("ekip dizini bilinmiyorsa (null) ve lead yoksa satır yok", () => {
    expect(buildTrackingReport({ items: [], teamIds: null, now: NOW, timeZone: TZ }).byOwner).toEqual([]);
  });

  it("rapor tarihi saat dilimine göre", () => {
    const late = new Date("2026-11-10T22:30:00Z");
    expect(buildTrackingReport({ items: [], teamIds: null, now: late, timeZone: TZ }).header.reportDate).toBe(
      "2026-11-11",
    );
  });
});

describe("buildTrackingReport: satırlar, eski kayıt ve oranlar", () => {
  it("teamIds sırası her zaman; lead'i olan pasif sahip arkadan; havuz en sonda; null dizinde yalnız lead'i olanlar", () => {
    const items = [
      item(lead("a", { assignedUserId: "passive-9" })),
      item(lead("b", { assignedUserId: "u2" })),
      item(lead("c", { assignedUserId: "passive-3" })),
    ];
    const withTeam = buildTrackingReport({ items, teamIds: ["u1", "u2"], now: NOW, timeZone: TZ });
    expect(withTeam.byOwner.map((r) => [r.ownerId, r.lead])).toEqual([
      ["u1", 0],
      ["u2", 1],
      ["passive-3", 1],
      ["passive-9", 1],
      [null, 0],
    ]);
    expect(withTeam.statusByOwner.map((r) => r.ownerId)).toEqual(withTeam.byOwner.map((r) => r.ownerId));
    const noDir = buildTrackingReport({ items, teamIds: null, now: NOW, timeZone: TZ });
    expect(noDir.byOwner.map((r) => r.ownerId)).toEqual(["passive-3", "passive-9", "u2"]);
    const withPool = buildTrackingReport({ items: [...items, item(lead("d"))], teamIds: null, now: NOW, timeZone: TZ });
    expect(withPool.byOwner.map((r) => r.ownerId)).toEqual(["passive-3", "passive-9", "u2", null]);
  });

  it("eski kayıt 'Hiç'e sayılmaz, oranların paydasından çıkar [K-B1][K-I2]", () => {
    const a = lead("a", { assignedUserId: "u1" });
    const items = [
      item(a, mailed(a)),
      item(lead("b", { assignedUserId: "u1", contactHistoryUnknown: true, currentStage: "CONTACTED" })),
      item(lead("c", { assignedUserId: "u1", contactHistoryUnknown: true })),
      item(lead("d", { assignedUserId: "u1" })),
      item(lead("e", { assignedUserId: "u2", contactHistoryUnknown: true })),
    ];
    const r = buildTrackingReport({ items, teamIds: ["u1", "u2"], now: NOW, timeZone: TZ });
    const u1 = r.byOwner[0]!;
    expect(u1).toMatchObject({ lead: 4, contacted: 1, neverReached: 1, legacyNoContact: 2, replied: 0 });
    expect(u1.reachRate).toBe(1 / 2);
    expect(u1.replyRate).toBe(0);
    expect(u1.proposalRate).toBe(0);
    const u2 = r.byOwner[1]!;
    expect(u2).toMatchObject({ lead: 1, legacyNoContact: 1, reachRate: null, replyRate: null, proposalRate: 0 });
    expect(r.basics).toMatchObject({ total: 5, neverReached: 1, legacyNoContact: 2 + 1 });
    expect(r.byInstallTimeline).toHaveLength(5);
    expect(r.byInstallTimeline[4]).toEqual({
      timeline: null,
      lead: 5,
      neverReached: 1,
      legacyNoContact: 3,
      replied: 0,
      proposalGiven: 0,
      neverRate: 1 / 2,
    });
  });

  it("toplam satırı satırların toplamı; oranlar toplamlardan", () => {
    const a = lead("a", { assignedUserId: "u1" });
    const b = lead("b");
    const items = [
      item(a, [...mailed(a), contactRow("a", "email", "reply_received", new Date("2026-11-03T08:00:00Z"))]),
      item(b, [contactRow("b", "whatsapp", "awaiting_reply", b.createdAt)]),
      item(lead("c", { customerStatus: "buyer_ready", currentStage: "PROPOSAL" })),
    ];
    const r = buildTrackingReport({ items, teamIds: ["u1"], now: NOW, timeZone: TZ });
    expect(r.byOwnerTotal).toEqual({
      lead: 3,
      mailSent: 1,
      whatsappSent: 1,
      neverReached: 1,
      legacyNoContact: 0,
      contacted: 2,
      replied: 1,
      proposalGiven: 1,
      buyers: 1,
      reachRate: 2 / 3,
      replyRate: 1 / 2,
      proposalRate: 1 / 3,
    });
    expect(r.basics.share).toEqual({
      mailSent: 1 / 3,
      whatsappSent: 1 / 3,
      neverReached: 1 / 3,
      replied: 1 / 3,
      proposalGiven: 1 / 3,
      buyers: 1 / 3,
    });
  });

  it("test lead'leri rapora girmez", () => {
    const r = buildTrackingReport({
      items: [item(lead("a")), item(lead("t", { isTest: true }))],
      teamIds: null,
      now: NOW,
      timeZone: TZ,
    });
    expect(r.basics.total).toBe(1);
  });

  it("havuz alt kırılımı Excel etiketine göre; sahipli lead'in etiketi girmez; boş etiket = yok", () => {
    const items = [
      item(lead("a", { extraAnswers: { excel_owner: "Etiket B" } })),
      item(lead("b", { extraAnswers: { excel_owner: " Etiket B " } })),
      item(lead("c", { extraAnswers: { excel_owner: "Etiket A" } })),
      item(lead("d", { extraAnswers: { excel_owner: "" } })),
      item(lead("e")),
      item(lead("f", { extraAnswers: { excel_owner: "Etiket C" } })),
      item(lead("g", { assignedUserId: "u1", extraAnswers: { excel_owner: "Etiket Z" } })),
    ];
    const r = buildTrackingReport({ items, teamIds: ["u1"], now: NOW, timeZone: TZ });
    expect(r.poolBreakdown.map((p) => [p.excelOwner, p.lead])).toEqual([
      ["Etiket B", 2],
      [null, 2],
      ["Etiket A", 1],
      ["Etiket C", 1],
    ]);
    expect(r.poolBreakdown.reduce((s, p) => s + p.lead, 0)).toBe(r.byOwner.at(-1)!.lead);
  });

  it("ürün satırları: teklif ve alıcı içinde, teklif payı, adet ve m² toplamı (ölçüsüz çatı atlanır)", () => {
    const p = (over: Partial<Lead["products"]>) => ({ ...emptyTrackingFields().products, ...over });
    const items = [
      item(lead("a", { currentStage: "PROPOSAL", products: p({ panoramic: 2 }) })),
      item(lead("b", { currentStage: "PROPOSAL", customerStatus: "buyer_ready", products: p({ panoramic: 1 }) })),
      item(lead("c", { currentStage: "PROPOSAL" })),
      item(lead("d", { products: p({ standard: 4, roof: { wanted: true, widthM: 20, lengthM: 10 } }) })),
      item(lead("e", { products: p({ roof: { wanted: true, widthM: 10.5, lengthM: 3.33 } }) })),
      item(
        lead("f", { customerStatus: "buyer_ready", products: p({ roof: { wanted: true, widthM: null, lengthM: 5 } }) }),
      ),
    ];
    const r = buildTrackingReport({ items, teamIds: null, now: NOW, timeZone: TZ });
    expect(r.products).toEqual([
      {
        code: "standard",
        preferred: 1,
        amongProposals: 0,
        shareOfProposals: 0,
        amongBuyers: 0,
        totalQty: 4,
        totalAreaM2: null,
      },
      {
        code: "panoramic",
        preferred: 2,
        amongProposals: 2,
        shareOfProposals: 2 / 3,
        amongBuyers: 1,
        totalQty: 3,
        totalAreaM2: null,
      },
      {
        code: "full_panoramic",
        preferred: 0,
        amongProposals: 0,
        shareOfProposals: 0,
        amongBuyers: 0,
        totalQty: 0,
        totalAreaM2: null,
      },
      {
        code: "roof",
        preferred: 3,
        amongProposals: 0,
        shareOfProposals: 0,
        amongBuyers: 1,
        totalQty: null,
        totalAreaM2: 234.97,
      },
    ]);
    expect(r.basics.buyers).toBe(2);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// §6.8 profili: 160 sentetik lead, Excel ÖZET RAPOR'un CRM tarafı birebir (iş emri §6.8 "Beklenen sayılar").
// Kişisel veri yok: lead adları "Lead n"; ekip etiketleri ve KullaniciID'ler ekip verisidir (iş emri başlığı).
// ---------------------------------------------------------------------------------------------------------------

interface OwnerSpec {
  ownerId: string | null;
  excelOwner: string | null;
  leads: number;
  mail: number;
  /** İlk temaslı lead bu kanaldan dönüş almış (tahmini, 09:01). */
  reply?: "email" | "whatsapp";
}

const TEAM = ["32", "28", "47", "46", "26", "51"];
const SPECS: OwnerSpec[] = [
  { ownerId: "32", excelOwner: "Yusa Bedir", leads: 44, mail: 23 },
  { ownerId: "28", excelOwner: "Simon Sharpe", leads: 31, mail: 17 },
  { ownerId: "47", excelOwner: "Ahlem", leads: 22, mail: 11, reply: "email" },
  { ownerId: "46", excelOwner: "Salah", leads: 11, mail: 6 },
  { ownerId: null, excelOwner: "Enes", leads: 24, mail: 16, reply: "whatsapp" },
  { ownerId: null, excelOwner: "Faruk", leads: 8, mail: 5 },
  { ownerId: null, excelOwner: null, leads: 7, mail: 4 },
  { ownerId: null, excelOwner: "Mehmet", leads: 6, mail: 4 },
  { ownerId: null, excelOwner: "Beyza", leads: 4, mail: 3 },
  { ownerId: null, excelOwner: "Almanya Distribütörü", leads: 3, mail: 2 },
];

const rep = <T>(v: T, n: number): T[] => Array.from({ length: n }, () => v);

function excelProfile(remap: Record<string, string> = {}): TrackingItem[] {
  // Hiç ulaşılmamış 69 ve ulaşılmış 91 lead'in kurulum zamanı dağılımı (§6.8 §5); iki dönüşlü lead ayrıca.
  const neverQueue: InstallTimeline[] = [
    ...rep<InstallTimeline>("m0_3", 21),
    ...rep<InstallTimeline>("m3_6", 29),
    ...rep<InstallTimeline>("m6_12", 4),
    ...rep<InstallTimeline>("researching", 15),
  ];
  const contactedQueue: InstallTimeline[] = [
    ...rep<InstallTimeline>("m0_3", 25),
    ...rep<InstallTimeline>("m3_6", 28),
    ...rep<InstallTimeline>("m6_12", 17),
    ...rep<InstallTimeline>("researching", 19),
  ];
  const REPLY_TIMELINE = { email: "m0_3", whatsapp: "m3_6" } as const;
  const items: TrackingItem[] = [];
  let n = 0;
  for (const spec of SPECS) {
    for (let k = 0; k < spec.leads; k++) {
      const i = n++;
      const createdAt = new Date(Date.UTC(2026, 9, 22 + (i % 19), 6)); // B günü 09:00 İstanbul, 22.10–09.11
      const contacted = k < spec.mail;
      const reply = contacted && k === 0 ? spec.reply : undefined;
      const owner = spec.ownerId ?? (spec.excelOwner ? (remap[spec.excelOwner] ?? null) : null);
      const l = lead(`x${i + 1}`, {
        assignedUserId: owner,
        extraAnswers: { excel_no: String(i + 1), ...(spec.excelOwner ? { excel_owner: spec.excelOwner } : {}) },
        installTimeline: reply ? REPLY_TIMELINE[reply] : contacted ? contactedQueue.shift()! : neverQueue.shift()!,
        installSite: i < 52 ? "covered_court" : "no_site_yet",
        customerStatus: reply === "whatsapp" ? "interested" : null,
        // A2: Excel'de ✔'siz adet 2 → tercih sayılır.
        products: i === 0 ? { ...emptyTrackingFields().products, standard: 2 } : emptyTrackingFields().products,
        createdAt,
      });
      const rows = contacted ? [contactRow(l.id, "email", "awaiting_reply", createdAt, { estimated: true })] : [];
      if (reply) {
        rows.push(
          contactRow(l.id, reply, "reply_received", new Date(createdAt.getTime() + 60_000), { estimated: true }),
        );
      }
      items.push(item(l, rows));
    }
  }
  expect(neverQueue).toEqual([]);
  expect(contactedQueue).toEqual([]);
  return items;
}

describe("buildTrackingReport: §6.8 profili (160 lead) = Excel ÖZET RAPOR", () => {
  const items = excelProfile();
  const r = buildTrackingReport({ items, teamIds: TEAM, now: NOW, timeZone: TZ });

  it("başlık: ilk / son lead tarihi, rapor tarihi", () => {
    expect(r.header).toEqual({
      firstLeadAt: new Date("2026-10-22T06:00:00Z"),
      lastLeadAt: new Date("2026-11-09T06:00:00Z"),
      reportDate: "2026-11-10",
    });
  });

  it("§1 temel göstergeler ve paylar (Excel B7..H7 = 160/91/0/69/2/0/0; WhatsApp A1 ile 1)", () => {
    expect(r.basics).toMatchObject({
      total: 160,
      mailSent: 91,
      whatsappSent: 1,
      neverReached: 69,
      legacyNoContact: 0,
      replied: 2,
      proposalGiven: 0,
      buyers: 0,
    });
    expect(r.basics.share.mailSent).toBe(0.56875);
    expect(pct(r.basics.share.mailSent)).toBe(56.9);
    expect(pct(r.basics.share.whatsappSent)).toBe(0.6);
    expect(pct(r.basics.share.neverReached)).toBe(43.1);
    expect(pct(r.basics.share.replied)).toBe(1.3);
    expect(r.basics.share.proposalGiven).toBe(0);
    expect(r.basics.share.buyers).toBe(0);
  });

  it("§2 sorumlu satırları: sabit ekip satırları, havuz en sonda; sayılar ve oranlar", () => {
    const rows = r.byOwner.map((o) => [
      o.ownerId,
      o.lead,
      o.mailSent,
      o.whatsappSent,
      o.neverReached,
      o.legacyNoContact,
      o.replied,
      o.proposalGiven,
      o.buyers,
      pct(o.reachRate),
      pct(o.replyRate),
      pct(o.proposalRate),
    ]);
    expect(rows).toEqual([
      ["32", 44, 23, 0, 21, 0, 0, 0, 0, 52.3, 0, 0],
      ["28", 31, 17, 0, 14, 0, 0, 0, 0, 54.8, 0, 0],
      ["47", 22, 11, 0, 11, 0, 1, 0, 0, 50, 9.1, 0],
      ["46", 11, 6, 0, 5, 0, 0, 0, 0, 54.5, 0, 0],
      ["26", 0, 0, 0, 0, 0, 0, 0, 0, null, null, null],
      ["51", 0, 0, 0, 0, 0, 0, 0, 0, null, null, null],
      [null, 52, 34, 1, 18, 0, 1, 0, 0, 65.4, 2.9, 0],
    ]);
  });

  it("§2 TOPLAM (Excel J22 = 0,56875, K22 = 0,02198)", () => {
    expect(r.byOwnerTotal).toMatchObject({
      lead: 160,
      mailSent: 91,
      whatsappSent: 1,
      neverReached: 69,
      legacyNoContact: 0,
      contacted: 91,
      replied: 2,
      proposalGiven: 0,
      buyers: 0,
    });
    expect(r.byOwnerTotal.reachRate).toBe(0.56875);
    expect(r.byOwnerTotal.replyRate).toBeCloseTo(0.02198, 5);
    expect(r.byOwnerTotal.proposalRate).toBe(0);
  });

  it("§2 havuz alt satırları Excel'in satırlarıyla aynı (A3); A1 Enes satırında", () => {
    expect(r.poolBreakdown.map((p) => [p.excelOwner, p.lead, p.mailSent, p.whatsappSent, p.neverReached])).toEqual([
      ["Enes", 24, 16, 1, 8],
      ["Faruk", 8, 5, 0, 3],
      [null, 7, 4, 0, 3],
      ["Mehmet", 6, 4, 0, 2],
      ["Beyza", 4, 3, 0, 1],
      ["Almanya Distribütörü", 3, 2, 0, 1],
    ]);
  });

  it("§3 müşteri durumu × sorumlu: İlgili 1 (havuz), Durum girilmedi 159", () => {
    expect(r.statusTotal).toEqual({
      counts: { interested: 1, not_interested: 0, project_phase: 0, collecting_prices: 0, buyer_ready: 0, none: 159 },
      total: 160,
    });
    const pool = r.statusByOwner.at(-1)!;
    expect(pool).toMatchObject({ ownerId: null, total: 52 });
    expect(pool.counts.interested).toBe(1);
    expect(pool.counts.none).toBe(51);
    expect(r.statusByOwner.map((s) => [s.ownerId, s.total])).toEqual(r.byOwner.map((o) => [o.ownerId, o.lead]));
  });

  it("§4 ürünler (A2: Standard tercih eden 1, toplam adet 2 = Excel G42) ve kapatma potansiyeli 52", () => {
    expect(r.products.map((p) => [p.code, p.preferred, p.amongProposals, p.shareOfProposals, p.amongBuyers])).toEqual([
      ["standard", 1, 0, null, 0],
      ["panoramic", 0, 0, null, 0],
      ["full_panoramic", 0, 0, null, 0],
      ["roof", 0, 0, null, 0],
    ]);
    expect(r.products.map((p) => p.totalQty)).toEqual([2, 0, 0, null]);
    expect(r.products.at(-1)!.totalAreaM2).toBe(0);
    expect(r.closingPotential).toBe(52);
  });

  it("§5 kurulum zamanı (Excel G51..G54 = 0,4468 / 0,5 / 0,1905 / 0,4412); Belirtilmemiş satırı yok", () => {
    expect(r.byInstallTimeline.map((t) => [t.timeline, t.lead, t.neverReached, t.legacyNoContact, t.replied])).toEqual([
      ["m0_3", 47, 21, 0, 1],
      ["m3_6", 58, 29, 0, 1],
      ["m6_12", 21, 4, 0, 0],
      ["researching", 34, 15, 0, 0],
    ]);
    expect(r.byInstallTimeline.map((t) => t.proposalGiven)).toEqual([0, 0, 0, 0]);
    const rates = r.byInstallTimeline.map((t) => t.neverRate!);
    [0.4468, 0.5, 0.1905, 0.4412].forEach((x, i) => expect(rates[i]).toBeCloseTo(x, 4));
    expect(rates.map(pct)).toEqual([44.7, 50, 19, 44.1]);
  });

  it("sıcak ve hiç ulaşılmamış açık lead sayısı = §5 '3 ay içinde · Hiç' (şerit = liste)", () => {
    expect(items.filter((x) => isHotUncontacted(x.lead, x.t))).toHaveLength(21);
  });

  it("Enes bir kullanıcıya eşlenirse (§8 soru 2): Enes 24/16/1/8/1, havuz 28/18/0/10/0", () => {
    const m = buildTrackingReport({ items: excelProfile({ Enes: "26" }), teamIds: TEAM, now: NOW, timeZone: TZ });
    const pick = (id: string | null) => {
      const o = m.byOwner.find((x) => x.ownerId === id)!;
      return [o.lead, o.mailSent, o.whatsappSent, o.neverReached, o.replied];
    };
    expect(pick("26")).toEqual([24, 16, 1, 8, 1]);
    expect(pick(null)).toEqual([28, 18, 0, 10, 0]);
    expect(m.byOwnerTotal).toMatchObject({ lead: 160, mailSent: 91, neverReached: 69, replied: 2 });
  });
});
