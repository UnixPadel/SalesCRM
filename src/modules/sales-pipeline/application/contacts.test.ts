import { beforeEach, describe, expect, it } from "vitest";
import { MINUTE, unwrap } from "../../shared/kernel";
import { testDeps, type TestHarness } from "./fakes";
import { createSalesPipeline, type SalesPipeline } from "./index";

/** Faz 7g S3: "Temas kaydet" komutları (iş emri §4.1, §7 S3). */
const ADMIN = { userId: "admin", isAdmin: true };
const REP = { userId: "rep-1", isAdmin: false };
const REP2 = { userId: "rep-2", isAdmin: false };

let h: TestHarness;
let sp: SalesPipeline;

const newLead = async (actor = REP, over: Record<string, unknown> = {}) =>
  unwrap(
    await sp.createLead.execute({
      source: "manual",
      fullName: "Temas Testi",
      email: "temas@example.com",
      country: "TR",
      actor,
      ...over,
    }),
  ).lead;

const errCode = (r: { ok: boolean; error?: { code: string } }) => (r.ok ? "ok" : r.error?.code);

beforeEach(() => {
  // 10:00Z = 13:00 İstanbul.
  h = testDeps();
  sp = createSalesPipeline(h);
});

describe("LogContact", () => {
  it("yeni kayıt: tamamlanmış satır + sonraki takip; aşama ve durum dokunulmaz", async () => {
    const lead = await newLead();
    const r = unwrap(
      await sp.logContact.execute({
        leadId: lead.id,
        actor: REP,
        type: "whatsapp",
        outcome: "awaiting_reply",
        note: "Katalog gönderildi",
        next: { type: "whatsapp", dueAt: new Date("2026-03-03T06:00:00Z") },
      }),
    );
    expect(r.activity).toMatchObject({
      type: "whatsapp",
      outcome: "awaiting_reply",
      resultNote: "Katalog gönderildi",
      doneByUserId: "rep-1",
      logId: r.logId,
      subject: "WhatsApp",
    });
    expect(r.activity.doneAt).toEqual(h.clock.now());
    expect(r.next).toMatchObject({ type: "whatsapp", doneAt: null, nextOfLogId: r.logId });
    expect(r.stage).toBeNull();
    expect(r.undoUntil.getTime() - h.clock.now().getTime()).toBe(10 * MINUTE);
    expect(h.uow.state.leads[0]?.currentStage).toBe("NEW");
    expect(h.uow.state.contactLogs).toHaveLength(1);
  });

  it("plan tamamlama: tür değişir, konu kalır; geri almada tür ve konu geri yazılır, plan yeniden açılır", async () => {
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
      }),
    );
    expect(r.activity).toMatchObject({ id: plan.id, type: "whatsapp", subject: "Fiyat görüşmesi" });
    expect(h.uow.state.activities.find((a) => a.id === plan.id)?.doneAt).not.toBeNull();
    unwrap(await sp.undoLogContact.execute({ logId: r.logId, actor: REP }));
    const back = h.uow.state.activities.find((a) => a.id === plan.id);
    expect(back).toMatchObject({ type: "call", subject: "Fiyat görüşmesi", doneAt: null, outcome: null, logId: null });
    expect(h.uow.state.contactLogs).toHaveLength(0);
  });

  it("quick: bugün vadeli aynı kanal planı tamamlanır, gelecek planı tamamlanmaz; takip önerisi eklenir", async () => {
    const lead = await newLead();
    const future = unwrap(
      await sp.addActivity.execute({
        leadId: lead.id,
        type: "whatsapp",
        dueAt: new Date("2026-03-05T07:00:00Z"),
        actor: REP,
      }),
    );
    const r1 = unwrap(
      await sp.logContact.execute({
        leadId: lead.id,
        actor: REP,
        type: "whatsapp",
        outcome: "awaiting_reply",
        quick: true,
      }),
    );
    expect(r1.activity.id).not.toBe(future.id);
    // 2 gün sonra 09:00 İstanbul = 06:00Z, aynı kanal.
    expect(r1.next).toMatchObject({ type: "whatsapp", subject: "WhatsApp takibi" });
    expect(r1.next?.dueAt.toISOString()).toBe("2026-03-03T06:00:00.000Z");

    const today = unwrap(
      await sp.addActivity.execute({
        leadId: lead.id,
        type: "whatsapp",
        dueAt: new Date("2026-03-01T15:00:00Z"),
        actor: REP,
      }),
    );
    const r2 = unwrap(
      await sp.logContact.execute({
        leadId: lead.id,
        actor: REP,
        type: "whatsapp",
        outcome: "awaiting_reply",
        quick: true,
      }),
    );
    // Bugün vadeli olanlardan önce aynı tür, sonra en erken vade: r1'in takibi (03-03) değil, bugünkü plan.
    expect(r2.activity.id).toBe(today.id);
  });

  it("havuz lead'i: satışçı kaydedince ona atanır ve LeadAssigned yayınlanır", async () => {
    const lead = await newLead(ADMIN, { assignedUserId: null });
    expect(lead.assignedUserId).toBeNull();
    h.events.published = [];
    const r = unwrap(
      await sp.logContact.execute({ leadId: lead.id, actor: REP, type: "call", outcome: "awaiting_reply" }),
    );
    expect(r.assignedTo).toBe("rep-1");
    expect(h.uow.state.contactLogs[0]?.assignedOnLog).toBe(true);
    expect(h.events.published.map((e) => e.type)).toEqual(["LeadAssigned"]);
  });

  it("doğrulama: ileri tarih, 2024 öncesi, başkasının lead'i, açık olmayan iş, geçmiş takip", async () => {
    const lead = await newLead();
    const base = { leadId: lead.id, actor: REP, type: "call", outcome: "awaiting_reply" } as const;
    expect(errCode(await sp.logContact.execute({ ...base, occurredAt: new Date("2026-03-01T10:30:00Z") }))).toBe(
      "contact.future",
    );
    expect(errCode(await sp.logContact.execute({ ...base, occurredAt: new Date("2023-12-31T12:00:00Z") }))).toBe(
      "contact.too_old",
    );
    expect(errCode(await sp.logContact.execute({ ...base, actor: REP2 }))).toBe("lead.forbidden");
    expect(errCode(await sp.logContact.execute({ ...base, activityId: "yok" }))).toBe("contact.activity_not_open");
    expect(
      errCode(
        await sp.logContact.execute({ ...base, next: { type: "call", dueAt: new Date("2026-02-27T09:00:00Z") } }),
      ),
    ).toBe("contact.next_past");
    expect(errCode(await sp.logContact.execute({ ...base, customerStatus: "olmayan" }))).toBe("lead.customer_status");
    expect(h.uow.state.contactLogs).toHaveLength(0);
    expect(h.uow.state.activities).toHaveLength(0);
  });

  it("Teklif gönderildi: aşama zorunlu (fixed), PROPOSAL'a geçer, tek takip ('Teklif takibi')", async () => {
    const lead = await newLead();
    const base = { leadId: lead.id, actor: REP, type: "email", outcome: "proposal_sent" } as const;
    expect(errCode(await sp.logContact.execute(base))).toBe("contact.proposal_stage_required");
    expect(
      errCode(
        await sp.logContact.execute({
          ...base,
          stage: { target: "PROPOSAL" },
          next: { type: "call", dueAt: new Date("2026-03-04T06:00:00Z") },
        }),
      ),
    ).toBe("contact.next_with_stage");
    const r = unwrap(await sp.logContact.execute({ ...base, stage: { target: "PROPOSAL" } }));
    expect(r.stage?.changeId).toBeTruthy();
    expect(h.uow.state.leads[0]?.currentStage).toBe("PROPOSAL");
    const open = h.uow.state.activities.filter((a) => a.doneAt === null);
    expect(open.map((a) => a.subject)).toEqual(["Teklif takibi"]);
  });

  it("izinsiz aşama hedefi reddedilir; aşama hatası olursa hiçbir şey yazılmaz", async () => {
    const lead = await newLead();
    expect(
      errCode(
        await sp.logContact.execute({
          leadId: lead.id,
          actor: REP,
          type: "call",
          outcome: "awaiting_reply",
          stage: { target: "WON", value: { amount: 1, currency: "EUR" } },
        }),
      ),
    ).toBe("contact.stage_not_allowed");
    // Anlaşma → WON izinli, ama tutar yok: ChangeLeadStage hatası olduğu gibi döner.
    expect(
      errCode(
        await sp.logContact.execute({
          leadId: lead.id,
          actor: REP,
          type: "meeting",
          outcome: "agreed",
          stage: { target: "WON" },
        }),
      ),
    ).toBe("stage.value_required");
    expect(h.uow.state.contactLogs).toHaveLength(0);
    expect(h.uow.state.leads[0]?.currentStage).toBe("NEW");
  });

  it("temas yazımı patlarsa aşama telafi edilir", async () => {
    const lead = await newLead();
    const original = h.uow.run.bind(h.uow);
    // Temas kaydı yazımı patlar; aşama değişikliği (kendi işlemi) ve telafisi contact_logs'a yazmaz.
    h.uow.run = (fn) =>
      original((repos) =>
        fn({
          ...repos,
          contactLogs: {
            ...repos.contactLogs,
            insert: async () => {
              throw new Error("disk dolu");
            },
          },
        }),
      );
    await expect(
      sp.logContact.execute({
        leadId: lead.id,
        actor: REP,
        type: "call",
        outcome: "reply_received",
        stage: { target: "CONTACTED" },
      }),
    ).rejects.toThrow("disk dolu");
    h.uow.run = original;
    expect(h.uow.state.leads[0]?.currentStage).toBe("NEW");
    expect(h.uow.state.contactLogs).toHaveLength(0);
  });

  it("Dönüş alındı + İlgili + İletişim kuruldu tek istekte; geri almada durum ve aşama döner", async () => {
    const lead = await newLead();
    const r = unwrap(
      await sp.logContact.execute({
        leadId: lead.id,
        actor: REP,
        type: "call",
        outcome: "reply_received",
        customerStatus: "interested",
        stage: { target: "CONTACTED" },
      }),
    );
    expect(h.uow.state.leads[0]).toMatchObject({ currentStage: "CONTACTED", customerStatus: "interested" });
    const u = unwrap(await sp.undoLogContact.execute({ logId: r.logId, actor: REP }));
    expect(u).toEqual({ undone: true, stageUndone: true });
    expect(h.uow.state.leads[0]).toMatchObject({ currentStage: "NEW", customerStatus: null });
    expect(h.uow.state.activities.filter((a) => a.doneAt !== null)).toHaveLength(0);
  });

  it("'İlgisiz' durumu Kaybedildi'ye izin verir", async () => {
    const lead = await newLead();
    const r = await sp.logContact.execute({
      leadId: lead.id,
      actor: REP,
      type: "call",
      outcome: "reply_received",
      customerStatus: "not_interested",
      stage: { target: "LOST", lostReasonCode: "competitor" },
    });
    expect(r.ok).toBe(true);
    expect(h.uow.state.leads[0]).toMatchObject({ currentStage: "LOST", customerStatus: "not_interested" });
  });
});

describe("UndoLogContact", () => {
  it("süre: satışçıya 10 dk sonra contact.undo_expired; başkası admin_only; admin serbest, aşama penceresi dışında", async () => {
    const lead = await newLead();
    const r = unwrap(
      await sp.logContact.execute({
        leadId: lead.id,
        actor: REP,
        type: "call",
        outcome: "reply_received",
        stage: { target: "CONTACTED" },
      }),
    );
    expect(errCode(await sp.undoLogContact.execute({ logId: r.logId, actor: REP2 }))).toBe("admin_only");
    h.clock.advance(11 * MINUTE);
    expect(errCode(await sp.undoLogContact.execute({ logId: r.logId, actor: REP }))).toBe("contact.undo_expired");
    expect(unwrap(await sp.undoLogContact.execute({ logId: r.logId, actor: ADMIN }))).toEqual({
      undone: true,
      stageUndone: false,
    });
    expect(h.uow.state.leads[0]?.currentStage).toBe("CONTACTED");
    expect(h.uow.state.activities.filter((a) => a.doneAt !== null)).toHaveLength(0);
    expect(errCode(await sp.undoLogContact.execute({ logId: r.logId, actor: ADMIN }))).toBe("not_found");
  });

  it("aşama sonradan değiştiyse undo.stale: aşama kalır, temas yine geri alınır", async () => {
    const lead = await newLead();
    const r = unwrap(
      await sp.logContact.execute({
        leadId: lead.id,
        actor: REP,
        type: "call",
        outcome: "reply_received",
        stage: { target: "CONTACTED" },
      }),
    );
    unwrap(
      await sp.changeLeadStage.execute({ leadId: lead.id, target: "LOST", actor: REP, lostReasonCode: "competitor" }),
    );
    expect(unwrap(await sp.undoLogContact.execute({ logId: r.logId, actor: REP })).stageUndone).toBe(false);
    expect(h.uow.state.leads[0]?.currentStage).toBe("LOST");
    expect(h.uow.state.contactLogs).toHaveLength(0);
  });

  it("önceki kaydın takibi sonra başka kayıtla tamamlandıysa ilk kaydı geri almak onu silmez", async () => {
    const lead = await newLead();
    const first = unwrap(
      await sp.logContact.execute({
        leadId: lead.id,
        actor: REP,
        type: "call",
        outcome: "awaiting_reply",
        next: { type: "call", dueAt: new Date("2026-03-01T12:00:00Z") },
      }),
    );
    const second = unwrap(
      await sp.logContact.execute({
        leadId: lead.id,
        actor: REP,
        activityId: first.next!.id,
        type: "call",
        outcome: "reply_received",
      }),
    );
    unwrap(await sp.undoLogContact.execute({ logId: first.logId, actor: REP }));
    const kept = h.uow.state.activities.find((a) => a.id === first.next!.id);
    expect(kept).toMatchObject({ logId: second.logId, nextOfLogId: null });
    expect(kept?.doneAt).not.toBeNull();
    expect(h.uow.state.activities).toHaveLength(1);
  });

  it("aşama geri alma (pano 'Geri al') temasla tamamlanmış teklif takibini korur", async () => {
    const lead = await newLead();
    const moved = unwrap(await sp.changeLeadStage.execute({ leadId: lead.id, target: "PROPOSAL", actor: REP }));
    unwrap(
      await sp.logContact.execute({
        leadId: lead.id,
        actor: REP,
        activityId: moved.followUp!.id,
        type: "call",
        outcome: "follow_up",
      }),
    );
    unwrap(await sp.undoStageChange.execute({ leadId: lead.id, actor: REP }));
    expect(h.uow.state.activities.find((a) => a.id === moved.followUp!.id)?.doneAt).not.toBeNull();
  });
});

describe("Aktivite kuralları, durum ve uyarılar", () => {
  it("log'lu satırı yeniden açma contact.reopen_logged; tamamlanmış silme yalnız admin", async () => {
    const lead = await newLead();
    const r = unwrap(await sp.logContact.execute({ leadId: lead.id, actor: REP, type: "call", outcome: "negative" }));
    expect(errCode(await sp.setActivityDone.execute({ activityId: r.activity.id, done: false, actor: ADMIN }))).toBe(
      "contact.reopen_logged",
    );
    expect(errCode(await sp.deleteActivity.execute({ activityId: r.activity.id, actor: REP }))).toBe("admin_only");
    expect((await sp.deleteActivity.execute({ activityId: r.activity.id, actor: ADMIN })).ok).toBe(true);
  });

  it("SetCustomerStatus: sahip, havuz + atama, diğer satışçı reddi, admin", async () => {
    const own = await newLead();
    expect(
      unwrap(await sp.setCustomerStatus.execute({ leadId: own.id, status: "interested", actor: REP })),
    ).toMatchObject({ customerStatus: "interested" });
    expect(errCode(await sp.setCustomerStatus.execute({ leadId: own.id, status: "buyer_ready", actor: REP2 }))).toBe(
      "lead.forbidden",
    );
    expect(errCode(await sp.setCustomerStatus.execute({ leadId: own.id, status: "x", actor: REP }))).toBe(
      "lead.customer_status",
    );
    const pool = await newLead(ADMIN, { assignedUserId: null, email: "havuz@example.com" });
    const set = unwrap(await sp.setCustomerStatus.execute({ leadId: pool.id, status: "project_phase", actor: REP2 }));
    expect(set).toMatchObject({ customerStatus: "project_phase", assignedUserId: "rep-2" });
    expect(
      unwrap(await sp.setCustomerStatus.execute({ leadId: own.id, status: null, actor: ADMIN })).customerStatus,
    ).toBeNull();
  });

  it("CheckWarning yalnız admin, bilinmeyen kod reddi, idempotent", async () => {
    const lead = await newLead();
    expect(
      errCode(await sp.checkWarning.execute({ leadId: lead.id, code: "phone_invalid", checked: true, actor: REP })),
    ).toBe("admin_only");
    expect(errCode(await sp.checkWarning.execute({ leadId: lead.id, code: "x", checked: true, actor: ADMIN }))).toBe(
      "warning.code",
    );
    unwrap(await sp.checkWarning.execute({ leadId: lead.id, code: "phone_invalid", checked: true, actor: ADMIN }));
    unwrap(await sp.checkWarning.execute({ leadId: lead.id, code: "phone_invalid", checked: true, actor: ADMIN }));
    expect(h.uow.state.leads[0]?.checkedWarnings).toEqual(["phone_invalid"]);
    unwrap(await sp.checkWarning.execute({ leadId: lead.id, code: "phone_invalid", checked: false, actor: ADMIN }));
    expect(h.uow.state.leads[0]?.checkedWarnings).toEqual([]);
  });

  it("ContactForm: varsayılan tür, tamamlanacak plan, (tür × sonuç) varsayılanları, havuzda atama bilgisi", async () => {
    const lead = await newLead(ADMIN, { assignedUserId: null });
    const plan = unwrap(
      await sp.addActivity.execute({
        leadId: lead.id,
        type: "email",
        dueAt: new Date("2026-03-01T08:00:00Z"),
        actor: ADMIN,
      }),
    );
    const f = unwrap(await sp.contactForm.get(lead.id, REP));
    expect(f.completableId).toBe(plan.id);
    expect(f.defaultType).toBe("email");
    expect(f.assignsOnSave).toBe(true);
    expect(f.channels).toEqual(["call", "whatsapp", "email", "meeting", "other"]);
    expect(f.defaults.call?.reply_received.stage).toEqual({ target: "CONTACTED", mode: "checked" });
    expect(f.defaults.email?.proposal_sent).toEqual({ stage: { target: "PROPOSAL", mode: "fixed" }, next: null });
    expect(f.defaults.whatsapp?.awaiting_reply.next?.type).toBe("whatsapp");
    expect(f.defaults.meeting?.negative.next).toBeNull();
  });
});
