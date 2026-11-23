import { beforeEach, describe, expect, it } from "vitest";
import { FixedClock, SequentialIdGenerator, silentLogger } from "../../shared/kernel";
import { RESUBMIT_SUBJECT } from "./createLead";
import { InMemoryNotificationStore, NotificationDelivery } from "./notifications";
import {
  InMemorySweepSource,
  NotificationSweeps,
  type DueActivityRow,
  type IdleHotLeadRow,
} from "./notificationSweeps";

/** 2026-11-23: zamanlı bildirimler (iş vadesi, bekleyen sıcak lead). */
const NOW = new Date("2026-11-23T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

let clock: FixedClock;
let store: InMemoryNotificationStore;
let source: InMemorySweepSource;
let sweeps: NotificationSweeps;
let managers: string[];

const activity = (over: Partial<DueActivityRow> = {}): DueActivityRow => ({
  activityId: "a1",
  activityType: "call",
  subject: "Teklif araması",
  dueAt: hoursAgo(1),
  autoCreated: false,
  leadId: "l1",
  userId: "12",
  leadName: "Omar Al Farsi",
  company: "Farsi Sports",
  country: "AE",
  ...over,
});

const hot = (over: Partial<IdleHotLeadRow> = {}): IdleHotLeadRow => ({
  leadId: "l1",
  userId: "12",
  leadName: "Omar Al Farsi",
  company: "Farsi Sports",
  country: "AE",
  lastTouchAt: hoursAgo(30),
  ...over,
});

beforeEach(() => {
  clock = new FixedClock(NOW);
  store = new InMemoryNotificationStore();
  source = new InMemorySweepSource();
  managers = ["admin", "7"];
  sweeps = new NotificationSweeps({
    source,
    delivery: new NotificationDelivery({ notifications: store, logger: silentLogger }),
    managers: async () => managers,
    clock,
    ids: new SequentialIdGenerator(),
    logger: silentLogger,
    hotRepHours: 24,
    hotManagerHours: 48,
  });
});

const sent = () => store.rows.map((r) => `${r.userId}:${r.type}`);

describe("iş vadesi", () => {
  it("saati gelen iş bir kez bildirilir; 24 saat sonra bir kez de 'gecikti'; ertelenince yeniden", async () => {
    source.activities = [activity()];
    expect(await sweeps.run()).toBe(1);
    expect(await sweeps.run()).toBe(0);
    expect(sent()).toEqual(["12:activity_due"]);
    expect(JSON.parse(store.rows[0]!.body)).toMatchObject({ leadName: "Omar Al Farsi", subject: "Teklif araması" });

    clock.advance(24 * 3_600_000);
    expect(await sweeps.run()).toBe(1);
    expect(await sweeps.run()).toBe(0);
    expect(sent()).toEqual(["12:activity_due", "12:activity_overdue"]);

    source.activities = [activity({ dueAt: new Date(clock.now().getTime() - 60_000) })];
    expect(await sweeps.run()).toBe(1);
    expect(sent().at(-1)).toBe("12:activity_due");
  });

  it("vadesi gelmemiş, çok eski ve 'formu tekrar doldurdu' işi için 'iş zamanı' gitmez", async () => {
    source.activities = [
      activity({ activityId: "future", dueAt: hoursAgo(-2) }),
      activity({ activityId: "old", dueAt: hoursAgo(100) }),
      activity({ activityId: "resubmit", autoCreated: true, subject: RESUBMIT_SUBJECT }),
    ];
    expect(await sweeps.run()).toBe(0);
    // Tekrar form işi yapılmadan 24 saat geçerse gecikme bildirimi yine gider.
    source.activities = source.activities.filter((a) => a.activityId === "resubmit");
    clock.advance(24 * 3_600_000);
    await sweeps.run();
    expect(sent()).toEqual(["12:activity_overdue"]);
  });
});

describe("bekleyen sıcak lead", () => {
  it("24 saatte sorumlusuna, 48 saatte yöneticilere; aynı bekleme için bir kez; dokunulunca sayaç yeniden başlar", async () => {
    source.hot = [hot()];
    expect(await sweeps.run()).toBe(1);
    expect(sent()).toEqual(["12:hot_untouched"]);
    expect(JSON.parse(store.rows[0]!.body)).toMatchObject({ hours: 30 });

    clock.advance(20 * 3_600_000); // 50 saat
    expect(await sweeps.run()).toBe(2);
    expect(await sweeps.run()).toBe(0);
    expect(sent()).toEqual(["12:hot_untouched", "admin:hot_untouched_manager", "7:hot_untouched_manager"]);
    expect(JSON.parse(store.rows[1]!.body)).toMatchObject({ hours: 50, ownerId: "12" });

    source.hot = [hot({ lastTouchAt: new Date(clock.now().getTime() - 25 * 3_600_000) })];
    expect(await sweeps.run()).toBe(1);
    expect(sent().at(-1)).toBe("12:hot_untouched");
  });

  it("sahibi yöneticiyse ikinci bildirim kendine gitmez; 14 günden eski bekleme ve henüz dolmayan süre atlanır", async () => {
    source.hot = [
      hot({ leadId: "mine", userId: "admin", lastTouchAt: hoursAgo(60) }),
      hot({ leadId: "ancient", lastTouchAt: hoursAgo(24 * 20) }),
      hot({ leadId: "fresh", lastTouchAt: hoursAgo(3) }),
    ];
    await sweeps.run();
    expect(sent()).toEqual(["admin:hot_untouched", "7:hot_untouched_manager"]);
  });

  it("süre 0 ise o adım kapalıdır", async () => {
    sweeps = new NotificationSweeps({
      source,
      delivery: new NotificationDelivery({ notifications: store, logger: silentLogger }),
      managers: async () => managers,
      clock,
      ids: new SequentialIdGenerator(),
      logger: silentLogger,
      hotRepHours: 24,
      hotManagerHours: 0,
    });
    source.hot = [hot({ lastTouchAt: hoursAgo(60) })];
    await sweeps.run();
    expect(sent()).toEqual(["12:hot_untouched"]);
  });
});
