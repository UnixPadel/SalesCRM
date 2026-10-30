/**
 * Kompozisyon testi: gerçek PGlite + gerçek CreateLead/ChangeLeadStage → outbox → dağıtıcı → sahte Conversions API.
 * Faz 4 kabul kriteri 1'in yerel karşılığı: tüm aşamalar lead_id, event_source ve lead_event_source ile gidiyor.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { IntegrationSettings } from "../modules/integration-settings/application";
import {
  pgFieldMappingRepository,
  pgSettingsRepository,
  pgStageMappingRepository,
} from "../modules/integration-settings/infrastructure";
import { RecordingEmailSender } from "../modules/sales-pipeline/application";
import { silentLogger, systemClock, unwrap } from "../modules/shared/kernel";
import { bootAdFeedback, type AdFeedbackApp } from "./adFeedback";
import { bootSalesPipeline, type SalesPipelineApp } from "./salesPipeline";

const REP = { userId: "rep-1", isAdmin: false };
let sp: SalesPipelineApp;
let ad: AdFeedbackApp;
const bodies: { url: string; raw: string; body: Record<string, unknown>; auth: string | undefined }[] = [];
const email = new RecordingEmailSender();

beforeAll(async () => {
  sp = await bootSalesPipeline({ logger: silentLogger, memory: true, env: { ENABLED_PROVIDERS: "meta" }, email });
  const settings = new IntegrationSettings({
    mappings: pgFieldMappingRepository(sp.db),
    settings: pgSettingsRepository(sp.db),
    stageMappings: pgStageMappingRepository(sp.db),
    clock: systemClock,
  });
  ad = bootAdFeedback(sp, settings, {
    logger: silentLogger,
    startScheduler: false,
    env: {
      META_SYSTEM_USER_TOKEN: "sys-token",
      META_DATASET_ID: "424242",
      META_TEST_EVENT_CODE: "TEST99",
      OUTBOX_REPORT_TO: "admin@example.com",
    },
    metaFetch: vi.fn(async (url: string, init?: RequestInit) => {
      bodies.push({
        url,
        raw: String(init?.body),
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
        auth: (init?.headers as Record<string, string> | undefined)?.["Authorization"],
      });
      return new Response(JSON.stringify({ events_received: 1 }), { status: 200 });
    }),
  });
});
afterAll(() => sp.close());

describe("bootAdFeedback", () => {
  it("gönderici ve işler kuruldu; dağıtıcı yalnız token varsa", () => {
    expect(ad.providers).toEqual({ meta: true });
    expect(ad.scheduler.running()).toBe(false);
  });

  it("Meta lead'i NEW → CONTACTED → WON: 10 dk sonra üç olay tek gövdede, lead_id sayı, event_source/lead_event_source, WON tutarı", async () => {
    const lead = unwrap(
      await sp.pipeline.createLead.execute({
        source: "meta_form",
        platformLeadId: "1234567890123456789",
        fullName: "Ayşe Demir",
        email: "ayse@example.com",
        phone: "+905321234567",
        country: "TR",
        actor: null,
      }),
    ).lead;
    unwrap(await sp.pipeline.changeLeadStage.execute({ leadId: lead.id, target: "CONTACTED", actor: REP }));
    unwrap(
      await sp.pipeline.changeLeadStage.execute({
        leadId: lead.id,
        target: "WON",
        actor: REP,
        qualificationAnswers: { budget_approved: true, site_known: true, install_within_12m: true },
        value: { amount: 185000, currency: "EUR" },
      }),
    );
    // 10 dk bekleme: şimdi hiçbir satır alınmaz.
    expect(await ad.feedback.dispatch.runOnce()).toMatchObject({ claimed: 0 });
    await sp.db.query("UPDATE outbound_conversion_events SET next_attempt_at = now() - interval '1 second'");
    const stats = await ad.feedback.dispatch.runOnce();
    expect(stats).toMatchObject({ sent: 5, dead: 0, skipped: 0 });
    expect(bodies).toHaveLength(1);
    const { url, raw, body, auth } = bodies[0]!;
    expect(url).toBe("https://graph.facebook.com/v26.0/424242/events");
    expect(auth).toBe("Bearer sys-token");
    expect(body["test_event_code"]).toBe("TEST99");
    const data = body["data"] as Record<string, unknown>[];
    expect(data.map((e) => e["event_name"]).sort()).toEqual(
      ["Yeni Lead", "İletişim Kuruldu", "Nitelikli Lead", "Teklif Gönderildi", "Kazanıldı"].sort(),
    );
    for (const e of data) {
      expect(e["action_source"]).toBe("system_generated");
      expect(e["custom_data"]).toMatchObject({ event_source: "crm", lead_event_source: "Unixpadel CRM" });
    }
    // 64-bit lead_id ham gövdede sayı olarak, hassasiyet kaybı olmadan (JSON.parse bunu yuvarlardı).
    expect((raw.match(/"lead_id":1234567890123456789,/g) ?? []).length).toBe(5);
    const won = data.find((e) => e["event_name"] === "Kazanıldı")!;
    expect(won["custom_data"]).toMatchObject({ value: 185000, currency: "EUR" });
    expect(
      (await sp.db.query<{ status: string }>("SELECT status FROM outbound_conversion_events")).every(
        (r) => r.status === "sent",
      ),
    ).toBe(true);
  });

  it("dead-letter raporu: dead satır yoksa e-posta yok", async () => {
    expect(await ad.feedback.report.runOnce()).toEqual({ dead: 0, mailed: 0 });
    expect(email.sent).toHaveLength(0);
  });
});
