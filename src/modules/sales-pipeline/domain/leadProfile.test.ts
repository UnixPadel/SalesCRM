import { describe, expect, it } from "vitest";
import {
  AD_SURFACE_RE,
  bandForCount,
  COURT_COUNT_BANDS,
  CUSTOMER_PROFILES,
  CUSTOMER_STATUS_STYLE,
  CUSTOMER_STATUSES,
  INSTALL_SITES,
  INSTALL_TIMELINES,
  isAdSurface,
  isCourtCountBand,
  isCustomerProfile,
  isCustomerStatus,
  isHotLead,
  isInstallSite,
  isInstallTimeline,
  timelineHeat,
} from "./leadProfile";
import { STAGE_CODES } from "./stage";

describe("kod listeleri (§3.2 sırası)", () => {
  it("Excel LİSTELER sırası ve DB CHECK ile aynı kodlar", () => {
    expect(CUSTOMER_STATUSES).toEqual([
      "interested",
      "not_interested",
      "project_phase",
      "collecting_prices",
      "buyer_ready",
    ]);
    expect(INSTALL_SITES).toEqual([
      "covered_court",
      "no_site_yet",
      "indoor_hall",
      "beach_windy",
      "rooftop",
      "existing_ground",
      "other",
    ]);
    expect(INSTALL_TIMELINES).toEqual(["m0_3", "m3_6", "m6_12", "researching"]);
    expect(CUSTOMER_PROFILES).toEqual([
      "investor",
      "club_operator",
      "private_home",
      "public_facility",
      "hospitality_residential",
      "distributor",
    ]);
    expect(COURT_COUNT_BANDS).toEqual(["1", "2_3", "4_6", "7_plus"]);
  });

  it("her müşteri durumunun tonu ve ikonu var (renk tek başına anlam taşımaz) [K-M2]", () => {
    expect(Object.keys(CUSTOMER_STATUS_STYLE).sort()).toEqual([...CUSTOMER_STATUSES].sort());
    for (const s of CUSTOMER_STATUSES) expect(CUSTOMER_STATUS_STYLE[s].icon).not.toBe("");
    expect(new Set(CUSTOMER_STATUSES.map((s) => CUSTOMER_STATUS_STYLE[s].tone)).size).toBe(5);
  });

  it.each([
    [isCustomerStatus, CUSTOMER_STATUSES],
    [isInstallSite, INSTALL_SITES],
    [isInstallTimeline, INSTALL_TIMELINES],
    [isCustomerProfile, CUSTOMER_PROFILES],
    [isCourtCountBand, COURT_COUNT_BANDS],
  ] as const)("kod denetçisi listedeki her kodu kabul eder, başkasını etmez (%#)", (guard, list) => {
    for (const c of list) expect(guard(c)).toBe(true);
    for (const bad of ["", "INTERESTED", "x", null, undefined, 1, {}]) expect(guard(bad)).toBe(false);
  });
});

describe("timelineHeat ve sıcak lead", () => {
  it("yalnız 3 ay içinde sıcak", () => {
    expect(INSTALL_TIMELINES.map(timelineHeat)).toEqual(["hot", "warm", "cool", "cold"]);
    expect(timelineHeat(null)).toBeNull();
  });

  it("isHotLead: m0_3 ve açık aşama", () => {
    for (const stage of STAGE_CODES) {
      expect(isHotLead({ installTimeline: "m0_3", currentStage: stage })).toBe(stage !== "WON" && stage !== "LOST");
    }
    expect(isHotLead({ installTimeline: "m3_6", currentStage: "NEW" })).toBe(false);
    expect(isHotLead({ installTimeline: null, currentStage: "NEW" })).toBe(false);
  });
});

describe("bandForCount", () => {
  it.each([
    [1, "1"],
    [2, "2_3"],
    [3, "2_3"],
    [4, "4_6"],
    [6, "4_6"],
    [7, "7_plus"],
    [40, "7_plus"],
    [0, null],
    [-1, null],
    [2.5, null],
    [Number.NaN, null],
  ] as const)("%d → %s", (n, band) => {
    expect(bandForCount(n)).toBe(band);
  });
});

describe("reklam yüzeyi (opak kod)", () => {
  it.each(["ig", "fb", "web", "whatsapp", "a_1", "x".repeat(32)])("%s kabul", (v) => {
    expect(isAdSurface(v)).toBe(true);
    expect(AD_SURFACE_RE.test(v)).toBe(true);
  });
  it.each(["", "IG", "web site", "a-b", "x".repeat(33), null, 3])("%j red", (v) => {
    expect(isAdSurface(v)).toBe(false);
  });
});
