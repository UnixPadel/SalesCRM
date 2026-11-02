import { describe, expect, it } from "vitest";
import { unwrap } from "../../shared/kernel";
import type { StageEvent } from "./lead";
import {
  DEFAULT_EUR_RATES,
  columnStats,
  daysBetween,
  isCalendarDate,
  parseEurRates,
  parseLeadFields,
  stageSummary,
  toEur,
} from "./opportunity";

const ev = (over: Partial<StageEvent>): StageEvent => ({
  id: "e",
  leadId: "l",
  changeId: "c",
  stageCode: "NEW",
  occurredAt: new Date("2026-01-01T00:00:00Z"),
  sequence: 1,
  actorUserId: null,
  origin: "manual",
  value: null,
  lostReasonCode: null,
  qualificationAnswers: null,
  undoneAt: null,
  ...over,
});

describe("parseLeadFields: fırsat alanları doğrulama", () => {
  it("yalnız verilen anahtarlar döner; boş metin ve null sayı/tarih 'temizle' demektir", () => {
    expect(unwrap(parseLeadFields({}))).toEqual({});
    expect(unwrap(parseLeadFields({ courtCount: "", expectedCloseDate: null, courtModel: "  Panoramic  " }))).toEqual({
      courtCount: null,
      expectedCloseDate: null,
      courtModel: "Panoramic",
    });
    expect(unwrap(parseLeadFields({ courtCount: "4", expectedCloseDate: "2026-12-15", notes: " n " }))).toEqual({
      courtCount: 4,
      expectedCloseDate: "2026-12-15",
      notes: "n",
    });
  });

  it("kort sayısı 0–999 tam sayı; ondalık, negatif ve metin reddedilir", () => {
    for (const bad of [-1, 1.5, 1000, "abc", true]) {
      const r = parseLeadFields({ courtCount: bad });
      expect(!r.ok && r.error.code).toBe("lead.court_count_invalid");
    }
    expect(unwrap(parseLeadFields({ courtCount: 0 }))).toEqual({ courtCount: 0 });
    expect(unwrap(parseLeadFields({ courtCount: 999 }))).toEqual({ courtCount: 999 });
  });

  it("beklenen kapanış gerçek bir takvim günü olmalı", () => {
    expect(isCalendarDate("2026-02-28")).toBe(true);
    expect(isCalendarDate("2026-02-30")).toBe(false);
    expect(isCalendarDate("2026-13-01")).toBe(false);
    expect(isCalendarDate("15.12.2026")).toBe(false);
    for (const bad of ["2026-02-30", "yarın", 20261215]) {
      const r = parseLeadFields({ expectedCloseDate: bad });
      expect(!r.ok && r.error.code).toBe("lead.expected_close_invalid");
    }
  });

  it("metin alanları uzunluk sınırı ve tip", () => {
    expect(parseLeadFields({ courtModel: "x".repeat(65) }).ok).toBe(false);
    expect(parseLeadFields({ company: "x".repeat(201) }).ok).toBe(false);
    expect(parseLeadFields({ notes: "x".repeat(4001) }).ok).toBe(false);
    const r = parseLeadFields({ city: 42 });
    expect(!r.ok && r.error.code).toBe("lead.city_invalid");
    expect(unwrap(parseLeadFields({ productInterest: null }))).toEqual({ productInterest: "" });
  });
});

describe("stageSummary: aşamaya giriş anı ve son tutar", () => {
  const lead = { currentStage: "PROPOSAL" as const, createdAt: new Date("2026-01-01T00:00:00Z") };

  it("olay yoksa giriş anı oluşturulma anı, tutar yok", () => {
    expect(stageSummary(lead, [])).toEqual({ stageEnteredAt: lead.createdAt, value: null });
  });

  it("bulunduğu aşamanın son geçerli olayı girişi, son geçerli tutar değeri verir; geri alınanlar sayılmaz", () => {
    const events = [
      ev({ sequence: 1, stageCode: "NEW", occurredAt: new Date("2026-01-01T00:00:00Z") }),
      ev({ sequence: 2, stageCode: "CONTACTED", occurredAt: new Date("2026-01-03T00:00:00Z") }),
      ev({
        sequence: 3,
        stageCode: "PROPOSAL",
        occurredAt: new Date("2026-01-05T00:00:00Z"),
        value: { amount: 80_000, currency: "EUR" },
      }),
      ev({
        sequence: 4,
        stageCode: "WON",
        occurredAt: new Date("2026-01-06T00:00:00Z"),
        value: { amount: 95_000, currency: "EUR" },
        undoneAt: new Date("2026-01-06T00:05:00Z"),
      }),
    ];
    expect(stageSummary(lead, events)).toEqual({
      stageEnteredAt: new Date("2026-01-05T00:00:00Z"),
      value: { amount: 80_000, currency: "EUR" },
    });
    // Teklif iki kez verildiyse (geri al → yeniden) son geçerli olan sayılır.
    const again = [
      ...events,
      ev({
        sequence: 5,
        stageCode: "PROPOSAL",
        occurredAt: new Date("2026-01-08T00:00:00Z"),
        value: { amount: 82_000, currency: "USD" },
      }),
    ];
    expect(stageSummary(lead, again)).toEqual({
      stageEnteredAt: new Date("2026-01-08T00:00:00Z"),
      value: { amount: 82_000, currency: "USD" },
    });
  });
});

describe("kurlar ve kolon istatistikleri (kural 4)", () => {
  it("parseEurRates: boş → varsayılan; JSON tablo EUR'u 1'e sabitler; bozuk girdi hata", () => {
    expect(unwrap(parseEurRates(undefined))).toBe(DEFAULT_EUR_RATES);
    expect(unwrap(parseEurRates(' {"usd": 0.9, "TRY": 0.025, "EUR": 5} '))).toEqual({ EUR: 1, USD: 0.9, TRY: 0.025 });
    expect(!parseEurRates("{").ok).toBe(true);
    expect(!parseEurRates("[1]").ok).toBe(true);
    const r = parseEurRates('{"USD": -1}');
    expect(!r.ok && r.error.code).toBe("eur_rates.invalid_rate");
    expect(!parseEurRates('{"US": 1}').ok).toBe(true);
  });

  it("toEur: çarpan ve yuvarlama; bilinmeyen para birimi null", () => {
    expect(toEur({ amount: 100, currency: "USD" })).toBe(92);
    expect(toEur({ amount: 1000, currency: "try" })).toBe(27);
    expect(toEur({ amount: 1, currency: "XXX" })).toBeNull();
    expect(toEur({ amount: 10, currency: "USD" }, { EUR: 1, USD: 0.333333 })).toBe(3.33);
  });

  it("daysBetween: tam gün aşağı yuvarlar, negatif olmaz", () => {
    const a = new Date("2026-03-01T10:00:00Z");
    expect(daysBetween(a, new Date("2026-03-04T09:59:00Z"))).toBe(2);
    expect(daysBetween(a, new Date("2026-03-04T10:00:00Z"))).toBe(3);
    expect(daysBetween(a, new Date("2026-02-01T00:00:00Z"))).toBe(0);
  });

  it("columnStats: her aşama için adet, toplam EUR, ort. gün; kuru bilinmeyen tutar sayılır ama toplanmaz", () => {
    const now = new Date("2026-03-11T10:00:00Z");
    const d = (iso: string) => new Date(iso);
    const items = [
      { currentStage: "NEW" as const, stageEnteredAt: d("2026-03-10T10:00:00Z"), value: null },
      { currentStage: "NEW" as const, stageEnteredAt: d("2026-03-08T10:00:00Z"), value: null },
      {
        currentStage: "PROPOSAL" as const,
        stageEnteredAt: d("2026-03-01T10:00:00Z"),
        value: { amount: 80_000, currency: "EUR" },
      },
      {
        currentStage: "PROPOSAL" as const,
        stageEnteredAt: d("2026-03-05T10:00:00Z"),
        value: { amount: 10_000, currency: "USD" },
      },
      {
        currentStage: "PROPOSAL" as const,
        stageEnteredAt: d("2026-03-09T10:00:00Z"),
        value: { amount: 5, currency: "XXX" },
      },
      {
        currentStage: "WON" as const,
        stageEnteredAt: d("2026-02-09T10:00:00Z"),
        value: { amount: 95_000, currency: "EUR" },
      },
    ];
    const stats = columnStats(items, now);
    expect(stats.map((s) => s.stage)).toEqual(["NEW", "CONTACTED", "QUALIFIED", "PROPOSAL", "WON", "LOST"]);
    const by = Object.fromEntries(stats.map((s) => [s.stage, s]));
    expect(by["NEW"]).toEqual({ stage: "NEW", count: 2, totalEur: 0, avgDays: 2, unconverted: 0 });
    expect(by["CONTACTED"]).toEqual({ stage: "CONTACTED", count: 0, totalEur: 0, avgDays: 0, unconverted: 0 });
    // 10 + 6 + 2 gün → ort. 6; 80.000 + 9.200 EUR; XXX toplanmaz.
    expect(by["PROPOSAL"]).toEqual({ stage: "PROPOSAL", count: 3, totalEur: 89_200, avgDays: 6, unconverted: 1 });
    expect(by["WON"]).toEqual({ stage: "WON", count: 1, totalEur: 95_000, avgDays: 30, unconverted: 0 });
    // Farklı kur tablosu sonucu değiştirir.
    expect(columnStats(items, now, { EUR: 1, USD: 1 }).find((s) => s.stage === "PROPOSAL")?.totalEur).toBe(90_000);
  });
});
