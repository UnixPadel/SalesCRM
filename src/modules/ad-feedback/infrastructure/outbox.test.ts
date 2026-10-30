/**
 * outbound_conversion_events (PGlite): satırlar sales-pipeline'ın gerçek CreateLead/ChangeLeadStage/Undo'su ile
 * yazılır (bootstrap üzerinden, modüller arası kural), dağıtıcı repository'si durumları çevirir. Kilit, SKIP LOCKED
 * ve finished_at penceresi burada doğrulanır. Zaman gerçek saat; "10 dk bekleme" now'a göre hesaplanır.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bootSalesPipeline, type SalesPipelineApp } from "../../../bootstrap/salesPipeline";
import type { Db } from "../../shared/db";
import { MINUTE, silentLogger, unwrap } from "../../shared/kernel";
import type { OutboxRepository } from "../application";
import { pgOutboxRepository } from "./outboxRepository";

let app: SalesPipelineApp;
let db: Db;
let outbox: OutboxRepository;
const REP = { userId: "rep-1", isAdmin: false };

beforeAll(async () => {
  app = await bootSalesPipeline({ logger: silentLogger, memory: true, env: { ENABLED_PROVIDERS: "meta" } });
  db = app.db;
  outbox = pgOutboxRepository(db);
});
afterAll(() => app.close());
beforeEach(() =>
  db.exec(
    "TRUNCATE user_notifications, inbound_webhook_events, outbound_conversion_events, lead_stage_events, lead_consents, lead_attribution, leads, persons, territory_rules",
  ),
);

const newLead = (platformLeadId: string) =>
  app.pipeline.createLead.execute({
    source: "meta_form",
    platformLeadId,
    fullName: "Ayşe Demir",
    email: `${platformLeadId}@example.com`,
    country: "TR",
    actor: null,
  });

const statuses = async () =>
  (
    await db.query<{ status: string; n: string }>(
      "SELECT status, count(*)::int AS n FROM outbound_conversion_events GROUP BY status",
    )
  ).reduce((acc, r) => ({ ...acc, [r.status]: Number(r.n) }), {} as Record<string, number>);

const afterWait = () => new Date(Date.now() + 10 * MINUTE + 1000);

describe("outbound_conversion_events (PGlite)", () => {
  it("10 dk bekleme: yeni satır hemen alınmaz; süresi gelince alınır, attempts artar, kilit süresince ikinci claim boş", async () => {
    await newLead("555000001");
    expect(await statuses()).toEqual({ pending: 1 });
    expect(await outbox.claimDue(new Date(), 10, 5 * MINUTE)).toHaveLength(0);
    const later = afterWait();
    const claimed = await outbox.claimDue(later, 10, 5 * MINUTE);
    expect(claimed).toHaveLength(1);
    expect(claimed[0]).toMatchObject({ provider: "meta", status: "pending", attempts: 1, skipReason: null });
    expect(claimed[0]!.nextAttemptAt).toEqual(new Date(later.getTime() + 5 * MINUTE));
    expect(await outbox.claimDue(later, 10, 5 * MINUTE)).toHaveLength(0);
    expect(await outbox.claimDue(new Date(later.getTime() + 5 * MINUTE), 10, 5 * MINUTE)).toHaveLength(1);
  });

  it("sent / retry / dead / skipped geçişleri ve finished_at; aynı olay iki kez sent olmaz", async () => {
    const a = unwrap(await newLead("555000001"));
    unwrap(await newLead("555000002"));
    unwrap(await newLead("555000003"));
    unwrap(await newLead("555000004"));
    const later = afterWait();
    const rows = await outbox.claimDue(later, 10, MINUTE);
    expect(rows).toHaveLength(4);
    const [r1, r2, r3, r4] = rows as [(typeof rows)[0], (typeof rows)[0], (typeof rows)[0], (typeof rows)[0]];

    await outbox.markSent([r1.id], 200, later);
    await outbox.markRetry(r2.id, new Date(later.getTime() + MINUTE), 429, "rate limit");
    await outbox.markDead(r3.id, 400, "Invalid parameter", later);
    await outbox.markSkipped(r4.id, "test_lead", later);
    expect(await statuses()).toEqual({ sent: 1, failed: 1, dead: 1, skipped: 1 });

    const raw = await db.query<Record<string, unknown>>(
      "SELECT id, status, last_response_code, last_error, skip_reason, sent_at, finished_at FROM outbound_conversion_events",
    );
    const byId = Object.fromEntries(raw.map((r) => [r["id"] as string, r]));
    expect(byId[r1.id]).toMatchObject({ status: "sent", last_response_code: 200, sent_at: later, finished_at: later });
    expect(byId[r2.id]).toMatchObject({
      status: "failed",
      last_response_code: 429,
      last_error: "rate limit",
      finished_at: null,
    });
    expect(byId[r3.id]).toMatchObject({ status: "dead", last_response_code: 400, finished_at: later });
    expect(byId[r4.id]).toMatchObject({ status: "skipped", skip_reason: "test_lead", finished_at: later });

    // failed satır süresi gelince yeniden alınır; sent/dead/skipped hiç alınmaz.
    const again = await outbox.claimDue(new Date(later.getTime() + 2 * MINUTE), 10, MINUTE);
    expect(again.map((r) => [r.id, r.attempts])).toEqual([[r2.id, 2]]);

    // Aşama değişikliği yeni satır açar; mevcut sent satır değişmez (UNIQUE stage_event_id+provider).
    unwrap(await app.pipeline.changeLeadStage.execute({ leadId: a.lead.id, target: "CONTACTED", actor: REP }));
    expect(await statuses()).toEqual({ sent: 1, failed: 1, dead: 1, skipped: 1, pending: 1 });
  });

  it("listDead: finished_at penceresi; eski dead satır rapora girmez", async () => {
    unwrap(await newLead("555000001"));
    unwrap(await newLead("555000002"));
    const later = afterWait();
    const [r1, r2] = await outbox.claimDue(later, 10, MINUTE);
    await outbox.markDead(r1!.id, 400, "yeni", later);
    await outbox.markDead(r2!.id, 500, "eski", new Date(later.getTime() - 48 * 60 * MINUTE));
    const dead = await outbox.listDead(new Date(later.getTime() - 24 * 60 * MINUTE));
    expect(dead).toHaveLength(1);
    expect(dead[0]).toMatchObject({
      id: r1!.id,
      provider: "meta",
      attempts: 1,
      lastResponseCode: 400,
      lastError: "yeni",
      finishedAt: later,
    });
  });

  it("geri alma, kuyruk satırını skipped (undone) yapar; dağıtıcı onu almaz", async () => {
    const a = unwrap(await newLead("555000001"));
    unwrap(await app.pipeline.changeLeadStage.execute({ leadId: a.lead.id, target: "CONTACTED", actor: REP }));
    unwrap(await app.pipeline.undoStageChange.execute({ leadId: a.lead.id, actor: REP }));
    expect(await statuses()).toEqual({ pending: 1, skipped: 1 });
    const claimed = await outbox.claimDue(new Date(Date.now() + 30 * MINUTE), 10, MINUTE);
    expect(claimed).toHaveLength(1);
    expect(claimed[0]!.skipReason).toBeNull();
  });
});
