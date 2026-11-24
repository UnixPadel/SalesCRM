import { beforeEach, describe, expect, it } from "vitest";
import { unwrap } from "../../shared/kernel";
import { ActionLog, InMemoryActionLogStore } from "./actionLog";
import { testDeps, type TestHarness } from "./fakes";
import { createSalesPipeline, type SalesPipeline } from "./index";

/**
 * Lead silme (2026-11-24): satışçı lead ekler ama silemez; yönetici nedenle siler ("çöp kutusu") ve geri alır.
 * Silinen lead listeden, panodan, raporlardan ve lead sayfasından düşer; geri alınınca bütün geçmişiyle döner.
 */
const ADMIN = { userId: "admin", isAdmin: true };
const REP = { userId: "rep-1", isAdmin: false };

let h: TestHarness;
let sp: SalesPipeline;
let log: InMemoryActionLogStore;

const errCode = (r: { ok: boolean; error?: { code: string } }) => (r.ok ? "ok" : r.error?.code);
const newLead = async (actor = REP, email = "sil@example.com") =>
  unwrap(await sp.createLead.execute({ source: "manual", fullName: "Silme Testi", email, country: "TR", actor })).lead;
const listIds = async (actor: typeof REP) => (await sp.queries.list({ actor })).map((l) => l.id);
const reportCount = async (actor: typeof REP) =>
  (await sp.reports.summary({ actor })).leadsBySource.reduce((n, r) => n + r.count, 0);

beforeEach(() => {
  h = testDeps();
  log = new InMemoryActionLogStore();
  const actions = new ActionLog({ store: log, uow: h.uow, clock: h.clock, ids: h.ids, logger: h.logger });
  sp = createSalesPipeline({ ...h, actions });
});

describe("DeleteLead", () => {
  it("satışçı kendi eklediği lead'i de silemez: admin_only, lead yerinde kalır", async () => {
    const lead = await newLead();
    const r = await sp.deleteLead.execute({ leadId: lead.id, actor: REP, reason: "çift kayıt" });
    expect(errCode(r)).toBe("admin_only");
    expect(await listIds(REP)).toEqual([lead.id]);
    expect(unwrap(await sp.queries.get(lead.id, REP)).lead.id).toBe(lead.id);
  });

  it("satışçı silinenler listesini göremez ve geri alamaz", async () => {
    const lead = await newLead();
    unwrap(await sp.deleteLead.execute({ leadId: lead.id, actor: ADMIN, reason: "çift kayıt" }));
    expect(errCode(await sp.deletedLeads.list(REP))).toBe("admin_only");
    expect(errCode(await sp.restoreLead.execute({ leadId: lead.id, actor: REP }))).toBe("admin_only");
  });

  it("neden zorunlu", async () => {
    const lead = await newLead();
    expect(errCode(await sp.deleteLead.execute({ leadId: lead.id, actor: ADMIN, reason: "  " }))).toBe(
      "lead.delete_reason",
    );
    expect(errCode(await sp.deleteLead.execute({ leadId: lead.id, actor: ADMIN, reason: undefined }))).toBe(
      "lead.delete_reason",
    );
    expect(await listIds(ADMIN)).toEqual([lead.id]);
  });

  it("yönetici siler: listeden, panodan, raporlardan ve lead sayfasından düşer; silinenlerde görünür", async () => {
    const keep = await newLead(REP, "kalan@example.com");
    const lead = await newLead();
    expect(await reportCount(ADMIN)).toBe(2);

    const deleted = unwrap(await sp.deleteLead.execute({ leadId: lead.id, actor: ADMIN, reason: " çift kayıt " }));
    expect(deleted.deletion).toEqual({ at: h.clock.now(), by: "admin", reason: "çift kayıt" });

    expect(await listIds(ADMIN)).toEqual([keep.id]);
    expect(await listIds(REP)).toEqual([keep.id]);
    const board = await sp.queries.board({ actor: ADMIN });
    expect(JSON.stringify(board)).not.toContain(lead.id);
    expect(await reportCount(ADMIN)).toBe(1);
    expect(errCode(await sp.queries.get(lead.id, ADMIN))).toBe("not_found");
    // Silinmiş lead'e işlem yapılamaz.
    expect(errCode(await sp.changeLeadStage.execute({ leadId: lead.id, target: "CONTACTED", actor: ADMIN }))).toBe(
      "not_found",
    );

    const bin = unwrap(await sp.deletedLeads.list(ADMIN));
    expect(bin.map((l) => [l.id, l.deletion?.reason])).toEqual([[lead.id, "çift kayıt"]]);
    expect(errCode(await sp.deleteLead.execute({ leadId: lead.id, actor: ADMIN, reason: "yine" }))).toBe(
      "lead.deleted",
    );
  });

  it("geri alınan lead bütün geçmişiyle listeye döner", async () => {
    const lead = await newLead();
    unwrap(
      await sp.addActivity.execute({
        leadId: lead.id,
        type: "call",
        subject: "Ara",
        dueAt: new Date("2026-03-02T10:00:00Z"),
        actor: REP,
      }),
    );
    unwrap(await sp.deleteLead.execute({ leadId: lead.id, actor: ADMIN, reason: "yanlışlıkla" }));
    expect(errCode(await sp.restoreLead.execute({ leadId: "yok", actor: ADMIN }))).toBe("not_found");

    const back = unwrap(await sp.restoreLead.execute({ leadId: lead.id, actor: ADMIN }));
    expect(back.deletion).toBeNull();
    expect(await listIds(REP)).toEqual([lead.id]);
    const detail = unwrap(await sp.queries.get(lead.id, REP));
    expect(detail.activities.map((a) => a.subject)).toEqual(["Ara"]);
    expect(detail.events.length).toBeGreaterThan(0);
    expect(unwrap(await sp.deletedLeads.list(ADMIN))).toEqual([]);
    expect(errCode(await sp.restoreLead.execute({ leadId: lead.id, actor: ADMIN }))).toBe("lead.not_deleted");
  });

  it("tekrar gelen form yeni lead açmaz: silinmiş lead silinmiş kalır", async () => {
    const input = {
      source: "meta_form" as const,
      platformLeadId: "meta-123",
      fullName: "Form Kişisi",
      email: "form@example.com",
      country: "TR",
    };
    const first = unwrap(await sp.createLead.execute(input)).lead;
    unwrap(await sp.deleteLead.execute({ leadId: first.id, actor: ADMIN, reason: "test kaydı" }));
    const again = unwrap(await sp.createLead.execute(input));
    expect(again.created).toBe(false);
    expect(await listIds(ADMIN)).toEqual([]);
    expect(unwrap(await sp.deletedLeads.list(ADMIN)).map((l) => l.id)).toEqual([first.id]);
  });

  it("işlem günlüğüne silme (nedeniyle) ve geri alma yazılır", async () => {
    const lead = await newLead();
    unwrap(await sp.deleteLead.execute({ leadId: lead.id, actor: ADMIN, reason: "çift kayıt" }));
    unwrap(await sp.restoreLead.execute({ leadId: lead.id, actor: ADMIN }));
    const rows = log.rows.filter((r) => r.action.startsWith("lead.deleted") || r.action === "lead.restored");
    expect(rows.map((r) => [r.action, r.actorUserId, r.leadName, r.details])).toEqual([
      ["lead.deleted", "admin", "Silme Testi", { reason: "çift kayıt" }],
      ["lead.restored", "admin", "Silme Testi", {}],
    ]);
  });
});
