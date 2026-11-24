/** İşlem günlüğü ucu (Yönetim > Loglar): gerçek Express + PGlite (migration 0021 ve Postgres deposu dahil). */
import express from "express";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootSalesPipeline, type SalesPipelineApp } from "../../../bootstrap/salesPipeline";
import { IMPORT_ACTOR } from "../../../bootstrap/importExcel";
import { silentLogger } from "../../shared/kernel";
import type { ApiErrorDto, LeadDto } from "./dto";
import type { ActionLogPageDto } from "./dto.actionLog";

let app: SalesPipelineApp;
let server: Server;
let base: string;
let leadId: string;

const SESSIONS: Record<string, { userId: string; role: string; seesLogs?: boolean }> = {
  rep1: { userId: "rep-1", role: "rep" },
  admin: { userId: "admin", role: "admin" },
  // Günlüğü görme izni kişi bazındadır: yönetici rolü yetmez, satışçı rolü engel değildir.
  boss: { userId: "boss", role: "admin", seesLogs: true },
  watcher: { userId: "rep-9", role: "rep", seesLogs: true },
};
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

async function call<T>(who: string | null, method: string, path: string, body?: unknown) {
  const init: RequestInit = {
    method,
    headers: { "content-type": "application/json", ...(who ? { "x-test-session": who } : {}) },
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await fetch(base + "/api/pipeline" + path, init);
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : undefined) as T };
}
const logs = (who: string, qs = "") => call<ActionLogPageDto>(who, "GET", `/action-logs${qs}`);

beforeAll(async () => {
  app = await bootSalesPipeline({ logger: silentLogger, memory: true });
  const ex = express();
  ex.use(express.json({ limit: "25mb" }));
  ex.use((req, _res, next) => {
    const key = req.header("x-test-session");
    (req as express.Request & { session?: unknown }).session = key ? SESSIONS[key] : undefined;
    next();
  });
  ex.use("/api/pipeline", app.router);
  await new Promise<void>((resolve) => {
    server = ex.listen(0, () => resolve());
  });
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;

  const lead = await call<{ lead: LeadDto }>("rep1", "POST", "/leads", { fullName: "Log Deneme", email: "log@y.co" });
  leadId = lead.body.lead.id;
  await call("rep1", "POST", `/leads/${leadId}/stage`, { target: "CONTACTED", contact: { type: "call" } });
  await call("rep1", "PATCH", `/leads/${leadId}`, { notes: "Fiyat istedi" });
  // Aynı değer yeniden gönderilirse (liste hücresi) günlüğe yazılmaz.
  await call("rep1", "PATCH", `/leads/${leadId}`, { notes: "Fiyat istedi" });
  await call("rep1", "POST", `/leads/${leadId}/attachments`, {
    fileName: "saha.png",
    contentBase64: PNG.toString("base64"),
  });
  await call("admin", "PATCH", `/leads/${leadId}`, { city: "İzmir", company: "Kort A.Ş." });
  await call("admin", "POST", `/leads/${leadId}/assign`, { toUserId: null });
  // İçe aktarma aktörü kişi değildir; günlüğe girmez.
  await app.pipeline.updateLeadFields.execute({ leadId, fields: { city: "Ankara" }, actor: IMPORT_ACTOR });
});
afterAll(async () => {
  server.close();
  await app.close();
});

describe("işlem günlüğü", () => {
  it("yalnız izinli kişi okur: oturumsuz 401, izinsiz yönetici ve satışçı 403", async () => {
    expect((await logs("" as unknown as string)).status).toBe(401);
    for (const who of ["admin", "rep1"]) {
      const r = await call<ApiErrorDto>(who, "GET", "/action-logs");
      expect([r.status, r.body.code]).toEqual([403, "logs.forbidden"]);
    }
    expect((await logs("boss")).status).toBe(200);
    expect((await logs("watcher")).status).toBe(200);
  });

  it("işlemler en yeni önce, ayrıntılarıyla listelenir", async () => {
    const { body } = await logs("boss");
    expect(body.items.map((e) => [e.actorUserId, e.action])).toEqual([
      ["admin", "lead.assigned"],
      ["admin", "lead.fields_updated"],
      ["rep-1", "attachment.added"],
      ["rep-1", "lead.fields_updated"],
      ["rep-1", "stage.changed"],
      ["rep-1", "lead.created"],
    ]);
    expect(body.items.every((e) => e.leadId === leadId && e.leadName === "Log Deneme")).toBe(true);
    const by = (action: string, actor: string) =>
      body.items.find((e) => e.action === action && e.actorUserId === actor)!.details;
    expect(by("stage.changed", "rep-1")).toEqual({ from: "NEW", to: "CONTACTED" });
    expect(by("lead.fields_updated", "rep-1")).toEqual({ fields: ["notes"] });
    expect(by("lead.fields_updated", "admin")).toEqual({ fields: ["company", "city"] });
    expect(by("attachment.added", "rep-1")).toEqual({ fileName: "saha.png", image: true });
    expect(by("lead.assigned", "admin")).toEqual({ from: "rep-1", to: null });
    expect(body.actors).toEqual(["admin", "rep-1"]);
    expect(body.next).toBeNull();
  });

  it("kullanıcı, işlem ve tarih süzgeci", async () => {
    const mine = await logs("boss", "?actor=rep-1");
    expect(mine.body.items).toHaveLength(4);
    expect(mine.body.items.every((e) => e.actorUserId === "rep-1")).toBe(true);
    const stage = await logs("boss", "?action=stage.changed,stage.undone");
    expect(stage.body.items.map((e) => e.action)).toEqual(["stage.changed"]);
    const future = await logs("boss", `?from=${encodeURIComponent(new Date(Date.now() + 86_400_000).toISOString())}`);
    expect(future.body.items).toEqual([]);
    const past = await logs("boss", `?to=${encodeURIComponent(new Date(Date.now() + 86_400_000).toISOString())}`);
    expect(past.body.items).toHaveLength(6);
  });

  it("sayfalama: `next` ile kalan kayıtlar gelir, tekrar yok", async () => {
    const first = await logs("boss", "?limit=4");
    expect(first.body.items).toHaveLength(4);
    expect(first.body.next).toBeTruthy();
    const second = await logs("boss", `?limit=4&before=${encodeURIComponent(first.body.next!)}`);
    expect(second.body.items).toHaveLength(2);
    expect(second.body.next).toBeNull();
    const ids = [...first.body.items, ...second.body.items].map((e) => e.id);
    expect(new Set(ids).size).toBe(6);
  });
});
