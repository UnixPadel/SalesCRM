import { describe, expect, it } from "vitest";
import {
  STAGE_CODES,
  allowedTransitions,
  canTransition,
  isTerminal,
  parseStageCode,
  skippedStages,
  type StageCode,
} from "./stage";

/** 6 × 6 geçiş matrisi: satır = mevcut, sütun = hedef. 1 = izinli. */
const MATRIX: Record<StageCode, Record<StageCode, 0 | 1>> = {
  //           NEW CONTACTED QUALIFIED PROPOSAL WON LOST
  NEW: { NEW: 0, CONTACTED: 1, QUALIFIED: 1, PROPOSAL: 1, WON: 1, LOST: 1 },
  CONTACTED: { NEW: 0, CONTACTED: 0, QUALIFIED: 1, PROPOSAL: 1, WON: 1, LOST: 1 },
  QUALIFIED: { NEW: 0, CONTACTED: 0, QUALIFIED: 0, PROPOSAL: 1, WON: 1, LOST: 1 },
  PROPOSAL: { NEW: 0, CONTACTED: 0, QUALIFIED: 0, PROPOSAL: 0, WON: 1, LOST: 1 },
  WON: { NEW: 0, CONTACTED: 0, QUALIFIED: 0, PROPOSAL: 0, WON: 0, LOST: 0 },
  LOST: { NEW: 0, CONTACTED: 0, QUALIFIED: 0, PROPOSAL: 0, WON: 0, LOST: 0 },
};

describe("aşama geçiş matrisi (6 × 6)", () => {
  for (const from of STAGE_CODES) {
    for (const to of STAGE_CODES) {
      it(`${from} → ${to}: ${MATRIX[from][to] ? "izinli" : "yasak"}`, () => {
        expect(canTransition(from, to)).toBe(MATRIX[from][to] === 1);
      });
    }
  }

  it("allowedTransitions matrisle birebir", () => {
    for (const from of STAGE_CODES) {
      expect(allowedTransitions(from)).toEqual(STAGE_CODES.filter((to) => MATRIX[from][to] === 1));
    }
  });

  it("terminal aşamalar WON ve LOST", () => {
    expect(STAGE_CODES.filter(isTerminal)).toEqual(["WON", "LOST"]);
  });
});

describe("atlanan aşamalar (auto_fill)", () => {
  it.each<[StageCode, StageCode, StageCode[]]>([
    ["NEW", "CONTACTED", []],
    ["NEW", "QUALIFIED", ["CONTACTED"]],
    ["NEW", "PROPOSAL", ["CONTACTED", "QUALIFIED"]],
    ["NEW", "WON", ["CONTACTED", "QUALIFIED", "PROPOSAL"]],
    ["CONTACTED", "WON", ["QUALIFIED", "PROPOSAL"]],
    ["QUALIFIED", "PROPOSAL", []],
    ["NEW", "LOST", []],
    ["PROPOSAL", "LOST", []],
    ["WON", "LOST", []],
    ["PROPOSAL", "NEW", []],
  ])("%s → %s atlar: %j", (from, to, expected) => {
    expect(skippedStages(from, to)).toEqual(expected);
  });
});

describe("parseStageCode", () => {
  it("geçerli ve geçersiz", () => {
    expect(parseStageCode("WON")).toEqual({ ok: true, value: "WON" });
    const r = parseStageCode("won");
    expect(!r.ok && r.error.code).toBe("stage.unknown");
    expect(parseStageCode(3).ok).toBe(false);
  });
});
