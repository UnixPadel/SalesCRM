import { describe, expect, it } from "vitest";
import { unwrap } from "../../shared/kernel";
import { PlatformLeadId, isLeadSource } from "./lead";
import { checkQualification, normalizeAnswers } from "./qualification";
import { planStageChange, type StageChangeRequest } from "./transition";

const REASONS = ["price_too_high", "unqualified"];
const base = (over: Partial<StageChangeRequest>): StageChangeRequest => ({
  currentStage: "NEW",
  target: "CONTACTED",
  knownLostReasons: REASONS,
  ...over,
});
const YES = { budget_approved: true, site_known: true, install_within_12m: true };

describe("planStageChange", () => {
  it("basit ileri geçiş tek manual olay üretir", () => {
    const plan = unwrap(planStageChange(base({})));
    expect(plan).toEqual({
      from: "NEW",
      to: "CONTACTED",
      events: [
        { stageCode: "CONTACTED", origin: "manual", value: null, lostReasonCode: null, qualificationAnswers: null },
      ],
    });
  });

  it("NEW → PROPOSAL: CONTACTED ve QUALIFIED auto_fill, PROPOSAL manual", () => {
    const plan = unwrap(planStageChange(base({ target: "PROPOSAL" })));
    expect(plan.events.map((e) => [e.stageCode, e.origin])).toEqual([
      ["CONTACTED", "auto_fill"],
      ["QUALIFIED", "auto_fill"],
      ["PROPOSAL", "manual"],
    ]);
  });

  it("aynı aşama, geriye ve terminalden çıkış reddedilir", () => {
    const same = planStageChange(base({ currentStage: "QUALIFIED", target: "QUALIFIED" }));
    expect(!same.ok && same.error.code).toBe("stage.same");
    const back = planStageChange(base({ currentStage: "PROPOSAL", target: "CONTACTED" }));
    expect(!back.ok && back.error.code).toBe("stage.backward");
    const won = planStageChange(base({ currentStage: "WON", target: "LOST", lostReasonCode: "unqualified" }));
    expect(!won.ok && won.error.code).toBe("stage.terminal");
    const lost = planStageChange(base({ currentStage: "LOST", target: "WON", value: { amount: 1, currency: "EUR" } }));
    expect(!lost.ok && lost.error.code).toBe("stage.terminal");
  });

  describe("WON", () => {
    it("tutar zorunlu ve doğrulanır", () => {
      const none = planStageChange(base({ currentStage: "PROPOSAL", target: "WON" }));
      expect(!none.ok && none.error.code).toBe("stage.value_required");
      const bad = planStageChange(
        base({ currentStage: "PROPOSAL", target: "WON", value: { amount: -5, currency: "EUR" } }),
      );
      expect(!bad.ok && bad.error.code).toBe("money.amount_negative");
      const badCur = planStageChange(
        base({ currentStage: "PROPOSAL", target: "WON", value: { amount: 5, currency: "E" } }),
      );
      expect(!badCur.ok && badCur.error.code).toBe("money.currency_invalid");
    });
    it("tutar yalnız WON olayına yazılır, auto_fill'lere değil", () => {
      const plan = unwrap(
        planStageChange(
          base({ currentStage: "CONTACTED", target: "WON", value: { amount: 42000.456, currency: "eur" } }),
        ),
      );
      expect(plan.events.map((e) => e.stageCode)).toEqual(["QUALIFIED", "PROPOSAL", "WON"]);
      expect(plan.events[2]?.value).toEqual({ amount: 42000.46, currency: "EUR" });
      expect(plan.events[0]?.value).toBeNull();
    });
  });

  describe("LOST", () => {
    it("neden zorunlu ve listede olmalı; ara aşama yazılmaz", () => {
      const none = planStageChange(base({ target: "LOST" }));
      expect(!none.ok && none.error.code).toBe("stage.reason_required");
      const unknown = planStageChange(base({ target: "LOST", lostReasonCode: "mars" }));
      expect(!unknown.ok && unknown.error.code).toBe("stage.reason_unknown");
      const plan = unwrap(planStageChange(base({ target: "LOST", lostReasonCode: " unqualified " })));
      expect(plan.events).toHaveLength(1);
      expect(plan.events[0]).toMatchObject({ stageCode: "LOST", origin: "manual", lostReasonCode: "unqualified" });
    });
  });

  describe("QUALIFIED", () => {
    it("üç soru da yanıtlanmalı ve üçü de evet", () => {
      const inc = planStageChange(base({ target: "QUALIFIED", qualificationAnswers: { budget_approved: true } }));
      expect(!inc.ok && inc.error.code).toBe("stage.qualification_incomplete");
      expect(!inc.ok && inc.error.details["missing"]).toEqual(["site_known", "install_within_12m"]);
      const no = planStageChange(base({ target: "QUALIFIED", qualificationAnswers: { ...YES, site_known: false } }));
      expect(!no.ok && no.error.code).toBe("stage.not_qualified");
      const plan = unwrap(
        planStageChange(base({ target: "QUALIFIED", qualificationAnswers: { ...YES, extra: true } })),
      );
      expect(plan.events.map((e) => e.stageCode)).toEqual(["CONTACTED", "QUALIFIED"]);
      expect(plan.events[1]?.qualificationAnswers).toEqual(YES);
    });
    it("QUALIFIED atlanırsa (NEW → PROPOSAL) sorular istenmez", () => {
      expect(planStageChange(base({ target: "PROPOSAL" })).ok).toBe(true);
    });
  });
});

describe("qualification yardımcıları", () => {
  it("checkQualification üç durumu ayırır", () => {
    expect(checkQualification(null)).toEqual({
      status: "incomplete",
      missing: ["budget_approved", "site_known", "install_within_12m"],
    });
    expect(checkQualification({ ...YES, budget_approved: false })).toEqual({
      status: "not_qualified",
      failed: ["budget_approved"],
    });
    expect(checkQualification(YES)).toEqual({ status: "qualified" });
  });
  it("normalizeAnswers fazlayı atar, eksiği false yapar", () => {
    expect(normalizeAnswers({ budget_approved: true, x: true })).toEqual({
      budget_approved: true,
      site_known: false,
      install_within_12m: false,
    });
  });
});

describe("lead yardımcıları", () => {
  it("PlatformLeadId metin, 15–17 haneli Meta kimliği bozulmaz", () => {
    expect(unwrap(PlatformLeadId.parse(" 12345678901234567 ")).value).toBe("12345678901234567");
    expect(PlatformLeadId.parse("").ok).toBe(false);
    expect(PlatformLeadId.parse("a b").ok).toBe(false);
    expect(String(unwrap(PlatformLeadId.parse(1234)))).toBe("1234");
  });
  it("isLeadSource", () => {
    expect(isLeadSource("manual")).toBe(true);
    expect(isLeadSource("tiktok")).toBe(false);
  });
});
