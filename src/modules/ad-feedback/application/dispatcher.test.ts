import { beforeEach, describe, expect, it } from "vitest";
import {
  InMemoryIntegrationSettings,
  IntegrationSettings,
  stageMappingRow,
} from "../../integration-settings/application";
import { FixedClock, MINUTE, silentLogger } from "../../shared/kernel";
import type { OutboundStageEvent } from "../../sales-pipeline/application";
import { consentAllows, createAdFeedback, skipReasonFor, type AdFeedback, type SendResult } from "./index";
import { FakeSender, InMemoryOutbox, RecordingMailer, sampleContext } from "./fakes";

const RETRY = [1, 5, 30, 120, 720];
const T0 = new Date("2026-03-01T10:00:00Z");

let outbox: InMemoryOutbox;
let clock: FixedClock;
let mailer: RecordingMailer;
let contexts: Map<string, OutboundStageEvent>;
let settings: IntegrationSettings;

const policyWith = (over: { outbound?: string; mappings?: ReturnType<typeof stageMappingRow>[] } = {}) =>
  new IntegrationSettings({
    ...new InMemoryIntegrationSettings(
      [],
      { meta: { outbound_enabled: over.outbound ?? "true" } },
      over.mappings ?? [
        stageMappingRow("meta", "NEW", "Yeni Lead"),
        stageMappingRow("meta", "QUALIFIED", "Nitelikli Lead", { isOptimizationTarget: true }),
        stageMappingRow("meta", "WON", "Kazanıldı"),
        stageMappingRow("meta", "LOST", "Kaybedildi", { enabled: false }),
      ],
    ).repos(),
    clock: { now: () => T0 },
  });

const build = (sender: FakeSender, over: Partial<Parameters<typeof createAdFeedback>[0]> = {}): AdFeedback =>
  createAdFeedback({
    outbox,
    context: { outboundContext: async (ids) => ids.flatMap((id) => contexts.get(id) ?? []) },
    policy: settings,
    senders: [sender],
    clock,
    logger: silentLogger,
    retryMinutes: RETRY,
    consentRequiredType: "kvkk",
    mailer,
    reportRecipients: ["admin@example.com"],
    ...over,
  });

/** Olayı bağlama ve kuyruğa koyar; 10 dk bekleme geçmiş sayılır (notBefore = T0 - 1 sn). */
const enqueue = (ctx: OutboundStageEvent, provider = "meta", notBefore = new Date(T0.getTime() - 1000)) => {
  contexts.set(ctx.stageEventId, ctx);
  return outbox.enqueue(ctx.stageEventId, provider, notBefore);
};

beforeEach(() => {
  outbox = new InMemoryOutbox();
  clock = new FixedClock(T0.toISOString());
  mailer = new RecordingMailer();
  contexts = new Map();
  settings = policyWith();
});

describe("filtreler", () => {
  const base = { enabled: true, mappingEnabled: true as boolean | undefined, consentRequiredType: "kvkk" };
  it("sıra: acil durdurma, geri alma, test, manuel/import, onay, eşleme yok, eşleme kapalı", () => {
    const ctx = sampleContext();
    expect(skipReasonFor(ctx, { ...base, enabled: false })).toBe("emergency_stop");
    expect(skipReasonFor(sampleContext({ undoneAt: T0 }), base)).toBe("undone");
    expect(skipReasonFor(sampleContext({ lead: { ...ctx.lead, isTest: true } }), base)).toBe("test_lead");
    expect(skipReasonFor(sampleContext({ lead: { ...ctx.lead, source: "manual" } }), base)).toBe("manual_source");
    expect(skipReasonFor(sampleContext({ lead: { ...ctx.lead, source: "import" } }), base)).toBe("manual_source");
    expect(skipReasonFor(sampleContext({ lead: { ...ctx.lead, source: "web_form" } }), base)).toBe("no_consent");
    expect(skipReasonFor(ctx, { ...base, mappingEnabled: undefined })).toBe("mapping_missing");
    expect(skipReasonFor(ctx, { ...base, mappingEnabled: false })).toBe("mapping_disabled");
    expect(skipReasonFor(ctx, base)).toBeNull();
  });

  it("onay kuralı: platform formu onaysız geçer; web formu verilmiş kvkk ister; son kayıt 'verilmedi' ise hiçbiri geçmez", () => {
    const granted = { id: "c1", leadId: "lead-1", type: "kvkk", granted: true, textVersion: "v1", grantedAt: T0 };
    const revoked = { ...granted, id: "c2", granted: false, grantedAt: new Date(T0.getTime() + 1000) };
    const web = sampleContext({ lead: { ...sampleContext().lead, source: "web_form" } });
    expect(consentAllows(sampleContext(), "kvkk")).toBe(true);
    expect(consentAllows(web, "kvkk")).toBe(false);
    expect(consentAllows({ ...web, consents: [granted] }, "kvkk")).toBe(true);
    expect(consentAllows({ ...web, consents: [granted, revoked] }, "kvkk")).toBe(false);
    expect(consentAllows({ ...sampleContext(), consents: [revoked] }, "kvkk")).toBe(false);
    expect(consentAllows({ ...web, consents: [{ ...granted, type: "marketing" }] }, "kvkk")).toBe(false);
  });
});

describe("DispatchOutbox", () => {
  it("200 → sent; olay adı eşlemeden; zamanı gelmemiş satır alınmaz; aynı olay ikinci turda gitmez", async () => {
    const sender = new FakeSender("meta");
    const ad = build(sender);
    enqueue(sampleContext({ stageEventId: "evt-1", stageCode: "QUALIFIED" }));
    enqueue(sampleContext({ stageEventId: "evt-2", stageCode: "NEW" }), "meta", new Date(T0.getTime() + 9 * MINUTE));
    expect(await ad.dispatch.runOnce()).toEqual({ claimed: 1, sent: 1, retried: 0, dead: 0, skipped: 0 });
    expect(sender.calls).toHaveLength(1);
    expect(sender.calls[0]!.map((e) => e.eventName)).toEqual(["Nitelikli Lead"]);
    expect(outbox.rows[0]).toMatchObject({ status: "sent", lastResponseCode: 200, attempts: 1, sentAt: T0 });
    expect(await ad.dispatch.runOnce()).toMatchObject({ claimed: 0 });
    clock.advance(10 * MINUTE);
    expect(await ad.dispatch.runOnce()).toMatchObject({ claimed: 1, sent: 1 });
    expect(sender.calls).toHaveLength(2);
  });

  it("filtreler satırı skipped yapar ve nedeni yazar; gönderici hiç çağrılmaz", async () => {
    const sender = new FakeSender("meta");
    const ad = build(sender);
    const lead = sampleContext().lead;
    enqueue(sampleContext({ stageEventId: "e-undone", undoneAt: T0 }));
    enqueue(sampleContext({ stageEventId: "e-test", lead: { ...lead, isTest: true } }));
    enqueue(sampleContext({ stageEventId: "e-manual", lead: { ...lead, source: "manual" } }));
    enqueue(sampleContext({ stageEventId: "e-web", lead: { ...lead, source: "web_form" } }));
    enqueue(sampleContext({ stageEventId: "e-lost", stageCode: "LOST" }));
    enqueue(sampleContext({ stageEventId: "e-prop", stageCode: "PROPOSAL" }));
    sender.skipFor.set("e-nokey", "no_match_key");
    enqueue(sampleContext({ stageEventId: "e-nokey" }));
    expect(await ad.dispatch.runOnce()).toMatchObject({ claimed: 7, skipped: 7, sent: 0 });
    expect(sender.calls).toHaveLength(0);
    const reasons = Object.fromEntries(outbox.rows.map((r) => [r.stageEventId, r.skipReason]));
    expect(reasons).toEqual({
      "e-undone": "undone",
      "e-test": "test_lead",
      "e-manual": "manual_source",
      "e-web": "no_consent",
      "e-lost": "mapping_disabled",
      "e-prop": "mapping_missing",
      "e-nokey": "no_match_key",
    });
  });

  it("acil durdurma: outbound_enabled=false → hepsi emergency_stop", async () => {
    settings = policyWith({ outbound: "false" });
    const sender = new FakeSender("meta");
    const ad = build(sender);
    enqueue(sampleContext({ stageEventId: "evt-1" }));
    expect(await ad.dispatch.runOnce()).toMatchObject({ skipped: 1 });
    expect(outbox.rows[0]!.skipReason).toBe("emergency_stop");
  });

  it("geri alınan aşamanın olayı platforma gitmez (undo kuyruğu skipped yaptıysa alınmaz; yapmadıysa dağıtıcı yakalar)", async () => {
    const sender = new FakeSender("meta");
    const ad = build(sender);
    enqueue(sampleContext({ stageEventId: "evt-1", undoneAt: new Date(T0.getTime() - MINUTE) }));
    const alreadySkipped = enqueue(sampleContext({ stageEventId: "evt-2" }));
    await outbox.markSkipped(alreadySkipped.id, "undone", T0);
    expect(await ad.dispatch.runOnce()).toMatchObject({ claimed: 1, skipped: 1, sent: 0 });
    expect(sender.calls).toHaveLength(0);
  });

  it("400 tek olay → dead; 400 toplu → tek tek: yalnız hatalı dead, diğerleri sent", async () => {
    const single = new FakeSender("meta", [{ kind: "dead", code: 400, error: "Invalid parameter" }]);
    const ad1 = build(single);
    enqueue(sampleContext({ stageEventId: "evt-1" }));
    expect(await ad1.dispatch.runOnce()).toMatchObject({ dead: 1, sent: 0, retried: 0 });
    expect(outbox.rows[0]).toMatchObject({ status: "dead", lastResponseCode: 400, lastError: "Invalid parameter" });

    outbox = new InMemoryOutbox();
    contexts = new Map();
    const scripted: SendResult[] = [
      { kind: "dead", code: 400, error: "batch invalid" },
      { kind: "ok", code: 200 },
      { kind: "dead", code: 400, error: "bad event" },
      { kind: "ok", code: 200 },
    ];
    const batch = new FakeSender("meta", scripted);
    const ad2 = build(batch);
    enqueue(sampleContext({ stageEventId: "a" }));
    enqueue(sampleContext({ stageEventId: "b" }));
    enqueue(sampleContext({ stageEventId: "c" }));
    expect(await ad2.dispatch.runOnce()).toMatchObject({ claimed: 3, sent: 2, dead: 1 });
    expect(batch.calls.map((c) => c.length)).toEqual([3, 1, 1, 1]);
    expect(outbox.rows.map((r) => [r.stageEventId, r.status])).toEqual([
      ["a", "sent"],
      ["b", "dead"],
      ["c", "sent"],
    ]);
  });

  it("429 / 500 / zaman aşımı → failed ve 1, 5, 30, 120, 720 dk sonra yeniden; altıncıda dead", async () => {
    const sender = new FakeSender("meta", [
      { kind: "retry", code: 429, error: "rate limit" },
      { kind: "retry", code: 500, error: "server" },
      { kind: "retry", code: null, error: "timeout" },
      { kind: "retry", code: 503, error: "unavailable" },
      { kind: "retry", code: 500, error: "server" },
      { kind: "retry", code: 500, error: "server" },
    ]);
    const ad = build(sender);
    enqueue(sampleContext({ stageEventId: "evt-1" }));
    const expectedDelays = RETRY;
    for (let i = 0; i < expectedDelays.length; i++) {
      expect(await ad.dispatch.runOnce()).toMatchObject({ claimed: 1, retried: 1 });
      const row = outbox.rows[0]!;
      expect(row.status).toBe("failed");
      expect(row.attempts).toBe(i + 1);
      expect(row.nextAttemptAt.getTime() - clock.now().getTime()).toBe(expectedDelays[i]! * MINUTE);
      clock.advance(expectedDelays[i]! * MINUTE);
    }
    expect(await ad.dispatch.runOnce()).toMatchObject({ claimed: 1, dead: 1 });
    expect(outbox.rows[0]).toMatchObject({ status: "dead", attempts: 6, lastResponseCode: 500 });
    expect(outbox.rows[0]!.lastError).toContain("yeniden deneme hakkı bitti");
  });

  it("gönderici fırlatırsa geçici hata sayılır; kilit süresi içinde ikinci instance satırı alamaz", async () => {
    const sender = new FakeSender("meta", [{ kind: "retry", code: null, error: "x", throws: true } as SendResult]);
    const ad = build(sender);
    enqueue(sampleContext({ stageEventId: "evt-1" }));
    // İlk claim'den hemen sonra (kilit sürerken) ikinci claim boş döner.
    const first = await outbox.claimDue(clock.now(), 10, 5 * MINUTE);
    expect(first).toHaveLength(1);
    expect(await outbox.claimDue(clock.now(), 10, 5 * MINUTE)).toHaveLength(0);
    clock.advance(5 * MINUTE);
    expect(await ad.dispatch.runOnce()).toMatchObject({ claimed: 1, retried: 1 });
    expect(outbox.rows[0]!.lastError).toBe("ağ hatası");
  });

  it("sağlayıcı adaptörü yoksa satır dead (yapılandırma hatası görünür olsun)", async () => {
    const ad = build(new FakeSender("meta"));
    enqueue(sampleContext({ stageEventId: "evt-1" }), "google");
    expect(await ad.dispatch.runOnce()).toMatchObject({ dead: 1 });
    expect(outbox.rows[0]!.lastError).toContain("google");
  });
});

describe("BackfillOutbox", () => {
  it("eksik satırları pending açar; mevcut satıra dokunmaz; dry-run yalnız sayar", async () => {
    const { BackfillOutbox } = await import("./backfill");
    const events = [
      { stageEventId: "e-1", leadId: "l-1", occurredAt: T0 },
      { stageEventId: "e-2", leadId: "l-1", occurredAt: T0 },
      { stageEventId: "e-3", leadId: "l-2", occurredAt: T0 },
    ];
    const existing = outbox.enqueue("e-1", "meta", T0);
    await outbox.markSent([existing.id], 200, T0);
    const bf = new BackfillOutbox({
      outbox,
      events: { stageEventsSince: async () => events },
      clock,
      logger: silentLogger,
    });
    expect(await bf.run({ provider: "meta", since: T0, sources: ["meta_form"], dryRun: true })).toEqual({
      candidates: 3,
      enqueued: 0,
      dryRun: true,
    });
    expect(outbox.rows).toHaveLength(1);
    expect(await bf.run({ provider: "meta", since: T0, sources: ["meta_form"] })).toEqual({
      candidates: 3,
      enqueued: 2,
      dryRun: false,
    });
    expect(outbox.rows.map((r) => [r.stageEventId, r.status])).toEqual([
      ["e-1", "sent"],
      ["e-2", "pending"],
      ["e-3", "pending"],
    ]);
    expect((await bf.run({ provider: "meta", since: T0, sources: ["meta_form"] })).enqueued).toBe(0);
  });
});

describe("DeadLetterReport", () => {
  it("son 24 saatin dead satırlarını alıcılara yollar; satır yoksa e-posta yok; alıcı yoksa yalnız log", async () => {
    const ad = build(new FakeSender("meta"));
    expect(await ad.report.runOnce()).toEqual({ dead: 0, mailed: 0 });
    const row = enqueue(sampleContext({ stageEventId: "evt-1" }));
    await outbox.markDead(row.id, 400, "Invalid parameter", new Date(T0.getTime() - 2 * 3_600_000));
    const old = enqueue(sampleContext({ stageEventId: "evt-old" }));
    await outbox.markDead(old.id, 500, "eski", new Date(T0.getTime() - 30 * 3_600_000));
    expect(await ad.report.runOnce()).toEqual({ dead: 1, mailed: 1 });
    expect(mailer.sent[0]).toMatchObject({ to: "admin@example.com", subject: "[CRM] Giden olay dead-letter: 1 satır" });
    expect(mailer.sent[0]!.text).toContain("meta: 1");
    expect(mailer.sent[0]!.text).toContain("evt-1 · meta · 0 · 400 · Invalid parameter");
    expect(mailer.sent[0]!.text).not.toContain("ayse@example.com");
    const noRecipients = build(new FakeSender("meta"), { reportRecipients: [] });
    expect(await noRecipients.report.runOnce()).toEqual({ dead: 1, mailed: 0 });
  });
});
