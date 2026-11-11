/**
 * Yönetim paneli (Faz 7a–7d) kabul testi: gerçek Express + PGlite + sahte platform uçları. Kabul kriterleri:
 *  - Admin SQL'siz ayar değiştirir (aşama eşlemesi, alan eşlemesi, sağlayıcı ayarı, EUR kuru → pano toplamı).
 *  - Dead satır yeniden kuyruğa alınır ve dağıtıcı onu tekrar dener.
 *  - Acil durdurma ekrandan; dağıtıcı `emergency_stop` ile atlar.
 *  - requestStatus sonucu görünür (sahte Google ucu).
 *  - Bölge kuralları, kişi birleştirme, kuruluş arşivleme API'den.
 */
import express from "express";
import { generateKeyPairSync } from "node:crypto";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  EurRatesDto,
  FieldMappingsDto,
  HealthDto,
  InboxFailedDto,
  OutboxItemDto,
  ProviderSettingsDto,
  RequestStatusDto,
  StageMappingsDto,
} from "../modules/integration-settings/api";
import type {
  BoardDto,
  PersonSummaryDto,
  PoolApplyResultDto,
  ReferenceDto,
  TerritoriesDto,
} from "../modules/sales-pipeline/api";
import { MINUTE, silentLogger, unwrap } from "../modules/shared/kernel";
import { bootAdFeedback, type AdFeedbackApp } from "./adFeedback";
import { bootAdmin } from "./admin";
import { bootLeadIntake, type LeadIntakeApp } from "./leadIntake";
import { bootSalesPipeline, type SalesPipelineApp } from "./salesPipeline";

const ADMIN = { userId: "admin", isAdmin: true };
const SESSIONS: Record<string, { userId: string; role: string }> = {
  admin: { userId: "admin", role: "admin" },
  rep: { userId: "rep-1", role: "rep" },
  viewer: { userId: "viewer", role: "viewer" },
};
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const SERVICE_KEY = JSON.stringify({
  client_email: "crm@test-project.iam.gserviceaccount.com",
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  token_uri: "https://oauth2.googleapis.com/token",
});
const ENV = {
  ENABLED_PROVIDERS: "meta,google",
  META_SYSTEM_USER_TOKEN: "sys-token",
  META_DATASET_ID: "424242",
  GOOGLE_DM_SERVICE_ACCOUNT_KEY: SERVICE_KEY,
  GOOGLE_ADS_CUSTOMER_ID: "1234567890",
  GOOGLE_LEAD_FORM_KEY: "lead-form-key",
};

let sp: SalesPipelineApp;
let intake: LeadIntakeApp;
let ad: AdFeedbackApp;
let server: Server;
let base: string;
/** Sahte Meta ucu: sıradaki yanıt durumu (400 → dead). */
let metaStatus = 200;
const googleCalls: string[] = [];

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function call<T>(who: string | null, method: string, path: string, body?: unknown) {
  const init: RequestInit = {
    method,
    headers: { "content-type": "application/json", ...(who ? { "x-test-session": who } : {}) },
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await fetch(base + path, init);
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : undefined) as T };
}

beforeAll(async () => {
  sp = await bootSalesPipeline({ logger: silentLogger, memory: true, env: ENV });
  intake = bootLeadIntake(sp, { logger: silentLogger, env: ENV, startScheduler: false });
  ad = bootAdFeedback(sp, intake.settings, {
    logger: silentLogger,
    env: ENV,
    startScheduler: false,
    metaFetch: async () =>
      json(metaStatus, metaStatus === 200 ? { events_received: 1 } : { error: { message: "bad" } }),
    googleFetch: async (url: string) => {
      googleCalls.push(String(url));
      if (String(url).includes("oauth2")) return json(200, { access_token: "tok", expires_in: 3600 });
      if (String(url).includes("requestStatus:retrieve")) {
        return json(200, {
          requestStatusPerDestination: [{ requestStatus: "PROCESSING", eventsIngestionStatus: { recordCount: "1" } }],
        });
      }
      return json(200, { requestId: "req-google-1" });
    },
  });
  const ex = express();
  ex.use(express.json());
  ex.use((req, _res, next) => {
    const key = req.header("x-test-session");
    (req as express.Request & { session?: unknown }).session = key ? SESSIONS[key] : undefined;
    next();
  });
  // Sunucudaki bağlantının aynısı: oturum + yalnız yönetici.
  ex.use(
    "/api/admin",
    (req, res, next) => {
      const s = (req as express.Request & { session?: { role?: string } }).session;
      if (!s) return res.status(401).json({ error: "Oturum yok", code: "unauthorized" });
      if (s.role !== "admin") return res.status(403).json({ error: "Yalnız yönetici.", code: "admin_only" });
      next();
    },
    bootAdmin(sp, intake, ad, { env: ENV }),
  );
  ex.use("/api/pipeline", sp.router);
  await new Promise<void>((resolve) => {
    server = ex.listen(0, () => resolve());
  });
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});
afterAll(async () => {
  server.close();
  await sp.close();
});

/** Dağıtıcının bekleme süresini (geri al penceresi) atlamak için sıradaki satırları şimdiye çeker. */
const makeDue = () =>
  sp.db.query(
    "UPDATE outbound_conversion_events SET next_attempt_at = now() - interval '1 minute' WHERE status IN ('pending','failed')",
  );

describe("yönetim paneli API'si", () => {
  it("yalnız yönetici: oturumsuz 401, satışçı ve görüntüleyici 403", async () => {
    expect((await call(null, "GET", "/api/admin/health")).status).toBe(401);
    for (const who of ["rep", "viewer"]) {
      const r = await call<{ code: string }>(who, "GET", "/api/admin/health");
      expect([r.status, r.body.code]).toEqual([403, "admin_only"]);
    }
  });

  it("sağlık: sağlayıcılar, secret'lar yalnız ad + tanımlı mı; değer hiçbir yanıtta yok", async () => {
    const r = await call<HealthDto>("admin", "GET", "/api/admin/health");
    expect(r.status).toBe(200);
    const meta = r.body.providers.find((p) => p.provider === "meta")!;
    expect(meta.outbound).toEqual({ configured: true, listed: true, enabled: true, statusQuery: false });
    expect(meta.inbound).toEqual({ configured: false });
    expect(meta.secrets).toContainEqual({ name: "META_SYSTEM_USER_TOKEN", set: true });
    expect(meta.secrets).toContainEqual({ name: "META_APP_SECRET", set: false });
    const google = r.body.providers.find((p) => p.provider === "google")!;
    expect(google.outbound).toMatchObject({ configured: true, statusQuery: true });
    expect(r.body.providers.find((p) => p.provider === "web")!.outbound).toBeNull();
    expect(r.body.secrets).toContainEqual({ name: "INBOX_ENCRYPTION_KEY", set: false });
    const raw = JSON.stringify(r.body);
    expect(raw).not.toContain("sys-token");
    expect(raw).not.toContain("lead-form-key");
    expect(raw).not.toContain("PRIVATE KEY");
  });

  it("dead satır yeniden kuyruğa alınır ve dağıtıcı onu tekrar dener; gönderilmiş satır reddedilir", async () => {
    const lead = unwrap(
      await sp.pipeline.createLead.execute({
        source: "meta_form",
        platformLeadId: "1234567890123456",
        fullName: "Ayşe Demir",
        email: "ayse@example.com",
        country: "TR",
        actor: null,
      }),
    ).lead;
    await makeDue();
    metaStatus = 400;
    const first = await ad.feedback.dispatch.runOnce();
    expect(first.dead).toBe(1);

    const list = await call<OutboxItemDto[]>("admin", "GET", "/api/admin/outbox?status=dead&provider=meta");
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({ status: "dead", leadId: lead.id, stageCode: "NEW", lastResponseCode: 400 });
    const health = await call<HealthDto>("admin", "GET", "/api/admin/health");
    expect(health.body.outbox.counts).toContainEqual({ provider: "meta", status: "dead", count: 1 });

    const requeued = await call<{ requeued: number }>("admin", "POST", "/api/admin/outbox/requeue", {
      ids: [list.body[0]!.id],
    });
    expect([requeued.status, requeued.body.requeued]).toEqual([200, 1]);
    metaStatus = 200;
    const second = await ad.feedback.dispatch.runOnce();
    expect(second.sent).toBeGreaterThanOrEqual(1);
    const sent = await call<OutboxItemDto[]>("admin", "GET", "/api/admin/outbox?status=sent&provider=meta");
    expect(sent.body.map((x) => x.id)).toContain(list.body[0]!.id);

    const again = await call<{ code: string }>("admin", "POST", "/api/admin/outbox/requeue", {
      ids: [list.body[0]!.id],
    });
    expect([again.status, again.body.code]).toEqual([422, "outbox.not_requeueable"]);
  });

  it("acil durdurma ekrandan: anahtar kapalıyken dağıtıcı emergency_stop ile atlar; ekran değeri DB ile aynı", async () => {
    const off = await call<{ enabled: boolean }>("admin", "POST", "/api/admin/providers/meta/outbound", {
      enabled: false,
    });
    expect(off.body.enabled).toBe(false);
    expect(await intake.settings.outboundEnabled("meta")).toBe(false);
    const health = await call<HealthDto>("admin", "GET", "/api/admin/health");
    expect(health.body.providers.find((p) => p.provider === "meta")!.outbound!.enabled).toBe(false);

    unwrap(
      await sp.pipeline.createLead.execute({
        source: "meta_form",
        platformLeadId: "2234567890123456",
        fullName: "Durdurulan",
        email: "dur@example.com",
        country: "TR",
        actor: null,
      }),
    );
    await makeDue();
    await ad.feedback.dispatch.runOnce();
    const after = await call<HealthDto>("admin", "GET", "/api/admin/health");
    expect(after.body.outbox.skipReasons).toContainEqual({ provider: "meta", reason: "emergency_stop", count: 1 });

    await call("admin", "POST", "/api/admin/providers/meta/outbound", { enabled: true });
    expect(await intake.settings.outboundEnabled("meta")).toBe(true);
    const bad = await call<{ code: string }>("admin", "POST", "/api/admin/providers/web/outbound", { enabled: true });
    expect([bad.status, bad.body.code]).toEqual([422, "provider.outbound_invalid"]);
    const unknown = await call<{ code: string }>("admin", "POST", "/api/admin/providers/yok/outbound", {
      enabled: true,
    });
    expect([unknown.status, unknown.body.code]).toEqual([404, "provider.unknown"]);
  });

  it("aşama eşlemesi ekrandan: olay adı değişir ve platform_stage_mappings güncel; kurallar", async () => {
    const before = await call<StageMappingsDto>("admin", "GET", "/api/admin/stage-mappings/meta");
    expect(before.body.rows.map((r) => r.stageCode)).toEqual([
      "NEW",
      "CONTACTED",
      "QUALIFIED",
      "PROPOSAL",
      "WON",
      "LOST",
    ]);
    const rows = before.body.rows.map((r) =>
      r.stageCode === "QUALIFIED" ? { ...r, platformEventName: "Nitelikli Müşteri", enabled: true } : r,
    );
    const saved = await call<StageMappingsDto>("admin", "PUT", "/api/admin/stage-mappings/meta", { rows });
    expect(saved.status).toBe(200);
    const db = await sp.db.query<{ platform_event_name: string }>(
      "SELECT platform_event_name FROM platform_stage_mappings WHERE provider = 'meta' AND stage_code = 'QUALIFIED'",
    );
    expect(db[0]?.platform_event_name).toBe("Nitelikli Müşteri");

    const empty = await call<{ code: string }>("admin", "PUT", "/api/admin/stage-mappings/meta", {
      rows: [{ stageCode: "WON", platformEventName: " ", enabled: true, isOptimizationTarget: false }],
    });
    expect([empty.status, empty.body.code]).toEqual([422, "mapping.event_name_required"]);
    const two = await call<{ code: string }>("admin", "PUT", "/api/admin/stage-mappings/meta", {
      rows: [
        { stageCode: "WON", platformEventName: "A", enabled: true, isOptimizationTarget: true },
        { stageCode: "NEW", platformEventName: "B", enabled: true, isOptimizationTarget: true },
      ],
    });
    expect(two.body.code).toBe("mapping.multiple_targets");
    // Yeni hedef seçilince eski hedef düşer (sağlayıcı başına tek hedef).
    const target = await call<StageMappingsDto>("admin", "PUT", "/api/admin/stage-mappings/meta", {
      rows: [{ stageCode: "WON", platformEventName: "Kazanıldı", enabled: true, isOptimizationTarget: true }],
    });
    expect(target.body.rows.filter((r) => r.isOptimizationTarget).map((r) => r.stageCode)).toEqual(["WON"]);
  });

  it("alan eşlemesi: ekle, mükerrer reddi, düzenle, sil", async () => {
    const before = await call<FieldMappingsDto>("admin", "GET", "/api/admin/field-mappings/meta");
    expect(before.body.targets).toContain("ignore");
    const added = await call<FieldMappingsDto>("admin", "PUT", "/api/admin/field-mappings/meta", {
      platformField: "kac_kort_planliyorsunuz",
      target: "extra",
      formId: "form-9",
    });
    expect(added.status).toBe(200);
    const row = added.body.rows.find((r) => r.platformField === "kac_kort_planliyorsunuz")!;
    expect(row).toMatchObject({ formId: "form-9", target: "extra", isActive: true });
    expect(added.body.rows).toHaveLength(before.body.rows.length + 1);

    const dup = await call<{ code: string }>("admin", "PUT", "/api/admin/field-mappings/meta", {
      platformField: "kac_kort_planliyorsunuz",
      target: "notes",
      formId: "form-9",
    });
    expect([dup.status, dup.body.code]).toEqual([422, "mapping.duplicate"]);
    const badTarget = await call<{ code: string }>("admin", "PUT", "/api/admin/field-mappings/meta", {
      platformField: "x",
      target: "yok",
    });
    expect(badTarget.body.code).toBe("mapping.target_invalid");

    const edited = await call<FieldMappingsDto>("admin", "PUT", "/api/admin/field-mappings/meta", {
      id: row.id,
      platformField: "kac_kort_planliyorsunuz",
      target: "notes",
      formId: "form-9",
      isActive: false,
    });
    expect(edited.body.rows.find((r) => r.id === row.id)).toMatchObject({ target: "notes", isActive: false });
    // Kaydedilen eşleme hemen geçerli: pasif satır çözümlemeye girmez.
    expect((await intake.settings.mappingsFor("meta", "form-9")).has("kac_kort_planliyorsunuz")).toBe(false);

    const removed = await call<FieldMappingsDto>("admin", "DELETE", `/api/admin/field-mappings/meta/${row.id}`);
    expect(removed.body.rows).toHaveLength(before.body.rows.length);
    expect((await call("admin", "DELETE", `/api/admin/field-mappings/meta/${row.id}`)).status).toBe(404);
  });

  it("sağlayıcı ayarları: secret olmayanlar düzenlenir; liste JSON dizi olarak saklanır; bilinmeyen anahtar reddedilir", async () => {
    const saved = await call<ProviderSettingsDto>("admin", "PUT", "/api/admin/settings/meta", {
      values: { dataset_id: " 987654 ", active_form_ids: "111, 222 ,," },
    });
    expect(saved.status).toBe(200);
    expect(saved.body.settings.find((s) => s.key === "dataset_id")!.value).toBe("987654");
    expect(saved.body.settings.find((s) => s.key === "active_form_ids")!.value).toBe("111, 222");
    expect(await intake.settings.getJson<string[]>("meta", "active_form_ids", [])).toEqual(["111", "222"]);
    expect(saved.body.secrets).toContainEqual({ name: "META_SYSTEM_USER_TOKEN", set: true });
    const bad = await call<{ code: string }>("admin", "PUT", "/api/admin/settings/meta", {
      values: { outbound_enabled: "false" },
    });
    expect([bad.status, bad.body.code]).toEqual([422, "setting.invalid"]);
  });

  it("EUR kuru ekrandan değişir → pano toplamı ve referans hemen yeni kurla", async () => {
    const start = await call<EurRatesDto>("admin", "GET", "/api/admin/eur-rates");
    expect(start.body).toMatchObject({ source: "default", rates: { EUR: 1, USD: 0.92 } });
    const lead = unwrap(
      await sp.pipeline.createLead.execute({
        source: "manual",
        fullName: "Teklif",
        email: "teklif@example.com",
        country: "TR",
        actor: ADMIN,
        assignedUserId: "rep-1",
      }),
    ).lead;
    unwrap(
      await sp.pipeline.changeLeadStage.execute({
        leadId: lead.id,
        target: "PROPOSAL",
        actor: ADMIN,
        value: { amount: 1000, currency: "USD" },
        qualificationAnswers: { budget_approved: true, site_known: true, install_within_12m: true },
      }),
    );
    const total = async () =>
      (await call<BoardDto>("admin", "GET", "/api/pipeline/board")).body.columns.find((c) => c.stage === "PROPOSAL")!
        .totalEur;
    expect(await total()).toBe(920);

    const saved = await call<EurRatesDto>("admin", "PUT", "/api/admin/eur-rates", { rates: { usd: 0.5, TRY: 0.02 } });
    expect(saved.body).toMatchObject({ source: "setting", rates: { EUR: 1, USD: 0.5, TRY: 0.02 } });
    expect(saved.body.updatedAt).not.toBeNull();
    expect(await total()).toBe(500);
    expect((await call<ReferenceDto>("admin", "GET", "/api/pipeline/reference")).body.eurRates["USD"]).toBe(0.5);

    const bad = await call<{ code: string }>("admin", "PUT", "/api/admin/eur-rates", { rates: { USD: -1 } });
    expect([bad.status, bad.body.code]).toEqual([422, "eur_rates.invalid_rate"]);
    const shape = await call<{ code: string }>("admin", "PUT", "/api/admin/eur-rates", { rates: [1, 2] });
    expect(shape.body.code).toBe("eur_rates.invalid_shape");
  });

  it("requestStatus: Google satırında platformdaki akıbet görünür; Meta satırında desteklenmez", async () => {
    await sp.db.query(
      "UPDATE platform_stage_mappings SET platform_event_name = '111222333', enabled = true WHERE provider = 'google' AND stage_code = 'QUALIFIED'",
    );
    const lead = unwrap(
      await sp.pipeline.createLead.execute({
        source: "google_form",
        platformLeadId: "g-9001",
        fullName: "Google Lead",
        email: "google@example.com",
        country: "TR",
        attribution: { gclid: "Cj0KCQ-test", clickAt: new Date(Date.now() - 60 * MINUTE) },
        actor: null,
      }),
    ).lead;
    unwrap(
      await sp.pipeline.changeLeadStage.execute({
        leadId: lead.id,
        target: "QUALIFIED",
        actor: ADMIN,
        qualificationAnswers: { budget_approved: true, site_known: true, install_within_12m: true },
      }),
    );
    await makeDue();
    await ad.feedback.dispatch.runOnce();
    const sent = await call<OutboxItemDto[]>("admin", "GET", "/api/admin/outbox?status=sent&provider=google");
    const row = sent.body.find((x) => x.leadId === lead.id && x.stageCode === "QUALIFIED")!;
    expect(row).toMatchObject({ status: "sent", hasRequestId: true });

    const status = await call<RequestStatusDto>("admin", "GET", `/api/admin/outbox/${row.id}/status`);
    expect(status.status).toBe(200);
    expect(status.body).toEqual({
      requestId: "req-google-1",
      state: "processing",
      destinations: [{ state: "processing", recordCount: 1, errorCount: 0, warningCount: 0 }],
    });
    expect(googleCalls.some((u) => u.includes("requestStatus:retrieve?requestId=req-google-1"))).toBe(true);

    const metaSent = await call<OutboxItemDto[]>("admin", "GET", "/api/admin/outbox?status=sent&provider=meta");
    const unsupported = await call<{ code: string }>(
      "admin",
      "GET",
      `/api/admin/outbox/${metaSent.body[0]!.id}/status`,
    );
    expect([unsupported.status, unsupported.body.code]).toEqual([409, "status.unsupported"]);
    expect((await call("admin", "GET", "/api/admin/outbox/00000000-0000-4000-8000-000000000000/status")).status).toBe(
      404,
    );
  });

  it("gelen kutusu: başarısız satır listelenir (payload'sız) ve yeniden işlenir", async () => {
    await intake.intake.accept.execute({
      provider: "google",
      kind: "webhook",
      platformLeadId: "bozuk-1",
      payload: { lead_id: "bozuk-1", user_column_data: [] },
    });
    await intake.intake.process.runOnce();
    const failed = await call<InboxFailedDto[]>("admin", "GET", "/api/admin/inbox/failed");
    expect(failed.body).toHaveLength(1);
    expect(failed.body[0]).toMatchObject({ provider: "google", hasPayload: true });
    expect(failed.body[0]).not.toHaveProperty("payload");
    const health = await call<HealthDto>("admin", "GET", "/api/admin/health");
    expect(health.body.inbox.counts).toContainEqual({ provider: "google", status: "failed", count: 1 });
    expect(health.body.inbox.receivedLastDay).toBe(1);

    const requeued = await call<{ requeued: number }>("admin", "POST", "/api/admin/inbox/requeue", {
      ids: [failed.body[0]!.id],
    });
    expect(requeued.body.requeued).toBe(1);
    const stats = await intake.intake.process.runOnce();
    expect(stats.claimed).toBe(1);
    const none = await call<{ code: string }>("admin", "POST", "/api/admin/inbox/requeue", { ids: ["yok"] });
    expect([none.status, none.body.code]).toEqual([422, "inbox.not_requeueable"]);
  });

  it("bölgeler, kişi birleştirme ve arşiv uçları: yönetici yapar, satışçı 403", async () => {
    const put = await call("admin", "PUT", "/api/pipeline/territories/gb", { assignedUserId: "rep-1" });
    expect(put.status).toBe(200);
    expect((await call("rep", "PUT", "/api/pipeline/territories/de", { assignedUserId: "rep-1" })).status).toBe(403);
    expect((await call("viewer", "PUT", "/api/pipeline/territories/de", { assignedUserId: "rep-1" })).status).toBe(403);
    unwrap(
      await sp.pipeline.createLead.execute({
        source: "manual",
        fullName: "Havuz GB",
        email: "gb@example.com",
        country: "GB",
        actor: ADMIN,
        assignedUserId: null,
      }),
    );
    const t = await call<TerritoriesDto>("admin", "GET", "/api/pipeline/territories");
    expect(t.body.rules).toContainEqual(
      expect.objectContaining({ countryCode: "GB", assignedUserId: "rep-1", leadCount: 1, poolCount: 1 }),
    );
    expect(t.body.uncovered.map((u) => u.countryCode)).toContain("TR");
    const dry = await call<PoolApplyResultDto>("admin", "POST", "/api/pipeline/territories/apply-to-pool", {});
    expect(dry.body).toMatchObject({ dryRun: true, total: 1, byUser: [{ userId: "rep-1", count: 1 }] });
    const real = await call<PoolApplyResultDto>("admin", "POST", "/api/pipeline/territories/apply-to-pool", {
      dryRun: false,
    });
    expect(real.body).toMatchObject({ dryRun: false, total: 1 });
    expect((await call("admin", "DELETE", "/api/pipeline/territories/GB")).status).toBe(204);

    const persons = await call<PersonSummaryDto[]>("admin", "GET", "/api/pipeline/persons?q=example.com");
    const [a, b] = persons.body.map((p) => p.person.id);
    expect((await call("rep", "POST", `/api/pipeline/persons/${a}/merge`, { sourceId: b })).status).toBe(403);
    const merged = await call<{ personId: string; movedLeads: number }>(
      "admin",
      "POST",
      `/api/pipeline/persons/${a}/merge`,
      { sourceId: b },
    );
    expect([merged.status, merged.body.personId]).toEqual([200, a]);
    const again = await call<{ code: string }>("admin", "POST", `/api/pipeline/persons/${a}/merge`, { sourceId: b });
    expect([again.status, again.body.code]).toEqual([422, "person.merge_invalid"]);

    const org = await call<{ id: string }>("admin", "POST", "/api/pipeline/organizations", { name: "Arşiv Kulübü" });
    const archived = await call<{ archivedAt: string | null }>(
      "admin",
      "POST",
      `/api/pipeline/organizations/${org.body.id}/archive`,
    );
    expect(archived.body.archivedAt).not.toBeNull();
    expect((await call<unknown[]>("admin", "GET", "/api/pipeline/organizations?q=arşiv")).body).toHaveLength(0);
    expect((await call<unknown[]>("admin", "GET", "/api/pipeline/organizations?q=arşiv&archived=1")).body).toHaveLength(
      1,
    );
    const back = await call<{ archivedAt: string | null }>(
      "admin",
      "POST",
      `/api/pipeline/organizations/${org.body.id}/unarchive`,
    );
    expect(back.body.archivedAt).toBeNull();
  });
});
