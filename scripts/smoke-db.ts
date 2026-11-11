// Veritabanı duman testi: uygulamanın gerçek kompozisyonunu (satış hattı + gelen kutusu + giden kuyruk + yönetim
// işlemleri) verilen veritabanında baştan sona bir kez çalıştırır. Amaç: PGlite'ta geçen sorguların gerçek
// Postgres 16'da da (pg sürücüsüyle) çalıştığını canlıya almadan önce görmek.
//
//   npm run db:smoke                 → bellek içi PGlite (betiğin kendisini doğrular)
//   DATABASE_URL=postgres://… npm run db:smoke
//                                    → gerçek Postgres. Yalnız adı "smoke" ya da "test" içeren veritabanında çalışır
//                                      ve tabloları kendisi kurar; canlı veritabanına karşı çalışmayı reddeder.
//   Yerel Postgres 16: docker compose -f docker-compose.postgres.yml up -d   (docs/runbooks/canliya-alma.md)
//
// Dış servis çağrısı yoktur (gönderici ve token yok); veriler sentetiktir (example.test adresleri).
import express from "express";
import type { Server } from "node:http";
import { bootAdFeedback } from "../src/bootstrap/adFeedback";
import { bootAdmin } from "../src/bootstrap/admin";
import { bootLeadIntake } from "../src/bootstrap/leadIntake";
import { bootSalesPipeline } from "../src/bootstrap/salesPipeline";
import { silentLogger, unwrap } from "../src/modules/shared/kernel";

const url = process.env["DATABASE_URL"] ?? "";
const fail = (msg: string): never => {
  console.error(`[duman] ✘ ${msg}`);
  process.exit(1);
};
if (url) {
  let name = "";
  try {
    name = new URL(url).pathname.replace(/^\//, "");
  } catch {
    fail("DATABASE_URL okunamadı.");
  }
  if (!/smoke|test/i.test(name)) {
    fail(`Veritabanı adı "smoke" ya da "test" içermeli (verilen: "${name}"). Canlı veritabanında çalıştırılmaz.`);
  }
}

const ENV = { ...(url ? { DATABASE_URL: url } : {}), ENABLED_PROVIDERS: "meta,google" };
const ADMIN = { userId: "admin", isAdmin: true };
const REP = { userId: "rep-1", isAdmin: false };
const YES = { budget_approved: true, site_known: true, install_within_12m: true };
let step = 0;
const ok = (what: string) => console.log(`[duman] ✔ ${String(++step).padStart(2, "0")} ${what}`);
const must = (cond: unknown, what: string) => {
  if (!cond) fail(what);
};

const sp = await bootSalesPipeline({ logger: silentLogger, memory: !url, env: ENV });
const intake = bootLeadIntake(sp, { logger: silentLogger, env: ENV, startScheduler: false });
const ad = bootAdFeedback(sp, intake.settings, { logger: silentLogger, env: ENV, startScheduler: false });
console.log(`[duman] veritabanı: ${url ? "Postgres (DATABASE_URL)" : "PGlite (bellek içi)"}`);

try {
  const tag = Date.now().toString(36);
  const mail = (n: string) => `${n}.${tag}@example.test`;
  const p = sp.pipeline;

  const version = await sp.db.query<{ v: number | string }>("SELECT max(version) AS v FROM schema_migrations");
  must(Number(version[0]?.v) >= 13, "migration'lar uygulanmadı");
  ok(`şema sürümü ${Number(version[0]?.v)}`);

  // ---- bölge kuralı + lead'ler
  unwrap(await p.territories.save({ actor: ADMIN, fields: { countryCode: "TR", assignedUserId: "rep-1" } }));
  const routed = unwrap(
    await p.createLead.execute({
      source: "meta_form",
      platformLeadId: `1${Date.now()}`,
      fullName: "Duman Bir",
      email: mail("bir"),
      phone: "+90 532 000 00 01",
      country: "TR",
      campaign: { campaignName: "Duman" },
      extraAnswers: { soru: "cevap", liste: ["a", "b"] },
      actor: null,
    }),
  ).lead;
  must(routed.assignedUserId === "rep-1", "bölge kuralı atamadı");
  const pool = unwrap(
    await p.createLead.execute({
      source: "web_form",
      platformLeadId: `web-${tag}`,
      fullName: "Duman İki",
      email: mail("iki"),
      country: "DE",
      attribution: { gclid: "G-duman", clickAt: new Date() },
      consents: [{ type: "kvkk", granted: true, textVersion: "2026-01" }],
      actor: null,
    }),
  ).lead;
  const manual = unwrap(
    await p.createLead.execute({
      source: "manual",
      fullName: "Duman Üç",
      email: mail("uc"),
      country: "GB",
      actor: ADMIN,
      assignedUserId: null,
    }),
  ).lead;
  ok("lead oluşturma: reklam, site formu (onay + tıklama kimliği), elle");

  // ---- aşama, geri alma, temas, aktivite
  unwrap(await p.changeLeadStage.execute({ leadId: routed.id, target: "CONTACTED", actor: REP }));
  unwrap(await p.undoStageChange.execute({ leadId: routed.id, actor: REP }));
  unwrap(
    await p.changeLeadStage.execute({
      leadId: routed.id,
      target: "PROPOSAL",
      actor: REP,
      qualificationAnswers: YES,
      value: { amount: 25000, currency: "USD" },
    }),
  );
  unwrap(await p.logContact.execute({ leadId: routed.id, actor: REP, type: "call", outcome: "reply_received" }));
  unwrap(
    await p.addActivity.execute({
      leadId: routed.id,
      type: "call",
      subject: "Duman takibi",
      dueAt: new Date(Date.now() + 86_400_000),
      notes: null,
      actor: REP,
    }),
  );
  unwrap(
    await p.updateLeadFields.execute({
      leadId: routed.id,
      fields: {
        products: {
          standard: 2,
          panoramic: null,
          fullPanoramic: null,
          roof: { wanted: true, widthM: 10, lengthM: 20 },
        },
      },
      actor: ADMIN,
    }),
  );
  ok("aşama değişikliği, geri alma, teklif tutarı, temas kaydı, aktivite, ürün tercihleri");

  // ---- okuma tarafı
  const list = await p.queries.list({ actor: ADMIN, limit: 50 });
  must(list.length >= 3, "liste boş");
  const board = await p.queries.board({ actor: ADMIN });
  must((board.columns.find((c) => c.stage === "PROPOSAL")?.totalEur ?? 0) > 0, "pano toplamı hesaplanmadı");
  unwrap(await p.queries.get(routed.id, ADMIN));
  await p.reports.summary({ actor: ADMIN });
  unwrap(await p.reports.tracking({ actor: ADMIN }));
  await p.activities.today(REP);
  await p.people.persons({ actor: ADMIN, search: "duman" });
  await p.people.search({ actor: ADMIN, q: "duman" });
  ok("okuma: liste, pano (EUR toplamı), lead detayı, raporlar, Özet rapor, Bugün, kişiler, arama");

  // ---- yönetim: bölgeler, birleştirme, arşiv
  const overview = unwrap(await p.territories.overview(ADMIN));
  must(
    overview.rules.some((r) => r.rule.countryCode.trim() === "TR"),
    "bölge özeti kuralı göstermedi",
  );
  unwrap(await p.territories.save({ actor: ADMIN, fields: { countryCode: "GB", assignedUserId: "rep-1" } }));
  const applied = unwrap(await p.territories.applyToPool({ actor: ADMIN, dryRun: false }));
  must(applied.total >= 1, "havuza uygula atamadı");
  unwrap(await p.territories.remove({ actor: ADMIN, countryCode: "GB" }));
  const merged = unwrap(
    await p.mergePersons.execute({ targetId: pool.personId, sourceId: manual.personId, actor: ADMIN }),
  );
  must(merged.movedLeads === 1, "birleştirme lead taşımadı");
  const org = unwrap(await p.createOrganization.execute({ fields: { name: `Duman Kulübü ${tag}` }, actor: ADMIN }));
  unwrap(await p.archiveOrganization.execute({ organizationId: org.id, archived: true, actor: ADMIN }));
  unwrap(await p.archiveOrganization.execute({ organizationId: org.id, archived: false, actor: ADMIN }));
  ok("yönetim: bölge kuralı, havuza uygula, kişi birleştirme, kuruluş arşivi");

  // ---- giden kuyruk (gönderici yok: dağıtıcı satırları kalıcı hataya çevirir; ağ çağrısı olmaz)
  await sp.db.query(
    "UPDATE outbound_conversion_events SET next_attempt_at = now() - interval '1 minute' WHERE status = 'pending'",
  );
  const dispatched = await ad.feedback.dispatch.runOnce();
  must(dispatched.claimed > 0, "dağıtıcı satır almadı");
  const stats = await ad.feedback.health.stats();
  const dead = await ad.feedback.health.list({ statuses: ["dead"], limit: 5 });
  must(dead.length > 0 && dead[0]!.leadId !== null, "kuyruk listesi lead bağını getirmedi");
  unwrap(await ad.feedback.health.requeue([dead[0]!.id], "admin"));
  must(stats.counts.length > 0, "kuyruk özeti boş");
  ok(`giden kuyruk: dağıtım turu (${dispatched.claimed} satır), özet, liste, yeniden kuyruğa alma`);

  // ---- gelen kutusu
  await intake.intake.accept.execute({
    provider: "google",
    kind: "webhook",
    platformLeadId: `duman-${tag}`,
    payload: { lead_id: `duman-${tag}`, user_column_data: [] },
  });
  await intake.intake.process.runOnce();
  const failed = await intake.intake.health.listFailed();
  must(failed.length > 0, "başarısız bildirim listelenmedi");
  unwrap(await intake.intake.health.requeue([failed[0]!.id], "admin"));
  await intake.intake.health.stats();
  await intake.intake.purge.runOnce();
  ok("gelen kutusu: kabul, işleme, başarısız liste, yeniden işleme, özet, temizlik");

  // ---- ayarlar ve eşlemeler + yönetim API'si (gerçek Express)
  const app = express();
  app.use(express.json());
  app.use("/api/admin", bootAdmin(sp, intake, ad, { env: ENV }));
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}/api/admin`;
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(base + path, {
      method,
      headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!res.ok) fail(`${method} ${path} → HTTP ${res.status}`);
    return (await res.json()) as Record<string, unknown>;
  };
  try {
    await call("GET", "/health");
    const stages = (await call("GET", "/stage-mappings/meta")) as { rows: Record<string, unknown>[] };
    await call("PUT", "/stage-mappings/meta", { rows: stages.rows });
    const added = (await call("PUT", "/field-mappings/meta", {
      platformField: `duman_${tag}`,
      target: "extra",
      formId: "form-duman",
    })) as { rows: { id: string; platformField: string }[] };
    const row = added.rows.find((r) => r.platformField === `duman_${tag}`);
    must(row, "alan eşlemesi yazılmadı");
    await call("DELETE", `/field-mappings/meta/${row!.id}`);
    await call("PUT", "/settings/meta", { values: { active_form_ids: "1, 2" } });
    await call("PUT", "/eur-rates", { rates: { USD: 0.9, GBP: 1.15, TRY: 0.025 } });
    await call("POST", "/providers/meta/outbound", { enabled: true });
    await call("GET", "/outbox?status=pending,dead,skipped");
    await call("GET", "/inbox/failed");
  } finally {
    server.close();
  }
  ok("yönetim API'si: sağlık, aşama ve alan eşlemesi, ayar, kurlar, acil durdurma anahtarı");

  console.log(`[duman] ✔ ${step} adım geçti.`);
} catch (e) {
  console.error("[duman] ✘ hata:", e instanceof Error ? e.message : e);
  await sp.close().catch(() => undefined);
  process.exit(1);
}
await sp.close();
process.exit(0);
