/** API testleri: gerçek Express + PGlite; oturum sahte middleware ile verilir. */
import express from "express";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actorFromSession, bootSalesPipeline, type SalesPipelineApp } from "../../../bootstrap/salesPipeline";
import { silentLogger } from "../../shared/kernel";
import type {
  ActivityDto,
  ApiErrorDto,
  BoardDto,
  LeadDetailDto,
  LeadDto,
  LeadListDto,
  NotificationsDto,
  ReferenceDto,
  ReportDto,
  TodayDto,
} from "./dto";

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

describe("bildirimler", () => {
  it("admin satışçıya lead atar → satışçıda okunmamış bildirim; yalnız sahibi okundu yapar; tümünü okundu", async () => {
    const created = await call<{ lead: LeadDto }>("admin", "POST", "/api/pipeline/leads", {
      fullName: "Bildirim Test",
      email: "bildirim@example.com",
      country: "TR",
      assignedUserId: "rep-2",
    });
    expect(created.status).toBe(201);
    const mine = await call<NotificationsDto>("rep2", "GET", "/api/pipeline/notifications");
    expect(mine.status).toBe(200);
    expect(mine.body.unreadCount).toBeGreaterThanOrEqual(1);
    const n = mine.body.items.find((x) => x.leadId === created.body.lead.id)!;
    expect(n).toMatchObject({
      type: "lead_assigned",
      readAt: null,
      body: { leadName: "Bildirim Test", country: "TR" },
    });
    expect((await call("rep1", "GET", "/api/pipeline/notifications")).body).toMatchObject({ unreadCount: 0 });
    expect((await call("rep1", "POST", `/api/pipeline/notifications/${n.id}/read`)).status).toBe(404);
    expect((await call("rep2", "POST", `/api/pipeline/notifications/${n.id}/read`)).status).toBe(200);
    const after = await call<NotificationsDto>("rep2", "GET", "/api/pipeline/notifications");
    expect(after.body.items.find((x) => x.id === n.id)?.readAt).not.toBeNull();
    expect((await call<{ marked: number }>("rep2", "POST", "/api/pipeline/notifications/read-all")).body.marked).toBe(
      after.body.unreadCount,
    );
    expect((await call(null, "GET", "/api/pipeline/notifications")).status).toBe(401);
  });
});

describe("aktiviteler (Faz 6a)", () => {
  let leadId: string;
  let activityId: string;

  it("yeni lead takipsiz; aktivite eklenince değil; görüntüleyici ve başkası ekleyemez; tür/tarih doğrulanır", async () => {
    const created = await call<{ lead: LeadDto }>("rep1", "POST", "/api/pipeline/leads", {
      fullName: "Aktivite Testi",
      email: "aktivite@example.com",
      country: "tr",
    });
    leadId = created.body.lead.id;
    const before = (await call<LeadListDto[]>("rep1", "GET", "/api/pipeline/leads")).body.find((l) => l.id === leadId);
    expect(before).toMatchObject({ openActivities: 0, nextActivity: null, rotting: true });

    expect((await call("viewer", "POST", `/api/pipeline/leads/${leadId}/activities`, { type: "call" })).status).toBe(
      403,
    );
    expect(
      (await call("rep2", "POST", `/api/pipeline/leads/${leadId}/activities`, { type: "call", dueAt: "2030-01-01" }))
        .status,
    ).toBe(403);
    const badType = await call<ApiErrorDto>("rep1", "POST", `/api/pipeline/leads/${leadId}/activities`, {
      type: "fax",
      dueAt: "2030-01-01T09:00:00Z",
    });
    expect(badType.status).toBe(422);
    expect(badType.body.code).toBe("activity.type_unknown");
    const noDate = await call<ApiErrorDto>("rep1", "POST", `/api/pipeline/leads/${leadId}/activities`, {
      type: "call",
      dueAt: "dün",
    });
    expect(noDate.body.code).toBe("activity.due_required");

    const ok = await call<ActivityDto>("rep1", "POST", `/api/pipeline/leads/${leadId}/activities`, {
      type: "meeting",
      subject: "Keşif toplantısı",
      dueAt: "2030-01-01T09:00:00Z",
      notes: "Saha ölçüsü",
    });
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({
      leadId,
      type: "meeting",
      subject: "Keşif toplantısı",
      dueAt: "2030-01-01T09:00:00.000Z",
      doneAt: null,
      autoCreated: false,
      createdByUserId: "rep-1",
    });
    activityId = ok.body.id;
    const after = (await call<LeadListDto[]>("rep1", "GET", "/api/pipeline/leads")).body.find((l) => l.id === leadId);
    expect(after).toMatchObject({ openActivities: 1, rotting: false });
    expect(after?.nextActivity?.id).toBe(activityId);
  });

  it("Teklif gönderildi takip aktivitesi açar; detayda aktiviteler; Bugün listesinde yaklaşan", async () => {
    const moved = await call<{ followUp: ActivityDto | null }>("rep1", "POST", `/api/pipeline/leads/${leadId}/stage`, {
      target: "PROPOSAL",
    });
    expect(moved.status).toBe(200);
    expect(moved.body.followUp).toMatchObject({ type: "call", subject: "Teklif takibi", autoCreated: true });
    const detail = await call<LeadDetailDto>("rep1", "GET", `/api/pipeline/leads/${leadId}`);
    expect(detail.body.activities).toHaveLength(2);
    expect(detail.body.lead.openActivities).toBe(2);

    const today = await call<TodayDto>("rep1", "GET", "/api/pipeline/activities/today");
    expect(today.status).toBe(200);
    const ids = today.body.upcoming.map((x) => x.activity.id);
    expect(ids).toContain(activityId);
    expect(ids).toContain(moved.body.followUp!.id);
    expect(today.body.upcoming.find((x) => x.activity.id === activityId)?.lead).toMatchObject({
      id: leadId,
      fullName: "Aktivite Testi",
      currentStage: "PROPOSAL",
    });
    expect((await call<TodayDto>("rep2", "GET", "/api/pipeline/activities/today")).body.upcoming).toEqual([]);
  });

  it("tamamla, yeniden aç, sil; bilinmeyen 404", async () => {
    const done = await call<ActivityDto>("rep1", "POST", `/api/pipeline/activities/${activityId}/done`, { done: true });
    expect(done.status).toBe(200);
    expect(typeof done.body.doneAt).toBe("string");
    const reopen = await call<ActivityDto>("rep1", "POST", `/api/pipeline/activities/${activityId}/done`, {
      done: false,
    });
    expect(reopen.body.doneAt).toBeNull();
    expect((await call("rep2", "DELETE", `/api/pipeline/activities/${activityId}`)).status).toBe(403);
    expect((await call("rep1", "DELETE", `/api/pipeline/activities/${activityId}`)).status).toBe(204);
    expect((await call("rep1", "DELETE", `/api/pipeline/activities/${activityId}`)).status).toBe(404);
  });
});

describe("fırsat alanları ve pano (Faz 6b)", () => {
  let leadId: string;

  it("PATCH /leads/:id: alanlar güncellenir; görüntüleyici 403, başkası 403, geçersiz 422; detay ve liste yeni alanları taşır", async () => {
    const created = await call<{ lead: LeadDto }>("rep1", "POST", "/api/pipeline/leads", {
      fullName: "Fırsat Testi",
      email: "firsat@example.com",
      country: "tr",
      courtCount: "3",
      courtModel: "Panoramic",
    });
    expect(created.status).toBe(201);
    expect(created.body.lead).toMatchObject({ courtCount: 3, courtModel: "Panoramic", expectedCloseDate: null });
    leadId = created.body.lead.id;

    const ok = await call<LeadDto>("rep1", "PATCH", `/api/pipeline/leads/${leadId}`, {
      courtCount: 4,
      expectedCloseDate: "2026-12-15",
      notes: "fuar",
    });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({
      courtCount: 4,
      courtModel: "Panoramic",
      expectedCloseDate: "2026-12-15",
      notes: "fuar",
    });

    expect((await call("viewer", "PATCH", `/api/pipeline/leads/${leadId}`, { city: "X" })).status).toBe(403);
    expect((await call("rep2", "PATCH", `/api/pipeline/leads/${leadId}`, { city: "X" })).status).toBe(403);
    const bad = await call<ApiErrorDto>("rep1", "PATCH", `/api/pipeline/leads/${leadId}`, {
      expectedCloseDate: "yarın",
    });
    expect(bad.status).toBe(422);
    expect(bad.body.code).toBe("lead.expected_close_invalid");
    expect(
      (await call("rep1", "PATCH", "/api/pipeline/leads/00000000-0000-4000-8000-000000000000", { city: "X" })).status,
    ).toBe(404);

    const detail = await call<LeadDetailDto>("rep1", "GET", `/api/pipeline/leads/${leadId}`);
    expect(detail.body.lead).toMatchObject({ courtCount: 4, expectedCloseDate: "2026-12-15", value: null });
    expect(typeof detail.body.lead.stageEnteredAt).toBe("string");
  });

  it("GET /board: filtreler ve kolon istatistikleri; reference kurları verir", async () => {
    const ref = await call<ReferenceDto>("rep1", "GET", "/api/pipeline/reference");
    expect(ref.body.eurRates).toMatchObject({ EUR: 1, USD: 0.92 });

    await call("rep1", "POST", `/api/pipeline/leads/${leadId}/stage`, { target: "CONTACTED" });
    await call("rep1", "POST", `/api/pipeline/leads/${leadId}/stage`, {
      target: "PROPOSAL",
      qualificationAnswers: { budget_approved: true, site_known: true, install_within_12m: true },
      value: { amount: 50_000, currency: "EUR" },
    });
    const board = await call<BoardDto>("rep1", "GET", "/api/pipeline/board?owner=me&country=tr");
    expect(board.status).toBe(200);
    const me = board.body.leads.find((l) => l.id === leadId);
    expect(me).toMatchObject({ currentStage: "PROPOSAL", value: { amount: 50_000, currency: "EUR" }, rotting: false });
    expect(board.body.columns.map((c) => c.stage)).toEqual([
      "NEW",
      "CONTACTED",
      "QUALIFIED",
      "PROPOSAL",
      "WON",
      "LOST",
    ]);
    const proposal = board.body.columns.find((c) => c.stage === "PROPOSAL")!;
    expect(proposal.count).toBeGreaterThanOrEqual(1);
    expect(proposal.totalEur).toBeGreaterThanOrEqual(50_000);

    const pool = await call<BoardDto>("admin", "GET", "/api/pipeline/board?owner=pool");
    expect(pool.body.leads.every((l) => l.assignedUserId === null)).toBe(true);
    const rotting = await call<BoardDto>("admin", "GET", "/api/pipeline/board?rotting=1");
    expect(rotting.body.leads.every((l) => l.rotting)).toBe(true);
    expect(rotting.body.leads.some((l) => l.id === leadId)).toBe(false);
    // Geçersiz ülke parametresi yok sayılır; görüntüleyici okuyabilir.
    expect((await call<BoardDto>("viewer", "GET", "/api/pipeline/board?country=xyz")).status).toBe(200);
    expect((await call("rep1", "GET", "/api/pipeline/board")).status).toBe(200);
    expect((await call(null, "GET", "/api/pipeline/board")).status).toBe(401);
  });
});

describe("raporlar (Faz 6c)", () => {
  it("GET /reports: ay parametresi, boş/dolu veride şekil sabit; görüntüleyici okur; oturumsuz 401", async () => {
    const r = await call<ReportDto>("admin", "GET", "/api/pipeline/reports?months=6");
    expect(r.status).toBe(200);
    expect(r.body.months).toHaveLength(6);
    expect(r.body.wonByMonth).toHaveLength(6);
    expect(r.body.conversionByStage.map((c) => c.stage)).toEqual(["NEW", "CONTACTED", "QUALIFIED", "PROPOSAL"]);
    expect(typeof r.body.kpis.openCount).toBe("number");
    expect(Array.isArray(r.body.openByCountry)).toBe(true);
    expect(Array.isArray(r.body.lostReasons)).toBe(true);
    expect(Array.isArray(r.body.leadsBySource)).toBe(true);
    // Önceki testlerde en az bir lead Teklif'e taşındı: kaynağa göre satır var, açık hat sayısı ≥ 1.
    expect(r.body.leadsBySource.length).toBeGreaterThan(0);
    expect(r.body.kpis.openCount).toBeGreaterThan(0);
    expect((await call<ReportDto>("viewer", "GET", "/api/pipeline/reports")).body.months).toHaveLength(12);
    expect((await call<ReportDto>("rep1", "GET", "/api/pipeline/reports?months=abc")).body.months).toHaveLength(12);
    expect((await call(null, "GET", "/api/pipeline/reports")).status).toBe(401);
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
