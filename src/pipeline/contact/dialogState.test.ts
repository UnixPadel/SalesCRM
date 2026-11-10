import { describe, expect, it } from "vitest";
import type { ContactDefaultsDto, ContactFormDto } from "../../modules/sales-pipeline/api/dto.contact";
import {
  buildBody,
  effectiveTarget,
  initialState,
  nextBlocked,
  retarget,
  saveBlockers,
  setReplied,
  showsStatus,
  stageLineView,
  type ContactRules,
} from "./dialogState";

const RULES: ContactRules = {
  defaultOutcome: {
    call: "awaiting_reply",
    email: "awaiting_reply",
    whatsapp: "awaiting_reply",
    other: "awaiting_reply",
    meeting: "reply_received",
    site_visit: "reply_received",
    proposal_sent: "proposal_sent",
  },
  repliedFlagOutcomes: ["follow_up", "proposal_sent"],
  repliedDefaultTypes: ["call", "meeting", "site_visit"],
  statusOutcomes: ["reply_received", "negative", "agreed", "proposal_sent"],
  statusSuggestsLost: ["not_interested"],
  noNextTargets: ["PROPOSAL", "WON", "LOST"],
  noteMax: 4000,
  minContactDate: "2024-01-01",
  futureToleranceMinutes: 5,
};

const next = { type: "call" as const, dueAt: "2026-11-13T06:00:00.000Z", subject: "Takip araması" };
const row = (stage: ContactDefaultsDto["stage"], withNext = true) => ({
  next: withNext ? next : null,
  stage,
});
const outcomes = (type: "call" | "whatsapp") => ({
  awaiting_reply: row({ target: "CONTACTED", mode: "unchecked" }),
  reply_received: row({ target: "CONTACTED", mode: "checked" }),
  follow_up: row({ target: "CONTACTED", mode: "checked_if_replied" }),
  proposal_sent: row({ target: "PROPOSAL", mode: "fixed" }, false),
  negative: row({ target: "LOST", mode: "unchecked" }, false),
  agreed: row({ target: "WON", mode: "unchecked" }, false),
  ...(type ? {} : {}),
});

const FORM: ContactFormDto = {
  lead: {
    id: "l1",
    fullName: "Test",
    currentStage: "NEW",
    assignedUserId: null,
    customerStatus: null,
    createdAt: "2026-11-01T09:00:00Z",
  },
  openActivities: [{ id: "a1", type: "whatsapp", subject: "WhatsApp takibi", dueAt: "2026-11-10T06:00:00Z" }],
  completableId: "a1",
  channels: ["call", "whatsapp", "email", "meeting", "other"],
  defaultType: "whatsapp",
  defaults: { call: outcomes("call"), whatsapp: outcomes("whatsapp") },
  canSetStatus: true,
  assignsOnSave: true,
  now: "2026-11-10T10:00:00Z",
  timeZone: "Europe/Istanbul",
};

describe("dialogState", () => {
  it("başlangıç: tamamlanacak plan ve kanalı; kanalın varsayılan sonucu; takip açık", () => {
    const s = initialState(FORM, RULES);
    expect(s).toMatchObject({ activityId: "a1", type: "whatsapp", outcome: "awaiting_reply", planNext: true });
    expect(effectiveTarget(s, FORM, RULES)).toBeNull();
  });

  it("aşama satırı modları: checked önseçili, unchecked değil, checked_if_replied cevapla birlikte", () => {
    const base = initialState(FORM, RULES, { type: "call" });
    const replied = retarget({ ...base, outcome: "reply_received" }, FORM, RULES);
    expect(effectiveTarget(replied, FORM, RULES)).toBe("CONTACTED");
    const follow = retarget({ ...base, outcome: "follow_up" }, FORM, RULES);
    // Telefonda "Müşteri cevap verdi" işaretli gelir → aşama satırı da işaretli.
    expect(follow.replied).toBe(true);
    expect(effectiveTarget(follow, FORM, RULES)).toBe("CONTACTED");
    expect(effectiveTarget(setReplied(follow, false, FORM), FORM, RULES)).toBeNull();
  });

  it("Teklif gönderildi: aşama sabit, takip bölümü bilgi metnine döner, gövdede next yok", () => {
    const s = retarget({ ...initialState(FORM, RULES), outcome: "proposal_sent" }, FORM, RULES);
    expect(stageLineView(s, FORM, RULES)).toEqual({ target: "PROPOSAL", mode: "fixed" });
    expect(nextBlocked(s, FORM, RULES)).toBe("proposal");
    const body = buildBody(s, FORM, RULES);
    expect(body.stage).toEqual({ target: "PROPOSAL" });
    expect(body.next).toBeNull();
  });

  it("Kazanıldı için tutar, Kaybedildi için neden zorunlu; ileri saat reddi", () => {
    const won = { ...retarget({ ...initialState(FORM, RULES), outcome: "agreed" }, FORM, RULES), stageChecked: true };
    expect(saveBlockers(won, FORM, RULES, Date.parse(FORM.now))).toEqual(["contact.needAmount"]);
    expect(buildBody({ ...won, amount: "12.500,5".replace(".", "") }, FORM, RULES).stage).toMatchObject({
      target: "WON",
      value: { amount: 12500.5, currency: "EUR" },
    });
    const lost = {
      ...retarget({ ...initialState(FORM, RULES), outcome: "negative" }, FORM, RULES),
      stageChecked: true,
    };
    expect(saveBlockers(lost, FORM, RULES, Date.parse(FORM.now))).toEqual(["contact.needReason"]);
    const future = { ...initialState(FORM, RULES), occurredAt: "2026-11-10T14:00" };
    expect(saveBlockers(future, FORM, RULES, Date.parse(FORM.now))).toContain("contact.futureTime");
  });

  it("müşteri durumu yalnız konuşulan temasta; 'İlgisiz' Kaybedildi satırını önerir", () => {
    const s = initialState(FORM, RULES);
    expect(showsStatus(FORM, s, RULES)).toBe(false);
    const talked = retarget({ ...s, type: "call", outcome: "reply_received" }, FORM, RULES);
    expect(showsStatus(FORM, talked, RULES)).toBe(true);
    const noLine = { ...FORM, defaults: { whatsapp: { ...outcomes("whatsapp"), reply_received: row(null) } } };
    const st = { ...retarget({ ...s, outcome: "reply_received" }, noLine, RULES), status: "not_interested" };
    expect(stageLineView(st, noLine, RULES)).toEqual({ target: "LOST", mode: "unchecked" });
    expect(effectiveTarget({ ...st, lostChecked: true }, noLine, RULES)).toBe("LOST");
    expect(buildBody({ ...st, lostChecked: true, lostReason: "competitor" }, noLine, RULES)).toMatchObject({
      customerStatus: "not_interested",
      stage: { target: "LOST", lostReasonCode: "competitor" },
    });
  });
});
