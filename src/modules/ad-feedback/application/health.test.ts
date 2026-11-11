/** Faz 7a/7c: outbox sağlık sorguları, yeniden kuyruğa alma kuralı ve platform akıbet sorgusu (bellek içi). */
import { beforeEach, describe, expect, it } from "vitest";
import {
  InMemoryIntegrationSettings,
  IntegrationSettings,
  stageMappingRow,
} from "../../integration-settings/application";
import { FixedClock, MINUTE, silentLogger } from "../../shared/kernel";
import type { OutboundStageEvent } from "../../sales-pipeline/application";
import { FakeSender, InMemoryOutbox, RecordingMailer, sampleContext } from "./fakes";
import { createAdFeedback, isRequeueable, type AdFeedback } from "./index";

const T0 = new Date("2026-03-01T10:00:00Z");
let outbox: InMemoryOutbox;
let clock: FixedClock;
let contexts: Map<string, OutboundStageEvent>;
let sender: FakeSender;
let fb: AdFeedback;

beforeEach(() => {
  outbox = new InMemoryOutbox();
  clock = new FixedClock(T0);
  contexts = new Map();
  sender = new FakeSender("meta");
  fb = createAdFeedback({
    outbox,
    context: { outboundContext: async (ids) => ids.flatMap((id) => contexts.get(id) ?? []) },
    policy: new IntegrationSettings({
      ...new InMemoryIntegrationSettings([], { meta: { outbound_enabled: "true" } }, [
        stageMappingRow("meta", "QUALIFIED", "Nitelikli Lead"),
      ]).repos(),
      clock: { now: () => T0 },
    }),
    senders: [sender],
    clock,
    logger: silentLogger,
    retryMinutes: [1, 5],
    consentRequiredType: "kvkk",
    mailer: new RecordingMailer(),
    reportRecipients: [],
  });
});

const add = (eventId: string, provider = "meta") => {
  contexts.set(eventId, sampleContext({ stageEventId: eventId, leadId: `lead-${eventId}` }));
  return outbox.enqueue(eventId, provider, T0);
};

describe("OutboxHealth", () => {
  it("kural: yalnız dead ve failed yeniden kuyruğa alınır", () => {
    expect((["pending", "sent", "failed", "dead", "skipped"] as const).map(isRequeueable)).toEqual([
      false,
      false,
      true,
      true,
      false,
    ]);
  });

  it("özet ve liste: durum sayıları, atlama nedeni, lead ve aşama bilgisi", async () => {
    const a = add("e1");
    const b = add("e2");
    add("e3");
    await outbox.markDead(a.id, 400, "geçersiz olay", T0);
    await outbox.markSkipped(b.id, "no_consent", T0);
    const s = await fb.health.stats();
    expect(s.counts).toEqual(
      expect.arrayContaining([
        { provider: "meta", status: "dead", count: 1 },
        { provider: "meta", status: "skipped", count: 1 },
        { provider: "meta", status: "pending", count: 1 },
      ]),
    );
    expect(s.skipReasons).toEqual([{ provider: "meta", reason: "no_consent", count: 1 }]);
    expect(s.oldestDueAt).toEqual(T0);
    const list = await fb.health.list({ statuses: ["dead", "failed"], limit: 50 });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: a.id, leadId: "lead-e1", stageCode: "QUALIFIED", lastResponseCode: 400 });
  });

  it("dead → yeniden kuyruğa al → dağıtıcı tekrar dener ve gönderir", async () => {
    const a = add("e1");
    await outbox.markDead(a.id, 400, "geçersiz olay", T0);
    clock.advance(MINUTE);
    const r = await fb.health.requeue([a.id], "admin-1");
    expect(r.ok && r.value).toEqual({ requeued: 1 });
    expect(outbox.rows[0]).toMatchObject({ status: "pending", attempts: 0, finishedAt: null });
    const stats = await fb.dispatch.runOnce();
    expect(stats).toMatchObject({ claimed: 1, sent: 1 });
    expect(outbox.rows[0]!.status).toBe("sent");
  });

  it("failed → şimdi dene: sıra öne çekilir, deneme sayısı korunur", async () => {
    const a = add("e1");
    await outbox.claimDue(T0, 10, MINUTE);
    await outbox.markRetry(a.id, new Date(T0.getTime() + 720 * MINUTE), 503, "geçici");
    clock.advance(MINUTE);
    const r = await fb.health.requeue([a.id], "admin-1");
    expect(r.ok).toBe(true);
    expect(outbox.rows[0]).toMatchObject({ status: "failed", attempts: 1, nextAttemptAt: clock.now() });
  });

  it("gönderilmiş ya da atlanmış satır reddedilir; hiçbiri değişmez", async () => {
    const dead = add("e1");
    const sent = add("e2");
    await outbox.markDead(dead.id, 400, "x", T0);
    await outbox.markSent([sent.id], 200, T0);
    const r = await fb.health.requeue([dead.id, sent.id, "yok"], "admin-1");
    expect(!r.ok && r.error.code).toBe("outbox.not_requeueable");
    expect(!r.ok && r.error.details["ids"]).toEqual([sent.id, "yok"]);
    expect(outbox.rows.map((x) => x.status)).toEqual(["dead", "sent"]);
    const none = await fb.health.requeue([], "admin-1");
    expect(!none.ok && none.error.code).toBe("outbox.not_requeueable");
  });

  it("akıbet sorgusu: yalnız istek kimliği olan gönderilmiş satır ve destekleyen sağlayıcı", async () => {
    const a = add("e1");
    await outbox.markSent([a.id], 200, T0, "req-1");
    expect(fb.health.statusProviders()).toEqual([]);
    const unsupported = await fb.health.requestStatus(a.id);
    expect(!unsupported.ok && unsupported.error.code).toBe("status.unsupported");

    sender.requestStatus = async (requestId) => ({
      requestId,
      state: "success",
      destinations: [{ state: "success", recordCount: 1, errorCount: 0, warningCount: 0 }],
    });
    expect(fb.health.statusProviders()).toEqual(["meta"]);
    const okR = await fb.health.requestStatus(a.id);
    expect(okR.ok && okR.value).toMatchObject({ requestId: "req-1", state: "success" });

    const b = add("e2");
    await outbox.markSent([b.id], 200, T0);
    const noId = await fb.health.requestStatus(b.id);
    expect(!noId.ok && noId.error.code).toBe("status.unsupported");
    const missing = await fb.health.requestStatus("yok");
    expect(!missing.ok && missing.error.code).toBe("not_found");

    sender.requestStatus = async () => {
      throw new Error("ağ");
    };
    const down = await fb.health.requestStatus(a.id);
    expect(!down.ok && down.error.code).toBe("status.unavailable");
  });
});
