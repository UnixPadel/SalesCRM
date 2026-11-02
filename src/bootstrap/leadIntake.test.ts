/**
 * Sunucu kompozisyonu (server/index.mjs ile aynı sıra): bootSalesPipeline → bootLeadIntake → bootAdFeedback(leadIntake.settings).
 * Faz 4–5 testleri kendi IntegrationSettings nesnesini kurduğu için sunucunun gerçek bağlantısını sınamıyordu;
 * aşama eşlemeleri bağlanmadığında her outbox satırı `mapping_missing` ile atlanır. Bu test o yolu kapatır.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { RecordingEmailSender } from "../modules/sales-pipeline/application";
import { silentLogger, unwrap } from "../modules/shared/kernel";
import { bootAdFeedback, type AdFeedbackApp } from "./adFeedback";
import { bootLeadIntake, type LeadIntakeApp } from "./leadIntake";
import { bootSalesPipeline, type SalesPipelineApp } from "./salesPipeline";

const REP = { userId: "rep-1", isAdmin: false };
let sp: SalesPipelineApp;
let intake: LeadIntakeApp;
let ad: AdFeedbackApp;
const sentBodies: Record<string, unknown>[] = [];

beforeAll(async () => {
  sp = await bootSalesPipeline({
    logger: silentLogger,
    memory: true,
    env: { ENABLED_PROVIDERS: "meta" },
    email: new RecordingEmailSender(),
  });
  intake = bootLeadIntake(sp, { logger: silentLogger, env: {}, startScheduler: false });
  ad = bootAdFeedback(sp, intake.settings, {
    logger: silentLogger,
    startScheduler: false,
    env: { META_SYSTEM_USER_TOKEN: "sys-token", META_DATASET_ID: "424242" },
    metaFetch: vi.fn(async (_url: string, init?: RequestInit) => {
      sentBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(JSON.stringify({ events_received: 1 }), { status: 200 });
    }),
  });
});
afterAll(() => sp.close());

describe("sunucu kompozisyonu: lead-intake ayarları ad-feedback'e verilir", () => {
  it("lead-intake'in IntegrationSettings nesnesi aşama eşlemelerini de okur", async () => {
    const meta = await intake.settings.stageMappingsFor("meta");
    expect(meta.size).toBeGreaterThan(0);
    expect(meta.get("WON")?.enabled).toBe(true);
  });

  it("gerçek bağlantıyla Meta lead'inin NEW ve CONTACTED olayları gönderilir; mapping_missing yok", async () => {
    const lead = unwrap(
      await sp.pipeline.createLead.execute({
        source: "meta_form",
        platformLeadId: "9876543210987654321",
        fullName: "Kompozisyon Testi",
        email: "kompozisyon@example.com",
        country: "TR",
        actor: null,
      }),
    ).lead;
    unwrap(await sp.pipeline.changeLeadStage.execute({ leadId: lead.id, target: "CONTACTED", actor: REP }));
    await sp.db.query("UPDATE outbound_conversion_events SET next_attempt_at = now() - interval '1 second'");

    const stats = await ad.feedback.dispatch.runOnce();
    expect(stats).toMatchObject({ sent: 2, dead: 0, skipped: 0 });
    const rows = await sp.db.query<{ status: string; skip_reason: string | null }>(
      "SELECT status, skip_reason FROM outbound_conversion_events",
    );
    expect(rows.map((r) => r.status)).toEqual(["sent", "sent"]);
    expect(sentBodies).toHaveLength(1);
    const names = (sentBodies[0]!["data"] as Record<string, unknown>[]).map((e) => e["event_name"]);
    expect(names.sort()).toEqual(["Yeni Lead", "İletişim Kuruldu"].sort());
  });
});
