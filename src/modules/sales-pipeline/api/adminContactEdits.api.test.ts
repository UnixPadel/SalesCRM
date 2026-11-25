/** Yönetici temas silme ve aktivite düzenleme uçları: gerçek Express + PGlite (Postgres deposu dahil). */
import express from "express";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootSalesPipeline, type SalesPipelineApp } from "../../../bootstrap/salesPipeline";
import { silentLogger } from "../../shared/kernel";
import type { ActivityDto, ApiErrorDto, LeadDetailDto, LeadDto } from "./dto";
import type { DeleteContactLogResultDto, LogContactResultDto } from "./dto.contact";

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
  (await call<{ lead: LeadDto }>("rep1", "POST", "/leads", { fullName: "Yetki Deneme", email })).body.lead.id;
const detail = async (id: string) => (await call<LeadDetailDto>("admin", "GET", `/leads/${id}`)).body;

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

describe("temas kaydı silme", () => {
  it("satışçı ve görüntüleyici silemez; yönetici nedenle siler, takip de gider", async () => {
    const id = await newLead("t1@y.co");
    const logged = await call<LogContactResultDto>("rep1", "POST", `/leads/${id}/contacts`, {
      type: "call",
      outcome: "awaiting_reply",
      next: { type: "call", dueAt: new Date(Date.now() + 2 * 86_400_000).toISOString() },
    });
    expect(logged.status).toBe(201);
    const logId = logged.body.logId;

    const rep = await call<ApiErrorDto>("rep1", "DELETE", `/contact-logs/${logId}`, { reason: "yanlış" });
    expect(rep.status).toBe(403);
    expect(rep.body.code).toBe("admin_only");
    expect((await call("viewer", "DELETE", `/contact-logs/${logId}`, { reason: "yanlış" })).status).toBe(403);
    const noReason = await call<ApiErrorDto>("admin", "DELETE", `/contact-logs/${logId}`, {});
    expect(noReason.body.code).toBe("contact.delete_reason");
    const single = await call<ApiErrorDto>("admin", "DELETE", `/activities/${logged.body.activity.id}`);
    expect(single.body.code).toBe("contact.delete_logged");

    const del = await call<DeleteContactLogResultDto>("admin", "DELETE", `/contact-logs/${logId}`, {
      reason: "yanlış lead",
    });
    expect(del.status).toBe(200);
    expect(del.body).toEqual({ deleted: true, stageUndone: false, stageKept: false });
    const d = await detail(id);
    expect(d.activities).toHaveLength(0);
    expect(d.contactLogs).toHaveLength(0);
  });
});

describe("aktivite düzenleme", () => {
  it("açık işi satışçı düzenler; tamamlanmış temayı yalnız yönetici düzeltir (Postgres'e yazılır)", async () => {
    const id = await newLead("t2@y.co");
    const plan = await call<ActivityDto>("rep1", "POST", `/leads/${id}/activities`, {
      type: "call",
      subject: "Ara",
      dueAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    const due = new Date(Date.now() + 3 * 86_400_000);
    due.setSeconds(0, 0);
    const edited = await call<ActivityDto>("rep1", "PATCH", `/activities/${plan.body.id}`, {
      type: "meeting",
      subject: "Showroom",
      dueAt: due.toISOString(),
    });
    expect(edited.status).toBe(200);
    expect(edited.body).toMatchObject({ type: "meeting", subject: "Showroom", dueAt: due.toISOString() });
    expect((await call("viewer", "PATCH", `/activities/${plan.body.id}`, { subject: "x" })).status).toBe(403);

    const logged = await call<LogContactResultDto>("rep1", "POST", `/leads/${id}/contacts`, {
      type: "call",
      outcome: "negative",
      note: "Aradım",
    });
    const cid = logged.body.activity.id;
    const repEdit = await call<ApiErrorDto>("rep1", "PATCH", `/activities/${cid}`, { outcome: "agreed" });
    expect(repEdit.status).toBe(403);
    const at = new Date(Date.now() - 86_400_000);
    at.setSeconds(0, 0);
    const fixed = await call<ActivityDto>("admin", "PATCH", `/activities/${cid}`, {
      type: "whatsapp",
      outcome: "reply_received",
      resultNote: "WhatsApp'tan döndü",
      doneAt: at.toISOString(),
    });
    expect(fixed.status).toBe(200);
    const row = (await detail(id)).activities.find((a) => a.id === cid);
    expect(row).toMatchObject({
      type: "whatsapp",
      outcome: "reply_received",
      resultNote: "WhatsApp'tan döndü",
      doneAt: at.toISOString(),
      logId: logged.body.logId,
    });
    const bad = await call<ApiErrorDto>("admin", "PATCH", `/activities/${cid}`, { subject: "x" });
    expect(bad.body.code).toBe("activity.field_not_editable");
  });
});
