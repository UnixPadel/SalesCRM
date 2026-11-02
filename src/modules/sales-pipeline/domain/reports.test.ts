import { describe, expect, it } from "vitest";
import type { Lead, StageEvent } from "./lead";
import { EMPTY_CAMPAIGN } from "./lead";
import { buildReport, lastMonths, monthKey } from "./reports";
import type { StageCode } from "./stage";

const NOW = new Date("2026-03-15T10:00:00Z");

const lead = (id: string, over: Partial<Lead>): Lead => ({
  id,
  source: "manual",
  platformLeadId: null,
  formId: null,
  personId: "p",
  fullName: id,
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
  createdAt: new Date("2026-02-01T00:00:00Z"),
  updatedAt: new Date("2026-02-01T00:00:00Z"),
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

/** Olay dizisi: aynı lead için ardışık aşamalar. */
const path = (leadId: string, steps: [StageCode, string, Partial<StageEvent>?][]) =>
  steps.map(([s, at, o]) => ev(leadId, s, at, o));

describe("ay anahtarı ve dönem", () => {
  it("monthKey saat dilimine göre: UTC 31 Ocak 22:30, İstanbul'da 1 Şubat", () => {
    expect(monthKey(new Date("2026-01-31T22:30:00Z"))).toBe("2026-02");
    expect(monthKey(new Date("2026-01-31T22:30:00Z"), "UTC")).toBe("2026-01");
  });
  it("lastMonths yıl sınırını aşar, eskiden yeniye", () => {
    expect(lastMonths(NOW, 4)).toEqual(["2025-12", "2026-01", "2026-02", "2026-03"]);
    expect(lastMonths(NOW, 1)).toEqual(["2026-03"]);
  });
});

describe("buildReport", () => {
  it("boş veride çalışır: aylar dolu, satırlar sıfır, oranlar null", () => {
    const r = buildReport({ leads: [], events: [], now: NOW, months: 3 });
    expect(r.months).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(r.wonByMonth).toEqual([
      { month: "2026-01", count: 0, totalEur: 0 },
      { month: "2026-02", count: 0, totalEur: 0 },
      { month: "2026-03", count: 0, totalEur: 0 },
    ]);
    expect(r.kpis).toEqual({
      openCount: 0,
      openTotalEur: 0,
      wonThisMonth: { count: 0, totalEur: 0 },
      closedWon: 0,
      closedLost: 0,
      winRate: null,
    });
    expect(r.conversionByStage.map((c) => [c.stage, c.reached, c.rate])).toEqual([
      ["NEW", 0, null],
      ["CONTACTED", 0, null],
      ["QUALIFIED", 0, null],
      ["PROPOSAL", 0, null],
    ]);
    expect(r.openByCountry).toEqual([]);
    expect(r.lostReasons).toEqual([]);
    expect(r.leadsBySource).toEqual([]);
  });

  it("aylık kazanılan, dönüşüm, ülkeye göre açık hat, kayıp nedenleri, kaynağa göre lead; geri alınan ve test dışarıda", () => {
    const leads = [
      // A: kazanıldı Şubat, 95.000 EUR, TR, meta
      lead("A", { currentStage: "WON", source: "meta_form", createdAt: new Date("2026-01-10T00:00:00Z") }),
      // B: kazanıldı Mart, 10.000 USD → 9.200 EUR, GB, web
      lead("B", {
        currentStage: "WON",
        source: "web_form",
        country: "GB",
        createdAt: new Date("2026-02-05T00:00:00Z"),
      }),
      // C: kaybedildi (rakip), PROPOSAL'a ulaşmış, DE
      lead("C", { currentStage: "LOST", source: "meta_form", country: "DE" }),
      // D: açık, PROPOSAL 20.000 EUR, TR
      lead("D", { currentStage: "PROPOSAL", source: "google_form" }),
      // E: açık, CONTACTED, ülke yok, manuel
      lead("E", { currentStage: "CONTACTED", country: null }),
      // F: kaybedildi nedensiz, yalnız NEW'den
      lead("F", { currentStage: "LOST" }),
      // T: test lead'i, hiçbir yerde sayılmaz
      lead("T", { currentStage: "WON", isTest: true }),
      // G: kazanıldı ama geri alındı → bugün PROPOSAL, açık sayılır; WON olayı sayılmaz
      lead("G", { currentStage: "PROPOSAL", source: "web_form", createdAt: new Date("2025-11-01T00:00:00Z") }),
    ];
    const events = [
      ...path("A", [
        ["NEW", "2026-01-10T00:00:00Z"],
        ["CONTACTED", "2026-01-12T00:00:00Z"],
        ["QUALIFIED", "2026-01-20T00:00:00Z"],
        ["PROPOSAL", "2026-02-01T00:00:00Z", { value: { amount: 90_000, currency: "EUR" } }],
        ["WON", "2026-02-20T00:00:00Z", { value: { amount: 95_000, currency: "EUR" } }],
      ]),
      ...path("B", [
        ["NEW", "2026-02-05T00:00:00Z"],
        ["CONTACTED", "2026-02-06T00:00:00Z"],
        ["QUALIFIED", "2026-02-07T00:00:00Z"],
        ["PROPOSAL", "2026-02-08T00:00:00Z"],
        ["WON", "2026-03-02T00:00:00Z", { value: { amount: 10_000, currency: "USD" } }],
      ]),
      ...path("C", [
        ["NEW", "2026-02-01T00:00:00Z"],
        ["CONTACTED", "2026-02-02T00:00:00Z"],
        ["QUALIFIED", "2026-02-03T00:00:00Z"],
        ["PROPOSAL", "2026-02-04T00:00:00Z", { value: { amount: 50_000, currency: "EUR" } }],
        ["LOST", "2026-02-10T00:00:00Z", { lostReasonCode: "competitor" }],
      ]),
      ...path("D", [
        ["NEW", "2026-02-01T00:00:00Z"],
        ["CONTACTED", "2026-02-02T00:00:00Z"],
        ["QUALIFIED", "2026-02-03T00:00:00Z"],
        ["PROPOSAL", "2026-02-04T00:00:00Z", { value: { amount: 20_000, currency: "EUR" } }],
      ]),
      ...path("E", [
        ["NEW", "2026-02-01T00:00:00Z"],
        ["CONTACTED", "2026-02-02T00:00:00Z"],
      ]),
      ...path("F", [
        ["NEW", "2026-02-01T00:00:00Z"],
        ["LOST", "2026-02-02T00:00:00Z"],
      ]),
      ...path("T", [
        ["NEW", "2026-02-01T00:00:00Z"],
        ["WON", "2026-02-02T00:00:00Z", { value: { amount: 1, currency: "EUR" } }],
      ]),
      ...path("G", [
        ["NEW", "2025-11-01T00:00:00Z"],
        ["CONTACTED", "2026-01-02T00:00:00Z"],
        ["QUALIFIED", "2026-01-03T00:00:00Z"],
        ["PROPOSAL", "2026-01-04T00:00:00Z", { value: { amount: 30_000, currency: "EUR" } }],
        [
          "WON",
          "2026-03-05T00:00:00Z",
          { value: { amount: 30_000, currency: "EUR" }, undoneAt: new Date("2026-03-05T00:05:00Z") },
        ],
      ]),
    ];
    const r = buildReport({ leads, events, now: NOW, months: 3 });

    expect(r.wonByMonth).toEqual([
      { month: "2026-01", count: 0, totalEur: 0 },
      { month: "2026-02", count: 1, totalEur: 95_000 },
      { month: "2026-03", count: 1, totalEur: 9_200 },
    ]);
    expect(r.kpis).toEqual({
      openCount: 3, // D, E, G
      openTotalEur: 50_000, // D 20.000 + G 30.000 (son geçerli teklif) + E 0
      wonThisMonth: { count: 1, totalEur: 9_200 },
      closedWon: 2,
      closedLost: 2,
      winRate: 0.5,
    });
    // Ulaşan: NEW herkes (7), CONTACTED A B C D E G (6), QUALIFIED A B C D G (5), PROPOSAL A B C D G (5).
    // Kapananlar içinde kazanılan: NEW 2/4, CONTACTED 2/3, QUALIFIED 2/3, PROPOSAL 2/3.
    expect(r.conversionByStage).toEqual([
      { stage: "NEW", reached: 7, closed: 4, won: 2, rate: 0.5 },
      { stage: "CONTACTED", reached: 6, closed: 3, won: 2, rate: 0.67 },
      { stage: "QUALIFIED", reached: 5, closed: 3, won: 2, rate: 0.67 },
      { stage: "PROPOSAL", reached: 5, closed: 3, won: 2, rate: 0.67 },
    ]);
    expect(r.openByCountry).toEqual([
      { country: "TR", count: 2, totalEur: 50_000 },
      { country: "", count: 1, totalEur: 0 },
    ]);
    expect(r.lostReasons).toEqual([
      { code: "competitor", count: 1 },
      { code: "unspecified", count: 1 },
    ]);
    // Dönem Oca–Mar: A (Oca), B (Şub), C D E F (Şub); G Kasım'da, dışarıda; T test.
    expect(r.leadsBySource).toEqual([
      { source: "manual", count: 2, won: 0 },
      { source: "meta_form", count: 2, won: 1 },
      { source: "google_form", count: 1, won: 0 },
      { source: "web_form", count: 1, won: 1 },
    ]);
    // Farklı kur tablosu aylık toplamı değiştirir.
    const r2 = buildReport({ leads, events, now: NOW, months: 3, rates: { EUR: 1, USD: 1 } });
    expect(r2.wonByMonth[2]?.totalEur).toBe(10_000);
  });
});
