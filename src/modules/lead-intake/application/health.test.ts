/** Faz 7a: gelen kutusu sağlık sorguları ve yeniden işleme kuralı (bellek içi). */
import { beforeEach, describe, expect, it } from "vitest";
import { DAY, FixedClock, MINUTE, silentLogger } from "../../shared/kernel";
import { InMemoryInbox } from "./fakes";
import { InboxHealth } from "./health";

const T0 = new Date("2026-03-01T10:00:00Z");
let inbox: InMemoryInbox;
let clock: FixedClock;
let health: InboxHealth;

const enqueue = (id: string, receivedAt = T0) =>
  inbox.enqueue({
    id,
    provider: "p",
    kind: "webhook",
    dedupeKey: `p:${id}`,
    payload: { id },
    receivedAt,
    nextAttemptAt: receivedAt,
  });

beforeEach(() => {
  inbox = new InMemoryInbox();
  clock = new FixedClock(T0);
  health = new InboxHealth({ inbox, clock, logger: silentLogger, retentionDays: 30 });
});

describe("InboxHealth", () => {
  it("özet: durum sayıları, son 24 saat, en eski bekleyen, temizlik bekleyen", async () => {
    await enqueue("a");
    await enqueue("b", new Date(T0.getTime() - 2 * DAY));
    await enqueue("c", new Date(T0.getTime() - 40 * DAY));
    await inbox.markFailed("b", { code: "intake.invalid_lead", message: "ad yok" }, T0);
    const s = await health.stats();
    expect(s.counts).toEqual(
      expect.arrayContaining([
        { provider: "p", status: "pending", count: 2 },
        { provider: "p", status: "failed", count: 1 },
      ]),
    );
    expect(s.receivedLastDay).toBe(1);
    expect(s.oldestPendingAt).toEqual(new Date(T0.getTime() - 40 * DAY));
    expect(s.purgeBacklog).toBe(1);
  });

  it("failed → yeniden işle: pending olur, deneme sıfırlanır, işleyici tekrar alır", async () => {
    await enqueue("a");
    await inbox.claimDue(T0, 10, MINUTE);
    await inbox.markFailed("a", { code: "intake.invalid_lead", message: "ad yok" }, T0);
    expect((await health.listFailed()).map((f) => [f.id, f.attempts, f.hasPayload])).toEqual([["a", 1, true]]);
    clock.advance(MINUTE);
    const r = await health.requeue(["a"], "admin-1");
    expect(r.ok && r.value).toEqual({ requeued: 1 });
    expect(inbox.rows[0]).toMatchObject({ status: "pending", attempts: 0, nextAttemptAt: clock.now() });
    expect(await inbox.claimDue(clock.now(), 10, MINUTE)).toHaveLength(1);
  });

  it("işlenmiş, bekleyen ya da payload'ı silinmiş satır reddedilir; hiçbiri değişmez", async () => {
    await enqueue("a");
    await enqueue("b");
    await enqueue("c", new Date(T0.getTime() - 40 * DAY));
    await inbox.markFailed("a", { code: "x", message: "x" }, T0);
    await inbox.markFailed("c", { code: "x", message: "x" }, T0);
    await inbox.purgePayloads(new Date(T0.getTime() - 30 * DAY));
    const r = await health.requeue(["a", "b", "c"], "admin-1");
    expect(!r.ok && r.error.code).toBe("inbox.not_requeueable");
    expect(!r.ok && r.error.details["ids"]).toEqual(["b", "c"]);
    expect(inbox.rows.map((x) => x.status)).toEqual(["failed", "pending", "failed"]);
    const none = await health.requeue([], "admin-1");
    expect(!none.ok && none.error.code).toBe("inbox.not_requeueable");
  });
});
