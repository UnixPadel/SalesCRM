/** Lead silme uçları: gerçek Express + PGlite (migration 0024 ve Postgres deposu dahil); oturum sahte middleware ile. */
import express from "express";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootSalesPipeline, type SalesPipelineApp } from "../../../bootstrap/salesPipeline";
import { silentLogger } from "../../shared/kernel";
import type { ApiErrorDto, LeadDto, LeadListDto } from "./dto";

let app: SalesPipelineApp;
let server: Server;
let base: string;

const SESSIONS: Record<string, { userId: string; role: string }> = {
  rep1: { userId: "rep-1", role: "rep" },
  admin: { userId: "admin", role: "admin" },
  viewer: { userId: "viewer", role: "viewer" },
};

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
const newLead = async (email: string) =>
  (await call<{ lead: LeadDto }>("rep1", "POST", "/leads", { fullName: "Silme Deneme", email })).body.lead.id;
const listIds = async (who: string) => (await call<LeadListDto[]>(who, "GET", "/leads")).body.map((l) => l.id);

beforeAll(async () => {
  app = await bootSalesPipeline({ logger: silentLogger, memory: true });
  const ex = express();
  ex.use(express.json());
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
});
afterAll(async () => {
  server.close();
  await app.close();
});

describe("lead silme", () => {
  it("satışçı ve görüntüleyici silemez (403); lead yerinde kalır", async () => {
    const id = await newLead("a@y.co");
    const rep = await call<ApiErrorDto>("rep1", "DELETE", `/leads/${id}`, { reason: "çift kayıt" });
    expect(rep.status).toBe(403);
    expect(rep.body.code).toBe("admin_only");
    const viewer = await call<ApiErrorDto>("viewer", "DELETE", `/leads/${id}`, { reason: "çift kayıt" });
    expect(viewer.status).toBe(403);
    expect(await listIds("rep1")).toContain(id);
    expect((await call("rep1", "GET", `/leads/${id}`)).status).toBe(200);
    expect((await call("rep1", "GET", "/deleted-leads")).status).toBe(403);
  });

  it("yönetici nedenle siler: liste ve lead sayfası düşer, silinenlerde görünür; geri alınca döner", async () => {
    const id = await newLead("b@y.co");
    expect((await call<ApiErrorDto>("admin", "DELETE", `/leads/${id}`, {})).body.code).toBe("lead.delete_reason");

    const del = await call<LeadDto>("admin", "DELETE", `/leads/${id}`, { reason: "test kaydı" });
    expect(del.status).toBe(200);
    expect(del.body.deletion).toMatchObject({ by: "admin", reason: "test kaydı" });

    expect(await listIds("admin")).not.toContain(id);
    expect(await listIds("rep1")).not.toContain(id);
    expect((await call("rep1", "GET", `/leads/${id}`)).status).toBe(404);
    expect((await call("admin", "GET", `/leads/${id}`)).status).toBe(404);
    const bin = await call<LeadDto[]>("admin", "GET", "/deleted-leads");
    expect(bin.body.map((l) => l.id)).toContain(id);

    expect((await call("rep1", "POST", `/leads/${id}/restore`)).status).toBe(403);
    const back = await call<LeadDto>("admin", "POST", `/leads/${id}/restore`);
    expect(back.status).toBe(200);
    expect(back.body.deletion).toBeNull();
    expect(await listIds("rep1")).toContain(id);
    expect((await call<LeadDto[]>("admin", "GET", "/deleted-leads")).body.map((l) => l.id)).not.toContain(id);
  });
});
