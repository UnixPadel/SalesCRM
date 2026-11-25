import { beforeEach, describe, expect, it } from "vitest";
import { MINUTE, unwrap } from "../../shared/kernel";
import { ActionLog, InMemoryActionLogStore } from "./actionLog";
import { testDeps, type TestHarness } from "./fakes";
import { createSalesPipeline, type SalesPipeline } from "./index";

/**
 * Yönetici yetkileri (2026-11-25): temas kaydını nedenle silme (süre sınırı yok), tamamlanmış temayı düzeltme ve
 * açık işi düzenleme. Satışçı açık işi düzenler; temas kaydına yalnız 10 dakikalık "Geri al" ile dokunur.
 */
const ADMIN = { userId: "admin", isAdmin: true };
const REP = { userId: "rep-1", isAdmin: false };
const REP2 = { userId: "rep-2", isAdmin: false };

let h: TestHarness;
let sp: SalesPipeline;
let log: InMemoryActionLogStore;

const errCode = (r: { ok: boolean; error?: { code: string } }) => (r.ok ? "ok" : r.error?.code);
const newLead = async (actor = REP) =>
  unwrap(
    await sp.createLead.execute({
      source: "manual",
      fullName: "Yetki Testi",
      email: "yetki@example.com",
      country: "TR",
      actor,
    }),
  ).lead;

beforeEach(() => {
  h = testDeps();
  log = new InMemoryActionLogStore();
  const actions = new ActionLog({ store: log, uow: h.uow, clock: h.clock, ids: h.ids, logger: h.logger });
  sp = createSalesPipeline({ ...h, actions });
});

describe("DeleteContactLog", () => {
  it("yalnız yönetici, neden zorunlu; süre geçse de kayıt, takip ve durum geri döner, aşama kalırsa söylenir", async () => {
    const lead = await newLead();
    const r = unwrap(
      await sp.logContact.execute({
        leadId: lead.id,
        actor: REP,
        type: "call",
        outcome: "reply_received",
        customerStatus: "interested",
        stage: { target: "CONTACTED" },
        next: { type: "call", dueAt: new Date("2026-03-04T06:00:00Z") },
      }),
    );
    expect(errCode(await sp.deleteContactLog.execute({ logId: r.logId, actor: REP, reason: "yanlış" }))).toBe(
      "admin_only",
    );
    expect(errCode(await sp.deleteContactLog.execute({ logId: r.logId, actor: ADMIN, reason: " x " }))).toBe(
      "contact.delete_reason",
    );

    h.clock.advance(3 * 60 * MINUTE);
    const out = unwrap(await sp.deleteContactLog.execute({ logId: r.logId, actor: ADMIN, reason: "yanlış lead" }));
    expect(out).toEqual({ deleted: true, stageUndone: false, stageKept: true });
    expect(h.uow.state.contactLogs).toHaveLength(0);
    expect(h.uow.state.activities).toHaveLength(0);
    expect(h.uow.state.leads[0]).toMatchObject({ customerStatus: null, currentStage: "CONTACTED" });
    expect(log.rows.at(-1)).toMatchObject({
      action: "contact.deleted",
      actorUserId: "admin",
      details: { reason: "yanlış lead", type: "call", outcome: "reply_received" },
    });
    expect(errCode(await sp.deleteContactLog.execute({ logId: r.logId, actor: ADMIN, reason: "tekrar" }))).toBe(
      "not_found",
    );
  });

  it("pencere içinde aşama da geri döner; tamamlanan plan eski haliyle yeniden açılır", async () => {
    const lead = await newLead();
    const plan = unwrap(
      await sp.addActivity.execute({
        leadId: lead.id,
        type: "call",
        subject: "Fiyat görüşmesi",
        dueAt: new Date("2026-03-01T07:00:00Z"),
        actor: REP,
      }),
    );
    const r = unwrap(
      await sp.logContact.execute({
        leadId: lead.id,
        actor: REP,
        activityId: plan.id,
        type: "whatsapp",
        outcome: "reply_received",
        stage: { target: "CONTACTED" },
      }),
    );
    const out = unwrap(await sp.deleteContactLog.execute({ logId: r.logId, actor: ADMIN, reason: "çift kayıt" }));
    expect(out).toEqual({ deleted: true, stageUndone: true, stageKept: false });
    expect(h.uow.state.leads[0]?.currentStage).toBe("NEW");
    expect(h.uow.state.activities).toHaveLength(1);
    expect(h.uow.state.activities[0]).toMatchObject({
      id: plan.id,
      doneAt: null,
      type: "call",
      subject: "Fiyat görüşmesi",
    });
  });
});

describe("UpdateActivity: tamamlanmış temas (yalnız yönetici)", () => {
  it("satışçı düzeltemez; yönetici kanal, sonuç, not ve tarihi düzeltir, aşama ve takip değişmez", async () => {
    const lead = await newLead();
    const r = unwrap(
      await sp.logContact.execute({
        leadId: lead.id,
        actor: REP,
        type: "call",
        outcome: "awaiting_reply",
        note: "Aradım",
        next: { type: "call", dueAt: new Date("2026-03-03T06:00:00Z") },
      }),
    );
    expect(errCode(await sp.updateActivity.execute({ activityId: r.activity.id, actor: REP, outcome: "agreed" }))).toBe(
      "admin_only",
    );

    const at = new Date("2026-02-27T09:30:00Z");
    const edited = unwrap(
      await sp.updateActivity.execute({
        activityId: r.activity.id,
        actor: ADMIN,
        type: "whatsapp",
        outcome: "reply_received",
        resultNote: "  WhatsApp'tan döndü ",
        doneAt: at,
      }),
    );
    expect(edited).toMatchObject({
      type: "whatsapp",
      outcome: "reply_received",
      resultNote: "WhatsApp'tan döndü",
      doneAt: at,
      logId: r.logId,
      doneByUserId: "rep-1",
    });
    expect(h.uow.state.activities.find((a) => a.id === r.activity.id)).toMatchObject({ type: "whatsapp", doneAt: at });
    expect(h.uow.state.activities.find((a) => a.id === r.next!.id)?.doneAt).toBeNull();
    expect(h.uow.state.leads[0]?.currentStage).toBe("NEW");
    expect(log.rows.at(-1)).toMatchObject({
      action: "contact.updated",
      details: { type: "whatsapp", outcome: "reply_received", fields: ["type", "outcome", "resultNote", "doneAt"] },
    });
  });

  it("temas kuralları geçerli; plan alanları reddedilir; değişiklik yoksa günlük yazılmaz", async () => {
    const lead = await newLead();
    const r = unwrap(await sp.logContact.execute({ leadId: lead.id, actor: REP, type: "call", outcome: "negative" }));
    const id = r.activity.id;
    expect(errCode(await sp.updateActivity.execute({ activityId: id, actor: ADMIN, customerReplied: true }))).toBe(
      "contact.replied_flag",
    );
    expect(
      errCode(
        await sp.updateActivity.execute({ activityId: id, actor: ADMIN, doneAt: new Date("2026-03-02T10:00:00Z") }),
      ),
    ).toBe("contact.future");
    expect(errCode(await sp.updateActivity.execute({ activityId: id, actor: ADMIN, outcome: "nope" }))).toBe(
      "contact.outcome",
    );
    expect(errCode(await sp.updateActivity.execute({ activityId: id, actor: ADMIN, subject: "x" }))).toBe(
      "activity.field_not_editable",
    );
    const before = log.rows.length;
    unwrap(await sp.updateActivity.execute({ activityId: id, actor: ADMIN, outcome: "negative" }));
    expect(log.rows.length).toBe(before);
  });

  it("tarih değişince tahmini işareti kalkar; değişmeyen eski tarih doğrulanmaz", async () => {
    const lead = await newLead();
    const r = unwrap(await sp.logContact.execute({ leadId: lead.id, actor: REP, type: "call", outcome: "negative" }));
    const row = h.uow.state.activities.find((a) => a.id === r.activity.id)!;
    row.doneAt = new Date("2023-05-01T09:00:00Z");
    row.dateEstimated = true;
    const now = () => h.uow.state.activities.find((a) => a.id === row.id);
    unwrap(await sp.updateActivity.execute({ activityId: row.id, actor: ADMIN, resultNote: "eski kayıt" }));
    expect(now()).toMatchObject({ resultNote: "eski kayıt", dateEstimated: true });
    unwrap(
      await sp.updateActivity.execute({ activityId: row.id, actor: ADMIN, doneAt: new Date("2025-05-01T09:00:00Z") }),
    );
    expect(now()).toMatchObject({ dateEstimated: false, doneAt: new Date("2025-05-01T09:00:00Z") });
  });
});

describe("UpdateActivity: açık iş", () => {
  it("sahibi ve yönetici düzenler, başka satışçı düzenleyemez; temas alanı reddedilir", async () => {
    const lead = await newLead();
    const a = unwrap(
      await sp.addActivity.execute({
        leadId: lead.id,
        type: "call",
        subject: "Ara",
        dueAt: new Date("2026-03-02T07:00:00Z"),
        actor: REP,
      }),
    );
    const due = new Date("2026-03-05T08:00:00Z");
    const edited = unwrap(
      await sp.updateActivity.execute({
        activityId: a.id,
        actor: REP,
        type: "meeting",
        subject: " Showroom ",
        dueAt: due,
        notes: "Katalog götür",
      }),
    );
    expect(edited).toMatchObject({ type: "meeting", subject: "Showroom", dueAt: due, notes: "Katalog götür" });
    expect(log.rows.at(-1)).toMatchObject({
      action: "activity.updated",
      details: { type: "meeting", fields: ["type", "subject", "dueAt", "notes"] },
    });
    expect(errCode(await sp.updateActivity.execute({ activityId: a.id, actor: REP2, subject: "Benim" }))).toBe(
      "lead.forbidden",
    );
    expect(errCode(await sp.updateActivity.execute({ activityId: a.id, actor: REP, outcome: "agreed" }))).toBe(
      "activity.field_not_editable",
    );
    expect(errCode(await sp.updateActivity.execute({ activityId: a.id, actor: REP, type: "fax" }))).toBe(
      "activity.type_unknown",
    );
    expect(errCode(await sp.updateActivity.execute({ activityId: a.id, actor: REP, dueAt: null }))).toBe(
      "activity.due_required",
    );
    unwrap(await sp.updateActivity.execute({ activityId: a.id, actor: ADMIN, subject: "Yönetici notu" }));
    expect(h.uow.state.activities[0]?.subject).toBe("Yönetici notu");
  });
});
