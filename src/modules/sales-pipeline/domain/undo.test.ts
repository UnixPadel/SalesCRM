import { describe, expect, it } from "vitest";
import { MINUTE, unwrap } from "../../shared/kernel";
import { resolveAssignee } from "./assignment";
import type { StageEvent } from "./lead";
import type { StageCode } from "./stage";
import { planUndo } from "./undo";

const T0 = new Date("2026-03-01T10:00:00Z");
const at = (min: number) => new Date(T0.getTime() + min * MINUTE);

let seq = 0;
const ev = (stage: StageCode, changeId: string, minutes: number, over: Partial<StageEvent> = {}): StageEvent => ({
  id: `e${++seq}`,
  leadId: "L",
  changeId,
  stageCode: stage,
  occurredAt: at(minutes),
  sequence: seq,
  actorUserId: "u1",
  origin: "manual",
  value: null,
  lostReasonCode: null,
  qualificationAnswers: null,
  undoneAt: null,
  ...over,
});

const creation = () => ev("NEW", "c0", 0, { origin: "system", actorUserId: null });

describe("planUndo (10 dakika)", () => {
  it("son değişikliği, auto_fill satırlarıyla birlikte, önceki aşamaya geri alır", () => {
    seq = 0;
    const events = [creation(), ev("CONTACTED", "c1", 5, { origin: "auto_fill" }), ev("QUALIFIED", "c1", 5)];
    const plan = unwrap(
      planUndo({ events, now: at(9), windowMs: 10 * MINUTE, actorUserId: "u1", actorIsAdmin: false }),
    );
    expect(plan).toEqual({ changeId: "c1", eventIds: ["e2", "e3"], revertTo: "NEW" });
  });

  it("yalnız ilk (system) olay varsa geri alınacak bir şey yok", () => {
    seq = 0;
    const r = planUndo({
      events: [creation()],
      now: at(1),
      windowMs: 10 * MINUTE,
      actorUserId: "u1",
      actorIsAdmin: true,
    });
    expect(!r.ok && r.error.code).toBe("undo.nothing");
  });

  it("süre dolunca reddeder (tam 10 dk izinli, 10 dk 1 sn değil)", () => {
    seq = 0;
    const events = [creation(), ev("CONTACTED", "c1", 0)];
    expect(planUndo({ events, now: at(10), windowMs: 10 * MINUTE, actorUserId: "u1", actorIsAdmin: false }).ok).toBe(
      true,
    );
    const late = planUndo({
      events,
      now: new Date(at(10).getTime() + 1000),
      windowMs: 10 * MINUTE,
      actorUserId: "u1",
      actorIsAdmin: false,
    });
    expect(!late.ok && late.error.code).toBe("undo.expired");
  });

  it("başkasının değişikliğini yalnız admin geri alır", () => {
    seq = 0;
    const events = [creation(), ev("CONTACTED", "c1", 0)];
    const other = planUndo({ events, now: at(1), windowMs: 10 * MINUTE, actorUserId: "u2", actorIsAdmin: false });
    expect(!other.ok && other.error.code).toBe("undo.not_owner");
    expect(planUndo({ events, now: at(1), windowMs: 10 * MINUTE, actorUserId: "u2", actorIsAdmin: true }).ok).toBe(
      true,
    );
  });

  it("geri alınmış olaylar yok sayılır; bir önceki canlı değişiklik hedeflenir", () => {
    seq = 0;
    const events = [creation(), ev("CONTACTED", "c1", 1), ev("QUALIFIED", "c2", 2, { undoneAt: at(3) })];
    const plan = unwrap(
      planUndo({ events, now: at(4), windowMs: 10 * MINUTE, actorUserId: "u1", actorIsAdmin: false }),
    );
    expect(plan).toEqual({ changeId: "c1", eventIds: ["e2"], revertTo: "NEW" });
  });
});

describe("resolveAssignee (ülke → satışçı)", () => {
  const rules = [
    { countryCode: "TR", assignedUserId: "u-tr", fallbackUserId: "u-tr2" },
    { countryCode: "GB", assignedUserId: "u-gb", fallbackUserId: null },
  ];
  it("kural varsa sorumlu, pasifse yedek, o da yoksa havuz", () => {
    expect(resolveAssignee("tr", rules)).toBe("u-tr");
    expect(resolveAssignee("TR", rules, new Set(["u-tr"]))).toBe("u-tr2");
    expect(resolveAssignee("TR", rules, new Set(["u-tr", "u-tr2"]))).toBeNull();
    expect(resolveAssignee("GB", rules, new Set(["u-gb"]))).toBeNull();
  });
  it("kural yoksa ya da ülke boşsa havuz", () => {
    expect(resolveAssignee("DE", rules)).toBeNull();
    expect(resolveAssignee(null, rules)).toBeNull();
    expect(resolveAssignee("", rules)).toBeNull();
  });
});
