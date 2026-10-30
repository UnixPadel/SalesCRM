/**
 * Kompozisyon testi (Faz 5): gerçek PGlite + gerçek CreateLead/ChangeLeadStage → outbox → dağıtıcı → sahte Google
 * token ucu + sahte Data Manager events:ingest. Meta göndericisi de kurulu: iki sağlayıcı aynı turda, aynı dağıtıcı.
 */
import { generateKeyPairSync } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { IntegrationSettings } from "../modules/integration-settings/application";
import {
  pgFieldMappingRepository,
  pgSettingsRepository,
  pgStageMappingRepository,
} from "../modules/integration-settings/infrastructure";
import { silentLogger, systemClock, unwrap } from "../modules/shared/kernel";
import { bootAdFeedback, type AdFeedbackApp } from "./adFeedback";
import { bootSalesPipeline, type SalesPipelineApp } from "./salesPipeline";

const REP = { userId: "rep-1", isAdmin: false };
const key = {
  client_email: "crm@test.iam.gserviceaccount.com",
  private_key: generateKeyPairSync("rsa", { modulusLength: 2048 })
    .privateKey.export({ type: "pkcs8", format: "pem" })
    .toString(),
};

let sp: SalesPipelineApp;
let ad: AdFeedbackApp;
const google: { url: string; body: Record<string, unknown>; auth: string | undefined }[] = [];
const meta: { url: string }[] = [];

beforeAll(async () => {
  sp = await bootSalesPipeline({ logger: silentLogger, memory: true, env: { ENABLED_PROVIDERS: "meta,google" } });
  // Seed 0008 kapalı yer tutucu satırları: MarcaDM kimlikleri gelmiş gibi aç.
  await sp.db.query(
    "UPDATE platform_stage_mappings SET platform_event_name = CASE stage_code WHEN 'QUALIFIED' THEN '111000111' ELSE '222000222' END, enabled = true WHERE provider = 'google'",
  );
  await sp.db.query(
    "UPDATE integration_settings SET value = '123-456-7890' WHERE provider = 'google' AND key = 'customer_id'",
  );
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
      GOOGLE_DM_SERVICE_ACCOUNT_KEY: Buffer.from(JSON.stringify(key)).toString("base64"),
      GOOGLE_DM_VALIDATE_ONLY: "1",
    },
    metaFetch: vi.fn(async (url: string) => {
      meta.push({ url });
      return new Response(JSON.stringify({ events_received: 1 }), { status: 200 });
    }),
    googleFetch: vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("oauth2.googleapis.com/token"))
        return new Response(JSON.stringify({ access_token: "g-token", expires_in: 3600 }), { status: 200 });
      google.push({
        url,
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
        auth: (init?.headers as Record<string, string> | undefined)?.["Authorization"],
      });
      return new Response(JSON.stringify({ requestId: "req-1" }), { status: 200 });
    }),
  });
});
afterAll(() => sp.close());

describe("bootAdFeedback — Google kanalı", () => {
  it("iki gönderici kuruldu", () => {
    expect(ad.providers).toEqual({ meta: true, google: true });
  });

  it("Google formu lead'i NEW → QUALIFIED → WON: Google'a yalnız Nitelikli ve Kazanıldı (gclid, hash'li e-posta/telefon, değer); Meta'ya beşi de", async () => {
    const lead = unwrap(
      await sp.pipeline.createLead.execute({
        source: "google_form",
        platformLeadId: "CjwKCAiA-lead-9",
        fullName: "Ayşe Demir",
        email: "Ayse.Demir@gmail.com",
        phone: "+905321234567",
        country: "TR",
        attribution: { gclid: "Cj0KCQjw-gclid-9" },
        actor: null,
      }),
    ).lead;
    unwrap(
      await sp.pipeline.changeLeadStage.execute({
        leadId: lead.id,
        target: "QUALIFIED",
        actor: REP,
        qualificationAnswers: { budget_approved: true, site_known: true, install_within_12m: true },
      }),
    );
    unwrap(
      await sp.pipeline.changeLeadStage.execute({
        leadId: lead.id,
        target: "WON",
        actor: REP,
        value: { amount: 185000, currency: "EUR" },
      }),
    );
    await sp.db.query("UPDATE outbound_conversion_events SET next_attempt_at = now() - interval '1 second'");
    const stats = await ad.feedback.dispatch.runOnce();
    // Olaylar: NEW, CONTACTED(auto), QUALIFIED, PROPOSAL(auto), WON → Meta 5 sent; Google: 2 sent, 3 mapping_missing.
    expect(stats).toMatchObject({ claimed: 10, sent: 7, skipped: 3, dead: 0 });
    expect(meta).toHaveLength(1);
    expect(google).toHaveLength(1);

    const { url, body, auth } = google[0]!;
    expect(url).toBe("https://datamanager.googleapis.com/v1/events:ingest");
    expect(auth).toBe("Bearer g-token");
    expect(body["encoding"]).toBe("HEX");
    expect(body["validateOnly"]).toBe(true);
    const destinations = body["destinations"] as Record<string, unknown>[];
    expect(destinations.map((d) => d["productDestinationId"]).sort()).toEqual(["111000111", "222000222"]);
    expect(destinations[0]!["operatingAccount"]).toEqual({ accountType: "GOOGLE_ADS", accountId: "1234567890" });
    const events = body["events"] as Record<string, unknown>[];
    expect(events).toHaveLength(2);
    for (const e of events) {
      expect(e["adIdentifiers"]).toEqual({ gclid: "Cj0KCQjw-gclid-9" });
      expect((e["userData"] as { userIdentifiers: unknown[] }).userIdentifiers).toEqual([
        // gmail kuralı: "Ayse.Demir@gmail.com" → "aysedemir@gmail.com"
        { emailAddress: "df39f45dcfee7dd3de7f235d8562bd6559dc7eb96b91d8bed04330c1b45ebb9c" },
        { phoneNumber: "57c4176feab36c8b2d9536954c377aee3fa760184cbdb9c3a431fbc707817386" },
      ]);
      expect(String(e["eventTimestamp"])).toMatch(/[+-]\d{2}:\d{2}$/);
      expect(e["eventSource"]).toBe("WEB");
      expect(e["consent"]).toEqual({ adUserData: "CONSENT_GRANTED", adPersonalization: "CONSENT_GRANTED" });
    }
    const won = events.find((e) => (e["destinationReferences"] as string[])[0] === "222000222")!;
    expect(won).toMatchObject({ conversionValue: 185000, currency: "EUR" });

    const rows = await sp.db.query<{ provider: string; status: string; skip_reason: string | null }>(
      "SELECT provider, status, skip_reason FROM outbound_conversion_events ORDER BY provider, status",
    );
    expect(rows.filter((r) => r.provider === "google" && r.status === "sent")).toHaveLength(2);
    expect(rows.filter((r) => r.provider === "google" && r.skip_reason === "mapping_missing")).toHaveLength(3);
    expect(rows.filter((r) => r.provider === "meta" && r.status === "sent")).toHaveLength(5);
  });
});
