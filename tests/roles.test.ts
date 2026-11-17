import type { NextFunction, Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import {
  adminAccess,
  canReadDirectory,
  canSeeReports,
  isReadOnlyRole,
  marketingUsers,
  reportsAccess,
  sessionRole,
} from "../server/roles.mjs";
import { actorFromSession } from "../src/bootstrap/salesPipeline";

const run = (mw: (req: Request, res: Response, next: NextFunction) => void, role: string, method = "GET") => {
  const out = { statusCode: 200, body: undefined as unknown };
  const res = {
    status: vi.fn((c: number) => ((out.statusCode = c), res)),
    json: vi.fn((b: unknown) => ((out.body = b), res)),
  } as unknown as Response;
  const next = vi.fn();
  mw({ method, session: { role } } as unknown as Request, res, next);
  return { passed: next.mock.calls.length === 1, status: out.statusCode, body: out.body as { code?: string } };
};

describe("pazarlama rolü (CRM_MARKETING_USERS)", () => {
  const list = marketingUsers({ CRM_MARKETING_USERS: " Eray , eray@marcadm.com,57 " });

  it("kullanıcı adı, e-posta ya da KullaniciID ile tanınır; büyük/küçük harf fark etmez", () => {
    expect(sessionRole("viewer", { id: 99, login: "ERAY", email: null }, list)).toBe("marketing");
    expect(sessionRole("viewer", { id: 99, login: "x", email: "Eray@MarcaDM.com" }, list)).toBe("marketing");
    expect(sessionRole("viewer", { id: 57, login: "x", email: "" }, list)).toBe("marketing");
    expect(sessionRole("viewer", { id: 1, login: "ayse", email: "ayse@unixpadel.com" }, list)).toBe("viewer");
  });

  it("liste yalnız yetki daraltır: tabloda yönetici olsa da pazarlama olur; boş liste kimseyi etkilemez", () => {
    expect(sessionRole("admin", { login: "eray" }, list)).toBe("marketing");
    expect(sessionRole("rep", { login: "eray" }, marketingUsers({}))).toBe("rep");
  });

  it("lead'leri görür ama değiştiremez; raporlar kapalı", () => {
    expect(actorFromSession({ userId: "57", role: "marketing" })).toEqual({
      userId: "57",
      isAdmin: true,
      readOnly: true,
    });
    expect(isReadOnlyRole("marketing")).toBe(true);
    expect(canSeeReports("marketing")).toBe(false);
    expect(canSeeReports("viewer")).toBe(true);
    expect(canReadDirectory("marketing")).toBe(true);
    expect(canReadDirectory("rep")).toBe(false);
  });

  it("/api/admin: pazarlama okur (GET) ama yazamaz; görüntüleyici ve satışçı hiç giremez; admin her şey", () => {
    expect(run(adminAccess, "marketing", "GET").passed).toBe(true);
    for (const m of ["POST", "PUT", "PATCH", "DELETE"]) {
      const r = run(adminAccess, "marketing", m);
      expect(r).toMatchObject({ passed: false, status: 403, body: { code: "read_only" } });
    }
    expect(run(adminAccess, "viewer", "GET")).toMatchObject({
      passed: false,
      status: 403,
      body: { code: "admin_only" },
    });
    expect(run(adminAccess, "rep", "GET").passed).toBe(false);
    expect(run(adminAccess, "admin", "PUT").passed).toBe(true);
  });

  it("/api/pipeline/reports: pazarlamaya 403, diğer rollere açık", () => {
    expect(run(reportsAccess, "marketing")).toMatchObject({
      passed: false,
      status: 403,
      body: { code: "reports_forbidden" },
    });
    for (const role of ["admin", "rep", "viewer"]) expect(run(reportsAccess, role).passed).toBe(true);
  });
});
