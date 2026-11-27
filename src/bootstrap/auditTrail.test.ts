/**
 * HTTP denetim izi + değiştirilemez işlem günlüğü (2026-11-27): gerçek Express + PGlite. Yönetim uçları burada sahte
 * yanıt döner (yalnız günlüğe ne yazıldığı denetlenir); lead uçları gerçek satış pipeline'ıdır. Sentetik veri.
 */
import express from "express";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { silentLogger } from "../modules/shared/kernel";
import type { LeadDto } from "../modules/sales-pipeline/api/dto";
import type { ActionLogDto, ActionLogPageDto } from "../modules/sales-pipeline/api/dto.actionLog";
import { AUDIT_ROUTES, matchAuditRoute, resultOf } from "./auditTrail";
import { bootSalesPipeline, type SalesPipelineApp } from "./salesPipeline";

let app: SalesPipelineApp;
let server: Server;
let base: string;
let leadId: string;

const SESSIONS: Record<string, { userId: string; role: string; seesLogs?: boolean }> = {
  rep1: { userId: "rep-1", role: "rep" },
  admin: { userId: "admin", role: "admin" },
  boss: { userId: "boss", role: "admin", seesLogs: true },
};

async function call<T>(who: string | null, method: string, path: string, body?: unknown) {
  const init: RequestInit = {
    method,
    headers: { "content-type": "application/json", ...(who ? { "x-test-session": who } : {}) },
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await fetch(base + "/api" + path, init);
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : undefined) as T };
}
const logs = async (qs = "") => (await call<ActionLogPageDto>("boss", "GET", `/pipeline/action-logs${qs}`)).body.items;
/** Ara katman yanıt bittikten sonra yazar: beklenen satır gelene kadar kısa aralıkla okur. */
async function until(pred: (items: ActionLogDto[]) => boolean, qs = ""): Promise<ActionLogDto[]> {
  for (let i = 0; i < 40; i++) {
    const items = await logs(qs);
    if (pred(items)) return items;
    await new Promise((r) => setTimeout(r, 25));
  }
  return logs(qs);
}
const settle = () => new Promise((r) => setTimeout(r, 150));

beforeAll(async () => {
  app = await bootSalesPipeline({ logger: silentLogger, memory: true });
  const ex = express();
  ex.use(express.json({ limit: "25mb" }));
  ex.use((req, _res, next) => {
    const key = req.header("x-test-session");
    (req as express.Request & { session?: unknown }).session = key ? SESSIONS[key] : undefined;
    next();
  });
  ex.use("/api", app.audit);
  // Sahte yönetim ucu (integration-settings burada kurulmaz): yalnız günlük satırı denetlenir.
  ex.put("/api/admin/settings/:provider", (_req, res) => {
    res.json({});
  });
  ex.post("/api/brand-new-endpoint", (_req, res) => {
    res.json({});
  });
  ex.use("/api/pipeline", app.router);
  await new Promise<void>((resolve) => {
    server = ex.listen(0, () => resolve());
  });
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const lead = await call<{ lead: LeadDto }>("rep1", "POST", "/pipeline/leads", {
    fullName: "Denetim Deneme",
    email: "denetim@y.co",
  });
  leadId = lead.body.lead.id;
});
afterAll(async () => {
  server.close();
  await app.close();
});

describe("HTTP denetim izi", () => {
  it("reddedilen lead işlemi de yazılır: satışçının silme denemesi denied, lead adıyla", async () => {
    const r = await call("rep1", "DELETE", `/pipeline/leads/${leadId}`, { reason: "deneme" });
    expect(r.status).toBe(403);
    const items = await until((xs) => xs.some((e) => e.action === "lead.deleted"));
    const e = items.find((x) => x.action === "lead.deleted")!;
    expect(e).toMatchObject({
      actorUserId: "rep-1",
      result: "denied",
      targetType: "lead",
      targetId: leadId,
      targetLabel: "Denetim Deneme",
      leadId,
    });
    expect(e.details).toMatchObject({ method: "DELETE", path: "/pipeline/leads/:id", status: 403 });
  });

  it("başarılı lead işlemi tek satır yazar (use-case); aynı değer yeniden gönderilince satır yok", async () => {
    await call("rep1", "PATCH", `/pipeline/leads/${leadId}`, { notes: "ilk" });
    await call("rep1", "PATCH", `/pipeline/leads/${leadId}`, { notes: "ilk" });
    await settle();
    const fields = (await logs()).filter((e) => e.action === "lead.fields_updated");
    expect(fields).toHaveLength(1);
    expect(fields[0]).toMatchObject({ result: "ok", details: { fields: ["notes"] } });
  });

  it("alan değişikliğinde kişisel olmayan alanların eski → yeni değeri yazılır, serbest metnin değeri yazılmaz", async () => {
    await call("admin", "PATCH", `/pipeline/leads/${leadId}`, { courtCount: 3, city: "İzmir" });
    const items = await until((xs) => xs.some((e) => e.actorUserId === "admin" && e.action === "lead.fields_updated"));
    const e = items.find((x) => x.actorUserId === "admin" && x.action === "lead.fields_updated")!;
    expect(e.details).toEqual({ fields: ["courtCount", "city"], changes: { courtCount: { from: null, to: 3 } } });
    expect(JSON.stringify(e)).not.toContain("İzmir");
  });

  it("yönetim işlemi yazılır: bölge kuralı, kişisel olmayan gövde değerleriyle", async () => {
    const put = await call("admin", "PUT", "/pipeline/territories/DE", { assignedUserId: "12", fallbackUserId: null });
    expect(put.status).toBe(200);
    const items = await until((xs) => xs.some((e) => e.action === "territory.updated"));
    expect(items.find((e) => e.action === "territory.updated")).toMatchObject({
      actorUserId: "admin",
      targetType: "territory",
      targetId: "DE",
      targetLabel: "DE",
      result: "ok",
      details: { assignedUserId: "12", fallbackUserId: null, method: "PUT", status: 200 },
    });
  });

  it("yönetimde reddedilen deneme denied olarak yazılır", async () => {
    expect((await call("rep1", "DELETE", "/pipeline/territories/FR")).status).toBe(403);
    const items = await until((xs) => xs.some((e) => e.action === "territory.deleted"));
    expect(items.find((e) => e.action === "territory.deleted")).toMatchObject({ result: "denied", targetId: "FR" });
  });

  it("önizleme (dryRun) yazılmaz; onaylanan uygulama yazılır", async () => {
    expect((await call("admin", "POST", "/pipeline/territories/apply-to-pool", { dryRun: true })).status).toBe(200);
    await settle();
    expect((await logs()).some((e) => e.action === "territory.applied_to_pool")).toBe(false);
    expect((await call("admin", "POST", "/pipeline/territories/apply-to-pool", { dryRun: false })).status).toBe(200);
    const items = await until((xs) => xs.some((e) => e.action === "territory.applied_to_pool"));
    expect(items.filter((e) => e.action === "territory.applied_to_pool")).toHaveLength(1);
  });

  it("ayar değerleri (anahtar, belirteç) asla yazılmaz; yalnız alan adları", async () => {
    await call("admin", "PUT", "/admin/settings/meta", { values: { accessToken: "çok-gizli-belirteç" } });
    const items = await until((xs) => xs.some((e) => e.action === "settings.updated"));
    const e = items.find((x) => x.action === "settings.updated")!;
    expect(e).toMatchObject({ targetType: "settings", targetId: "meta", details: { fields: ["accessToken"] } });
    expect(JSON.stringify(e)).not.toContain("gizli");
  });

  it("tabloda olmayan yeni yazma ucu da iz bırakır (request.other)", async () => {
    await call("admin", "POST", "/brand-new-endpoint", { foo: 1 });
    const items = await until((xs) => xs.some((e) => e.action === "request.other"));
    expect(items.find((e) => e.action === "request.other")).toMatchObject({
      targetType: "request",
      details: { method: "POST", path: "/brand-new-endpoint", fields: ["foo"], status: 200 },
    });
  });

  it("okundu işareti ve oturumsuz istek yazılmaz", async () => {
    const before = (await logs()).length;
    await call("rep1", "POST", "/pipeline/notifications/read-all");
    await call(null, "POST", "/brand-new-endpoint", {});
    await settle();
    expect((await logs()).length).toBe(before);
  });
});

describe("işlem günlüğü süzgeçleri", () => {
  it("hedef adında arama (büyük/küçük harf duyarsız), hedef türü, tek hedef ve sonuç", async () => {
    await until((xs) => xs.some((e) => e.action === "request.other"));
    const byName = await logs("?q=denetim");
    expect(byName.length).toBeGreaterThan(0);
    expect(byName.every((e) => e.targetLabel === "Denetim Deneme")).toBe(true);
    const territory = await logs("?target=territory");
    expect(new Set(territory.map((e) => e.targetType))).toEqual(new Set(["territory"]));
    const one = await logs(`?target=lead&targetId=${leadId}`);
    expect(one.length).toBe(byName.length);
    const denied = await logs("?result=denied");
    expect(denied.map((e) => e.action).sort()).toEqual(["lead.deleted", "territory.deleted"]);
    // LIKE joker karakterleri düz metindir.
    expect(await logs("?q=%25")).toEqual([]);
  });
});

describe("lead işlemi ve günlük aynı transaction'da", () => {
  it("günlük satırı yazılamazsa işlem de geri alınır (lead sorumlusu değişmez)", async () => {
    await app.db.query(
      "ALTER TABLE user_action_logs ADD CONSTRAINT test_no_assign CHECK (action <> 'lead.assigned') NOT VALID",
    );
    try {
      const r = await call("admin", "POST", `/pipeline/leads/${leadId}/assign`, { toUserId: "someone" });
      expect(r.status).toBeGreaterThanOrEqual(500);
      const lead = await call<LeadDto>("admin", "GET", `/pipeline/leads/${leadId}`);
      expect((lead.body as unknown as { lead?: LeadDto }).lead?.assignedUserId ?? lead.body.assignedUserId).toBe(
        "rep-1",
      );
    } finally {
      await app.db.query("ALTER TABLE user_action_logs DROP CONSTRAINT test_no_assign");
    }
  });
});

describe("rota tablosu", () => {
  it("satış pipeline'ının her yazma ucunun bir işlem karşılığı var", () => {
    const stack = (app.router as unknown as { stack: { route?: { path: string; methods: Record<string, boolean> } }[] })
      .stack;
    const missing: string[] = [];
    for (const layer of stack) {
      if (!layer.route) continue;
      for (const m of Object.keys(layer.route.methods)) {
        const method = m.toUpperCase();
        if (!["POST", "PUT", "PATCH", "DELETE"].includes(method)) continue;
        const path = "/pipeline" + layer.route.path.replace(/:[^/]+/g, "x");
        if (!matchAuditRoute(method, path)) missing.push(`${method} ${layer.route.path}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("sabit yol değişkenli yoldan önce eşleşir; durum kodu → sonuç", () => {
    expect(matchAuditRoute("POST", "/pipeline/territories/apply-to-pool")?.route.action).toBe(
      "territory.applied_to_pool",
    );
    expect(matchAuditRoute("PUT", "/pipeline/territories/TR")?.params).toEqual({ cc: "TR" });
    expect(matchAuditRoute("POST", "/pipeline/activities/a1/done")?.route.action).toBe("activity.done");
    expect(AUDIT_ROUTES.every((r) => r.pattern.startsWith("/"))).toBe(true);
    expect([200, 204, 401, 403, 404, 409, 500].map(resultOf)).toEqual([
      "ok",
      "ok",
      "denied",
      "denied",
      "rejected",
      "rejected",
      "error",
    ]);
  });
});
