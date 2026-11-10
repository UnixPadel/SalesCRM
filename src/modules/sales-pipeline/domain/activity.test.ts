import { describe, expect, it } from "vitest";
import { unwrap } from "../../shared/kernel";
import {
  atLocalHour,
  bucketOf,
  calendarDay,
  followUpFor,
  isRotting,
  NO_CONTACT_FIELDS,
  summarizeActivities,
  validateActivity,
  type Activity,
} from "./activity";

const act = (over: Partial<Activity>): Activity => ({
  id: "a",
  leadId: "l",
  type: "call",
  subject: "Arama",
  dueAt: new Date("2026-03-02T08:00:00Z"),
  doneAt: null,
  notes: "",
  autoCreated: false,
  createdByChangeId: null,
  createdByUserId: null,
  legacyId: null,
  ...NO_CONTACT_FIELDS,
  createdAt: new Date("2026-03-01T10:00:00Z"),
  updatedAt: new Date("2026-03-01T10:00:00Z"),
  ...over,
});

describe("takvim ve saat dilimi", () => {
  it("calendarDay İstanbul'a göre: UTC 22:30, yerel ertesi gün", () => {
    expect(calendarDay(new Date("2026-03-01T22:30:00Z"))).toBe("2026-03-02");
    expect(calendarDay(new Date("2026-03-01T20:59:00Z"))).toBe("2026-03-01");
  });

  it("atLocalHour: 3 gün sonra yerel 09:00 = 06:00Z (İstanbul +3)", () => {
    expect(atLocalHour(new Date("2026-03-01T10:00:00Z"), 3, 9).toISOString()).toBe("2026-03-04T06:00:00.000Z");
    // Gece yarısına yakın: yerel gün zaten 2 Mart, 3 gün sonrası 5 Mart.
    expect(atLocalHour(new Date("2026-03-01T22:30:00Z"), 3, 9).toISOString()).toBe("2026-03-05T06:00:00.000Z");
    // Başka saat dilimi: New York, yaz saati öncesi -5.
    expect(atLocalHour(new Date("2026-03-01T10:00:00Z"), 1, 9, "America/New_York").toISOString()).toBe(
      "2026-03-02T14:00:00.000Z",
    );
  });

  it("bucketOf takvim gününe göre: dün gecikmiş, bugün (saat geçmiş olsa da) bugün, yarın yaklaşan", () => {
    const now = new Date("2026-03-02T12:00:00Z");
    expect(bucketOf(new Date("2026-03-01T20:00:00Z"), now)).toBe("overdue");
    expect(bucketOf(new Date("2026-03-02T05:00:00Z"), now)).toBe("today");
    expect(bucketOf(new Date("2026-03-02T19:00:00Z"), now)).toBe("today");
    expect(bucketOf(new Date("2026-03-02T21:30:00Z"), now)).toBe("upcoming"); // yerel 3 Mart 00:30
  });
});

describe("kural 2: teklif takibi", () => {
  it("yalnız PROPOSAL için, 3 gün sonra 09:00 arama", () => {
    const f = followUpFor("PROPOSAL", new Date("2026-03-01T10:00:00Z"));
    expect(f).toEqual({ type: "call", subject: "Teklif takibi", dueAt: new Date("2026-03-04T06:00:00.000Z") });
    for (const s of ["NEW", "CONTACTED", "QUALIFIED", "WON", "LOST"] as const) {
      expect(followUpFor(s, new Date())).toBeNull();
    }
  });
});

describe("kural 1: takipsiz", () => {
  it("açık aşamada açık aktivite yoksa takipsiz; terminalde asla", () => {
    expect(isRotting("CONTACTED", 0)).toBe(true);
    expect(isRotting("CONTACTED", 1)).toBe(false);
    expect(isRotting("WON", 0)).toBe(false);
    expect(isRotting("LOST", 0)).toBe(false);
  });

  it("özet: açık sayısı, en yakın vadeli açık aktivite; bitmişler sayılmaz", () => {
    const s = summarizeActivities("QUALIFIED", [
      act({ id: "late", dueAt: new Date("2026-03-05T08:00:00Z") }),
      act({ id: "done", dueAt: new Date("2026-03-01T08:00:00Z"), doneAt: new Date("2026-03-01T09:00:00Z") }),
      act({ id: "soon", type: "meeting", subject: "Keşif", dueAt: new Date("2026-03-02T08:00:00Z") }),
    ]);
    expect(s).toEqual({
      openActivities: 2,
      nextActivity: { id: "soon", type: "meeting", subject: "Keşif", dueAt: new Date("2026-03-02T08:00:00Z") },
      rotting: false,
    });
    expect(summarizeActivities("QUALIFIED", [])).toEqual({ openActivities: 0, nextActivity: null, rotting: true });
  });
});

describe("validateActivity", () => {
  it("tür ve tarih zorunlu; konu boşsa türün varsayılanı; metinler kırpılır", () => {
    const bad = validateActivity({ type: "fax", dueAt: new Date() });
    expect(!bad.ok && bad.error.code).toBe("activity.type_unknown");
    const noDate = validateActivity({ type: "call", dueAt: null });
    expect(!noDate.ok && noDate.error.code).toBe("activity.due_required");
    const nan = validateActivity({ type: "call", dueAt: new Date("x") });
    expect(!nan.ok && nan.error.code).toBe("activity.due_required");
    const ok = unwrap(validateActivity({ type: "site_visit", subject: "  ", dueAt: new Date(0), notes: " n " }));
    expect(ok).toEqual({ type: "site_visit", subject: "Saha ziyareti", dueAt: new Date(0), notes: "n" });
  });
});
