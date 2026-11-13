/**
 * Web sitesi çekme modu, uçtan uca: sahte WP sunucusu (gerçek HTTP, sözleşme v1 imza doğrulaması) → web-pull işi →
 * gerçek inbox (PGlite) → web-form adaptörü → gerçek CreateLead. Sunucunun kompozisyonu (bootSalesPipeline →
 * bootLeadIntake) kullanılır; iki "süreç" aynı veritabanına bağlı iki bootLeadIntake ile taklit edilir.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { verifyWebFormSignature } from "../modules/lead-intake/adapters/web-form";
import { RecordingEmailSender } from "../modules/sales-pipeline/application";
import { silentLogger } from "../modules/shared/kernel";
import { bootLeadIntake, type LeadIntakeApp } from "./leadIntake";
import { bootSalesPipeline, type SalesPipelineApp } from "./salesPipeline";

const KEY = "fake-web-pull-key";

interface SiteItem {
  submission_id: unknown;
  payload: unknown;
}

/** Sitenin çekme API'si (sözleşme v1): imza ve op denetimi; onaylanana kadar aynı öğe en eskiden döner. */
class FakeWp {
  queue: SiteItem[] = [];
  acked = new Set<string>();
  ackCalls: { submission_id: string; status: string }[][] = [];
  routes: string[] = [];
  /** Sitenin saati (imza penceresi için), ms. */
  clockOffsetMs = 0;
  /** "drop-ack": onay isteğinde bağlantıyı kopar (ağ hatası). */
  mode: "normal" | "drop-ack" | "429" = "normal";
  private server: Server | null = null;
  base = "";

  async start(): Promise<void> {
    this.server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => this.handle(req.url ?? "", req.headers, Buffer.concat(chunks), res));
    });
    await new Promise<void>((r) => this.server!.listen(0, "127.0.0.1", () => r()));
    const { port } = this.server.address() as AddressInfo;
    this.base = `http://127.0.0.1:${port}/?rest_route=/unixpadel/v1/crm`;
  }

  stop(): Promise<void> {
    return new Promise((r) => (this.server ? this.server.close(() => r()) : r()));
  }

  pendingIds(): string[] {
    return this.queue.map((i) => String(i.submission_id)).filter((id) => !this.acked.has(id));
  }

  private handle(
    url: string,
    headers: Record<string, string | string[] | undefined>,
    raw: Buffer,
    res: import("node:http").ServerResponse,
  ) {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const route = new URL(url, "http://x").searchParams.get("rest_route") ?? "";
    this.routes.push(route);
    const check = verifyWebFormSignature(
      raw,
      { signature: headers["x-webform-signature"] as string, timestamp: headers["x-webform-timestamp"] as string },
      KEY,
      Date.now() + this.clockOffsetMs,
    );
    if (!check.ok) return send(401, { ok: false, reason: check.reason });
    if (this.mode === "429") return send(429, { ok: false });
    let body: { op?: string; limit?: number; items?: { submission_id: string; status: string }[] };
    try {
      body = JSON.parse(raw.toString("utf8"));
    } catch {
      return send(400, { ok: false });
    }
    if (route.endsWith("/pending") && body.op === "pending") {
      const limit = Number(body.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) return send(400, { ok: false });
      const open = this.queue.filter((i) => !this.acked.has(String(i.submission_id)));
      return send(200, { ok: true, items: open.slice(0, limit), more: open.length > limit });
    }
    if (route.endsWith("/ack") && body.op === "ack" && Array.isArray(body.items)) {
      if (this.mode === "drop-ack") {
        res.socket?.destroy();
        return;
      }
      this.ackCalls.push(body.items);
      const known = new Set(this.queue.map((i) => String(i.submission_id)));
      const unknown: string[] = [];
      let acked = 0;
      for (const it of body.items) {
        if (!known.has(it.submission_id)) unknown.push(it.submission_id);
        else {
          this.acked.add(it.submission_id);
          acked += 1;
        }
      }
      return send(200, { ok: true, acked, unknown });
    }
    return send(400, { ok: false });
  }
}

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** Sözleşme v1 payload'ı (submission_id üst seviyede, payload içinde değil). */
function item(n: number, fields: Record<string, unknown> = {}, extra: Record<string, unknown> = {}): SiteItem {
  return {
    submission_id: uuid(n),
    payload: {
      form_id: "quote",
      submitted_at: "2026-11-12T08:30:00Z",
      page_url: "https://www.unixpadel.com/en/contact/?gclid=EAIa-test",
      is_test: false,
      honeypot: "",
      consents: [{ type: "kvkk", granted: true, text_version: "2026-01" }],
      attribution: { gclid: `EAIa-test-${n}`, utm_source: "google", landing_url: "https://www.unixpadel.com/en/" },
      fields: {
        name: `Kişi ${n}`,
        company: "Club Test",
        email: `kisi${n}@example.com`,
        phone: "+49 151 2345678",
        country: "DE",
        product_interest: "Panoramic padel court",
        product_slug: "panoramic-padel-court",
        project_type: "Sports club",
        court_count: "4",
        message: "Teklif istiyoruz.",
        page_language: "en",
        ...fields,
      },
      ...extra,
    },
  };
}

let sp: SalesPipelineApp;
let wp: FakeWp;
const boot = (): LeadIntakeApp =>
  bootLeadIntake(sp, {
    logger: silentLogger,
    startScheduler: false,
    env: { WEB_FORM_HMAC_KEY: KEY },
  });

beforeAll(async () => {
  wp = new FakeWp();
  await wp.start();
  sp = await bootSalesPipeline({
    logger: silentLogger,
    memory: true,
    // config bootSalesPipeline'da okunur: WEB_PULL_URL burada verilmeli.
    env: { WEB_PULL_URL: wp.base, WEB_PULL_LIMIT: "50", WEB_PULL_MAX_PAGES: "10" },
    email: new RecordingEmailSender(),
  });
  await sp.db.query("INSERT INTO territory_rules (country_code, assigned_user_id) VALUES ('DE', 'rep-de')");
});
afterAll(async () => {
  await wp.stop();
  await sp.close();
});
beforeEach(() => {
  wp.queue = [];
  wp.acked = new Set();
  wp.ackCalls = [];
  wp.routes = [];
  wp.clockOffsetMs = 0;
  wp.mode = "normal";
});
afterEach(async () => {
  await sp.db.exec(
    "TRUNCATE inbound_webhook_events, user_notifications, lead_attribution, lead_consents, lead_stage_events, outbound_conversion_events CASCADE",
  );
  await sp.db.exec("TRUNCATE leads, persons CASCADE");
  await sp.db.query("DELETE FROM integration_settings WHERE provider = 'web' AND key = 'pull_status'");
});

const leads = () =>
  sp.db.query<{
    platform_lead_id: string;
    source: string;
    full_name: string;
    country: string | null;
    product_interest: string;
    customer_profile: string | null;
    court_count: number | null;
    court_count_band: string | null;
    assigned_user_id: string | null;
    created_at: Date;
    extra_answers: Record<string, unknown>;
  }>(
    "SELECT platform_lead_id, source, full_name, country, product_interest, customer_profile, court_count, court_count_band, assigned_user_id, created_at, extra_answers FROM leads ORDER BY platform_lead_id",
  );

describe("web-pull: sahte WP sunucusuyla", () => {
  it("yapılandırma: WEB_PULL_URL + WEB_FORM_HMAC_KEY → iş kurulur; anahtar yoksa kapalı", () => {
    expect(boot().webPull).not.toBeNull();
    expect(boot().providers.webPull).toBe(true);
    const noKey = bootLeadIntake(sp, { logger: silentLogger, startScheduler: false, env: {} });
    expect(noKey.webPull).toBeNull();
    expect(noKey.providers.webPull).toBe(false);
  });

  it("mutlu yol: çek → inbox → onay; lead alanları (profil, kort, ülke, ürün, gclid) doğru; bildirim düşer", async () => {
    wp.queue = [item(1), item(2, { project_type: "Hotel / resort", court_count: "8", country: "TR" })];
    const app = boot();
    const round = await app.webPull!.runOnce();
    expect(round).toEqual({ pages: 1, fetched: 2, inserted: 2, duplicate: 0, invalid: 0, acked: 2, unknown: 0 });
    expect(wp.routes).toEqual(["/unixpadel/v1/crm/pending", "/unixpadel/v1/crm/ack"]);
    expect(wp.ackCalls).toEqual([
      [
        { submission_id: uuid(1), status: "inserted" },
        { submission_id: uuid(2), status: "inserted" },
      ],
    ]);
    expect(wp.pendingIds()).toEqual([]);

    expect(await app.intake.process.runOnce()).toMatchObject({ claimed: 2, done: 2, failed: 0 });
    const [a, b] = await leads();
    expect(a).toMatchObject({
      platform_lead_id: uuid(1),
      source: "web_form",
      full_name: "Kişi 1",
      country: "DE",
      product_interest: "Panoramic padel court",
      customer_profile: "club_operator",
      court_count: 4,
      court_count_band: "4_6",
      assigned_user_id: "rep-de",
    });
    expect(a!.extra_answers).toMatchObject({
      product_slug: "panoramic-padel-court",
      page_language: "en",
      page_url: "https://www.unixpadel.com/en/contact/?gclid=EAIa-test",
    });
    expect(b).toMatchObject({ country: "TR", customer_profile: "hospitality_residential", court_count: 8 });
    const attr = await sp.db.query<{ gclid: string }>("SELECT gclid FROM lead_attribution ORDER BY gclid");
    expect(attr.map((r) => r.gclid)).toEqual(["EAIa-test-1", "EAIa-test-2"]);
    const notes = await sp.db.query<{ user_id: string }>("SELECT user_id FROM user_notifications");
    expect(notes.map((n) => n.user_id)).toContain("rep-de");

    // Durum veritabanına yazılır (yönetim paneli başka süreçte okur); kişisel veri yok.
    const status = await app.webPullStatus.load();
    expect(status).toMatchObject({ lastRunOk: true, lastErrorCode: null, lastRound: { inserted: 2, acked: 2 } });
    expect(status?.lastPullAt).not.toBeNull();
    expect(JSON.stringify(status)).not.toMatch(/example\.com|Kişi/);
  });

  it("sayfalama: more:true iken devam eder; tur başına sayfa sınırı; kalan sonraki turda", async () => {
    wp.queue = Array.from({ length: 120 }, (_, i) => item(i + 1));
    const app = boot();
    expect(await app.webPull!.runOnce()).toMatchObject({ pages: 3, fetched: 120, inserted: 120, acked: 120 });
    expect(wp.pendingIds()).toEqual([]);

    await sp.db.exec("TRUNCATE inbound_webhook_events");
    wp.acked = new Set();
    // Sayfa sınırı config'ten okunur (bootSalesPipeline); farklı sınır için iş aynı bileşenlerle elle kurulur.
    const limited = boot();
    const two = await runWithLimits(limited, { maxPages: 2, pageSize: 50 });
    expect(two).toMatchObject({ pages: 2, inserted: 100, acked: 100 });
    expect(wp.pendingIds()).toHaveLength(20);
    expect(await runWithLimits(limited, { maxPages: 2, pageSize: 50 })).toMatchObject({ pages: 1, inserted: 20 });
    expect(wp.pendingIds()).toEqual([]);
  });

  it("ağ hatası: site kapalıyken onay yok, inbox boş; onay yolda koparsa sonraki tur duplicate olarak onaylar", async () => {
    const app = boot();
    wp.queue = [item(1)];
    wp.mode = "429";
    expect(await app.webPull!.runOnce()).toMatchObject({ fetched: 0, acked: 0 });
    expect((await app.webPullStatus.load())?.lastErrorCode).toBe("rate_limited");
    expect(await sp.db.query("SELECT id FROM inbound_webhook_events")).toHaveLength(0);

    wp.mode = "drop-ack";
    expect(await app.webPull!.runOnce()).toMatchObject({ fetched: 1, inserted: 1, acked: 0 });
    expect((await app.webPullStatus.load())?.lastErrorCode).toBe("network");
    expect(wp.ackCalls).toEqual([]);
    expect(wp.pendingIds()).toEqual([uuid(1)]);

    wp.mode = "normal";
    expect(await app.webPull!.runOnce()).toMatchObject({ fetched: 1, inserted: 0, duplicate: 1, acked: 1 });
    expect(wp.ackCalls).toEqual([[{ submission_id: uuid(1), status: "duplicate" }]]);
    const status = await app.webPullStatus.load();
    expect(status).toMatchObject({ lastRunOk: true, lastErrorCode: "network" });
    await app.intake.process.runOnce();
    expect(await leads()).toHaveLength(1);
  });

  it("site kapalı (bağlantı reddi) → network; onay gönderilmez", async () => {
    const down = bootLeadIntake(sp, { logger: silentLogger, startScheduler: false, env: { WEB_FORM_HMAC_KEY: KEY } });
    const offline = new FakeWp();
    await offline.start();
    await offline.stop();
    const r = await runWithLimits(down, { baseUrl: offline.base });
    expect(r).toMatchObject({ fetched: 0, acked: 0 });
    expect((await down.webPullStatus.load())?.lastErrorCode).toBe("network");
  });

  it("yinelenen öğe → tek lead: iki süreç aynı anda çeker ve işler; aynı sayfada iki kez gelen öğe", async () => {
    wp.queue = [item(1), item(2), { ...item(1) }];
    const a = boot();
    const b = boot();
    const [ra, rb] = await Promise.all([a.webPull!.runOnce(), b.webPull!.runOnce()]);
    expect(ra.inserted + rb.inserted).toBe(2);
    expect(ra.duplicate + rb.duplicate).toBe(ra.fetched + rb.fetched - 2);
    expect(await sp.db.query("SELECT id FROM inbound_webhook_events")).toHaveLength(2);
    await Promise.all([a.intake.process.runOnce(), b.intake.process.runOnce()]);
    await a.intake.process.runOnce();
    const rows = await leads();
    expect(rows.map((l) => l.platform_lead_id)).toEqual([uuid(1), uuid(2)]);
    expect(wp.pendingIds()).toEqual([]);
  });

  it("401 stale: site saati 6 dk ileri → onay yok, inbox boş; durum config hatası; yanlış anahtar mismatch", async () => {
    wp.queue = [item(1)];
    wp.clockOffsetMs = 6 * 60_000;
    const app = boot();
    expect(await app.webPull!.runOnce()).toMatchObject({ fetched: 0, acked: 0 });
    expect(await app.webPullStatus.load()).toMatchObject({
      lastRunOk: false,
      lastErrorCode: "unauthorized.stale",
      lastErrorKind: "config",
    });
    expect(wp.pendingIds()).toEqual([uuid(1)]);
    expect(await sp.db.query("SELECT id FROM inbound_webhook_events")).toHaveLength(0);

    wp.clockOffsetMs = 0;
    const wrong = bootLeadIntake(sp, {
      logger: silentLogger,
      startScheduler: false,
      env: { WEB_FORM_HMAC_KEY: "baska-anahtar" },
    });
    await wrong.webPull!.runOnce();
    expect((await wrong.webPullStatus.load())?.lastErrorCode).toBe("unauthorized.mismatch");
  });

  it("eski kayıt: country boş + country_input (6 dil) ve import_source → ülke çözülür, tarih korunur, bildirim düşer", async () => {
    const legacy = (n: number, countryInput: string) =>
      item(
        n,
        { country: "", country_input: countryInput, import_source: "wp-legacy", project_type: "Municipality / public" },
        { submitted_at: "2024-05-02T10:00:00Z" },
      );
    wp.queue = [legacy(1, "Allemagne"), legacy(2, "Германия"), legacy(3, "ألمانيا"), legacy(4, "Deutschland")];
    const app = boot();
    expect(await app.webPull!.runOnce()).toMatchObject({ inserted: 4, acked: 4 });
    expect(await app.intake.process.runOnce()).toMatchObject({ done: 4, failed: 0 });
    const rows = await leads();
    for (const l of rows) {
      expect(l).toMatchObject({ country: "DE", customer_profile: "public_facility", assigned_user_id: "rep-de" });
      expect(l.created_at.toISOString()).toBe("2024-05-02T10:00:00.000Z");
      expect(l.extra_answers).toMatchObject({ import_source: "wp-legacy" });
      expect(l.extra_answers["country_source"]).toBeUndefined();
    }
    expect(rows.map((l) => l.extra_answers["country_input"])).toEqual([
      "Allemagne",
      "Германия",
      "ألمانيا",
      "Deutschland",
    ]);
    const notes = await sp.db.query<{ user_id: string }>("SELECT user_id FROM user_notifications");
    expect(notes.filter((n) => n.user_id === "rep-de")).toHaveLength(4);
  });

  it("bot (honeypot dolu) ve bozuk payload da onaylanır, kuyruk ilerler; bot lead açmaz, bozuk failed; kimliksiz onaylanmaz", async () => {
    wp.queue = [
      item(1, {}, { honeypot: "http://spam.example" }),
      { submission_id: uuid(2), payload: "bozuk" },
      { submission_id: null, payload: item(3).payload },
      item(4),
    ];
    const app = boot();
    expect(await app.webPull!.runOnce()).toMatchObject({ fetched: 4, inserted: 3, invalid: 1, acked: 3 });
    expect(wp.pendingIds()).toEqual(["null"]);
    expect(await app.intake.process.runOnce()).toMatchObject({ claimed: 3, done: 1, ignored: 1, failed: 1 });
    expect((await leads()).map((l) => l.platform_lead_id)).toEqual([uuid(4)]);
    const rows = await sp.db.query<{ dedupe_key: string; status: string; last_error_code: string | null }>(
      "SELECT dedupe_key, status, last_error_code FROM inbound_webhook_events ORDER BY dedupe_key",
    );
    expect(rows).toEqual([
      { dedupe_key: `web:${uuid(1)}`, status: "done", last_error_code: "web.honeypot" },
      { dedupe_key: `web:${uuid(2)}`, status: "failed", last_error_code: "intake.invalid_lead" },
      { dedupe_key: `web:${uuid(4)}`, status: "done", last_error_code: null },
    ]);
  });
});

/** Config'i değiştirmeden aynı bileşenlerle sınırları farklı bir iş kurar (sayfa sınırı, taban adres). */
async function runWithLimits(
  app: LeadIntakeApp,
  o: { maxPages?: number; pageSize?: number; baseUrl?: string },
): Promise<import("../modules/lead-intake/application").WebPullRound> {
  const { PullWebSubmissions } = await import("../modules/lead-intake/application");
  const { createWebPullClient, webPullItemToInbox } = await import("../modules/lead-intake/adapters/web-form");
  const { systemClock } = await import("../modules/shared/kernel");
  const job = new PullWebSubmissions({
    source: createWebPullClient({ baseUrl: o.baseUrl ?? wp.base, secret: KEY }),
    accept: app.intake.accept,
    provider: "web",
    toInbox: webPullItemToInbox,
    clock: systemClock,
    logger: silentLogger,
    status: app.webPullStatus,
    ...(o.maxPages ? { maxPages: o.maxPages } : {}),
    ...(o.pageSize ? { pageSize: o.pageSize } : {}),
  });
  return job.runOnce();
}
