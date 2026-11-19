/** Dosya eki uçları: gerçek Express + PGlite (migration 0018 ve Postgres deposu dahil); oturum sahte middleware ile. */
import express from "express";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actorFromSession, bootSalesPipeline, type SalesPipelineApp } from "../../../bootstrap/salesPipeline";
import { silentLogger } from "../../shared/kernel";
import type { ApiErrorDto, LeadDto, ReferenceDto } from "./dto";
import type { AttachmentDto } from "./dto.attachment";

let app: SalesPipelineApp;
let server: Server;
let base: string;
let leadId: string;

const SESSIONS: Record<string, { userId: string; role: string }> = {
  rep1: { userId: "rep-1", role: "rep" },
  rep2: { userId: "rep-2", role: "rep" },
  admin: { userId: "admin", role: "admin" },
  viewer: { userId: "viewer", role: "viewer" },
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
  const lead = await call<{ lead: LeadDto }>("rep1", "POST", "/leads", { fullName: "Ek Deneme", email: "ek@y.co" });
  leadId = lead.body.lead.id;
});
afterAll(async () => {
  server.close();
  await app.close();
});

describe("dosya ekleri", () => {
  let id: string;

  it("actorFromSession sahte oturumu çevirir; /reference sınırları verir", async () => {
    expect(actorFromSession(SESSIONS["rep1"])).toMatchObject({ userId: "rep-1", isAdmin: false });
    const { body } = await call<ReferenceDto>("rep1", "GET", "/reference");
    expect(body.attachments.maxBytes).toBe(10 * 1024 * 1024);
    expect(body.attachments.extensions).toEqual(expect.arrayContaining(["pdf", "jpeg", "docx", "csv", "png", "jpg"]));
    expect(body.attachments.reasonMin).toBeGreaterThan(0);
  });

  it("POST ekler (201): yükleme tarihi ve yükleyen döner; görüntüleyici ve başkası ekleyemez", async () => {
    const path = `/leads/${leadId}/attachments`;
    const good = { fileName: "saha.png", contentBase64: PNG.toString("base64") };
    expect((await call(null, "POST", path, good)).status).toBe(401);
    expect((await call("viewer", "POST", path, good)).status).toBe(403);
    expect((await call("rep2", "POST", path, good)).status).toBe(403);
    const bad = await call<ApiErrorDto>("rep1", "POST", path, { ...good, fileName: "a.exe" });
    expect([bad.status, bad.body.code]).toEqual([422, "attachment.type"]);
    const ok = await call<AttachmentDto>("rep1", "POST", path, good);
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({
      leadId,
      fileName: "saha.png",
      mimeType: "image/png",
      isImage: true,
      sizeBytes: PNG.length,
      uploadedBy: "rep-1",
      stageCode: "NEW",
      deletedAt: null,
    });
    expect(Number.isNaN(Date.parse(ok.body.uploadedAt))).toBe(false);
    id = ok.body.id;
  });

  it("GET liste ve içerik: baytlar aynı, indirme başlıkları güvenli; görüntüleyici okur, başkası okuyamaz", async () => {
    const list = await call<AttachmentDto[]>("viewer", "GET", `/leads/${leadId}/attachments`);
    expect(list.body.map((a) => a.id)).toEqual([id]);
    expect((await call("rep2", "GET", `/leads/${leadId}/attachments`)).status).toBe(403);
    const res = await fetch(`${base}/api/pipeline/attachments/${id}/content`, {
      headers: { "x-test-session": "rep1" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-disposition")).toContain("attachment");
    expect(res.headers.get("content-disposition")).toContain("saha.png");
    expect(Buffer.from(await res.arrayBuffer()).equals(PNG)).toBe(true);
    const other = await fetch(`${base}/api/pipeline/attachments/${id}/content`, {
      headers: { "x-test-session": "rep2" },
    });
    expect(other.status).toBe(403);
  });

  it("DELETE neden ister; silinen ek nedeniyle listede kalır, içeriği 422", async () => {
    const path = `/attachments/${id}`;
    const none = await call<ApiErrorDto>("rep1", "DELETE", path, {});
    expect([none.status, none.body.code]).toEqual([422, "attachment.reason"]);
    expect((await call("viewer", "DELETE", path, { reason: "gereksiz" })).status).toBe(403);
    const ok = await call<AttachmentDto>("rep1", "DELETE", path, { reason: "Yanlış görsel" });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ deletedBy: "rep-1", deleteReason: "Yanlış görsel" });
    const list = await call<AttachmentDto[]>("rep1", "GET", `/leads/${leadId}/attachments`);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({ id, deleteReason: "Yanlış görsel" });
    expect(list.body[0]!.deletedAt).not.toBeNull();
    const gone = await call<ApiErrorDto>("rep1", "GET", `/attachments/${id}/content`);
    expect([gone.status, gone.body.code]).toEqual([422, "attachment.deleted"]);
    const again = await call<ApiErrorDto>("rep1", "DELETE", path, { reason: "tekrar" });
    expect(again.body.code).toBe("attachment.deleted");
  });
});
