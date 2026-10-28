/** API testleri: gerçek Express + PGlite; oturum sahte middleware ile verilir. */
import express from "express";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actorFromSession, bootSalesPipeline, type SalesPipelineApp } from "../../../bootstrap/salesPipeline";
import { silentLogger } from "../../shared/kernel";
import type { ApiErrorDto, LeadDetailDto, LeadDto, ReferenceDto } from "./dto";

let app: SalesPipelineApp;
let server: Server;
let base: string;

const SESSIONS: Record<string, { userId: string; role: string }> = {
  rep1: { userId: "rep-1", role: "rep" },
  rep2: { userId: "rep-2", role: "rep" },
  admin: { userId: "admin", role: "admin" },
  viewer: { userId: "viewer", role: "viewer" },
};

async function call<T>(
  who: string | null,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: T }> {
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

describe("GET /reference", () => {
  it("oturumsuz 401; aşamalar, nedenler, sorular, para birimleri", async () => {
    expect((await call(null, "GET", "/api/pipeline/reference")).status).toBe(401);
    const { status, body } = await call<ReferenceDto>("rep1", "GET", "/api/pipeline/reference");
    expect(status).toBe(200);
    expect(body.stages.map((s) => s.code)).toEqual(["NEW", "CONTACTED", "QUALIFIED", "PROPOSAL", "WON", "LOST"]);
    expect(body.lostReasons.length).toBeGreaterThan(5);
    expect(body.qualificationQuestions).toEqual(["budget_approved", "site_known", "install_within_12m"]);
    expect(body.currencies).toContain("EUR");
    expect(body.undoWindowMinutes).toBe(10);
  });
});

describe("lead akışı: oluştur → aşama → geri al → kazan", () => {
  let id: string;

  it("POST /leads doğrular ve oluşturur (201); görüntüleyici yazamaz (403)", async () => {
    const bad = await call<ApiErrorDto>("rep1", "POST", "/api/pipeline/leads", { fullName: "" });
    expect(bad.status).toBe(422);
    expect(bad.body.code).toBe("lead.name_required");
    expect((await call("viewer", "POST", "/api/pipeline/leads", { fullName: "X", email: "x@y.co" })).status).toBe(403);
    const ok = await call<{ lead: LeadDto; created: boolean }>("rep1", "POST", "/api/pipeline/leads", {
      fullName: "Mehmet Kaya",
      email: "Mehmet@Example.com",
      phone: "0533 111 22 33",
      country: "tr",
      company: "Kaya Spor",
      productInterest: "Panoramik",
    });
    expect(ok.status).toBe(201);
    expect(ok.body.created).toBe(true);
    expect(ok.body.lead).toMatchObject({
      email: "mehmet@example.com",
      phoneE164: "+905331112233",
      country: "TR",
      assignedUserId: "rep-1",
      currentStage: "NEW",
    });
    expect(typeof ok.body.lead.createdAt).toBe("string");
    id = ok.body.lead.id;
  });

  it("GET /leads listeler; başkası göremez; admin görür", async () => {
    const mine = await call<LeadDto[]>("rep1", "GET", "/api/pipeline/leads");
    expect(mine.body.map((l) => l.id)).toContain(id);
    const theirs = await call<LeadDto[]>("rep2", "GET", "/api/pipeline/leads");
    expect(theirs.body.map((l) => l.id)).not.toContain(id);
    expect((await call<LeadDto[]>("admin", "GET", "/api/pipeline/leads?q=kaya")).body.map((l) => l.id)).toEqual([id]);
    expect((await call<ApiErrorDto>("rep2", "GET", `/api/pipeline/leads/${id}`)).status).toBe(404);
    expect((await call("viewer", "GET", `/api/pipeline/leads/${id}`)).status).toBe(200);
  });

  it("POST /stage: geçersiz kod 422, tutar eksik 422, başkası 403, ileri geçiş 200", async () => {
    expect(
      (await call<ApiErrorDto>("rep1", "POST", `/api/pipeline/leads/${id}/stage`, { target: "won" })).body.code,
    ).toBe("stage.unknown");
    const noValue = await call<ApiErrorDto>("rep1", "POST", `/api/pipeline/leads/${id}/stage`, { target: "WON" });
    expect(noValue.status).toBe(422);
    expect(noValue.body.code).toBe("stage.value_required");
    expect((await call("rep2", "POST", `/api/pipeline/leads/${id}/stage`, { target: "CONTACTED" })).status).toBe(403);
    const ok = await call<{ lead: LeadDto; events: unknown[] }>("rep1", "POST", `/api/pipeline/leads/${id}/stage`, {
      target: "PROPOSAL",
    });
    expect(ok.status).toBe(200);
    expect(ok.body.lead.currentStage).toBe("PROPOSAL");
    expect(ok.body.events).toHaveLength(3);
  });

  it("GET /leads/:id detay: olaylar, izinli geçişler, geri al açık", async () => {
    const d = await call<LeadDetailDto>("rep1", "GET", `/api/pipeline/leads/${id}`);
    expect(d.status).toBe(200);
    expect(d.body.events.map((e) => e.stageCode)).toEqual(["NEW", "CONTACTED", "QUALIFIED", "PROPOSAL"]);
    expect(d.body.allowedTransitions).toEqual(["WON", "LOST"]);
    expect(d.body.undo.available).toBe(true);
  });

  it("POST /undo geri alır; ikinci geri al 422", async () => {
    const u = await call<{ revertedTo: string }>("rep1", "POST", `/api/pipeline/leads/${id}/undo`);
    expect(u.status).toBe(200);
    expect(u.body.revertedTo).toBe("NEW");
    expect((await call<ApiErrorDto>("rep1", "POST", `/api/pipeline/leads/${id}/undo`)).body.code).toBe("undo.nothing");
  });

  it("WON tutarla, sonra terminal: izinli geçiş yok, LOST 422", async () => {
    const won = await call<{ lead: LeadDto }>("rep1", "POST", `/api/pipeline/leads/${id}/stage`, {
      target: "WON",
      value: { amount: 95000, currency: "EUR" },
    });
    expect(won.status).toBe(200);
    expect(won.body.lead.currentStage).toBe("WON");
    const d = await call<LeadDetailDto>("rep1", "GET", `/api/pipeline/leads/${id}`);
    expect(d.body.allowedTransitions).toEqual([]);
    expect(d.body.events.at(-1)?.value).toEqual({ amount: 95000, currency: "EUR" });
    expect(
      (
        await call<ApiErrorDto>("rep1", "POST", `/api/pipeline/leads/${id}/stage`, {
          target: "LOST",
          lostReasonCode: "competitor",
        })
      ).body.code,
    ).toBe("stage.terminal");
  });

  it("POST /assign: satışçı havuzdan üstlenir, admin devreder; bilinmeyen lead 404", async () => {
    const pool = await call<{ lead: LeadDto }>("admin", "POST", "/api/pipeline/leads", {
      fullName: "Havuz",
      email: "havuz@x.co",
      assignedUserId: null,
    });
    expect(pool.body.lead.assignedUserId).toBeNull();
    const taken = await call<LeadDto>("rep2", "POST", `/api/pipeline/leads/${pool.body.lead.id}/assign`, {
      toUserId: "rep-2",
    });
    expect(taken.status).toBe(200);
    expect(taken.body.assignedUserId).toBe("rep-2");
    expect(
      (
        await call<ApiErrorDto>("rep2", "POST", `/api/pipeline/leads/${pool.body.lead.id}/assign`, {
          toUserId: "rep-1",
        })
      ).status,
    ).toBe(403);
    expect(
      (await call<LeadDto>("admin", "POST", `/api/pipeline/leads/${pool.body.lead.id}/assign`, { toUserId: "rep-1" }))
        .body.assignedUserId,
    ).toBe("rep-1");
    expect(
      (
        await call("admin", "POST", "/api/pipeline/leads/00000000-0000-4000-8000-000000000000/assign", {
          toUserId: null,
        })
      ).status,
    ).toBe(404);
  });
});

describe("actorFromSession", () => {
  it("userId yoksa e-posta; rol eşlemesi", () => {
    expect(actorFromSession(undefined)).toBeUndefined();
    expect(actorFromSession({ role: "rep" })).toBeUndefined();
    expect(actorFromSession({ email: "a@b.co", role: "admin" })).toEqual({
      userId: "a@b.co",
      isAdmin: true,
      readOnly: false,
    });
    expect(actorFromSession({ userId: "7", email: "a@b.co", role: "viewer" })).toEqual({
      userId: "7",
      isAdmin: true,
      readOnly: true,
    });
  });
});
