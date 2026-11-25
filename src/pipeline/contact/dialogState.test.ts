import { describe, expect, it } from "vitest";
import type { ContactDefaultsDto, ContactFormDto } from "../../modules/sales-pipeline/api/dto.contact";
import {
  buildBody,
  changeChannel,
  effectiveTarget,
  evidenceRule,
  initialState,
  nextBlocked,
  pickPlan,
  retarget,
  saveBlockers,
  setReplied,
  stageEvidenceRule,
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
  completableByType: { call: "a1", whatsapp: "a1", email: "a1", meeting: "a1", other: "a1" },
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

  it("görüşme notu isteğe bağlı: boş ya da yalnız boşluk not kaydı durdurmaz", () => {
    const s = initialState(FORM, RULES);
    const at = Date.parse(FORM.now);
    // "Dönüş alındı mı?" sorusu ayrı test edilir; burada cevaplanmış sayılır.
    const answered = { ...s, stageChecked: false };
    expect(saveBlockers(answered, FORM, RULES, at)).toEqual([]);
    expect(saveBlockers({ ...answered, note: "   " }, FORM, RULES, at)).toEqual([]);
    expect(buildBody({ ...answered, note: "   " }, FORM, RULES).note).toBe("");
    expect(saveBlockers({ ...answered, note: "Fiyat listesi istedi" }, FORM, RULES, at)).toEqual([]);
  });

  it("ekran görüntüsü zorunlu: dosyasız kayıt durur; temasla birlikte aşama değişse de tek dosya yeter", () => {
    const at = Date.parse(FORM.now);
    const s = { ...initialState(FORM, RULES, { type: "whatsapp" }), note: "Katalog gönderildi" };
    const answered = { ...s, stageChecked: false };
    expect(saveBlockers(answered, FORM, RULES, at, 0)).toEqual(["contact.needFile"]);
    expect(saveBlockers(answered, FORM, RULES, at, 1)).toEqual([]);
    // "Dönüş alındı: Evet" aşamayı İletişim kuruldu yapar; ayrı bir dosya istenmez.
    const yes = { ...s, stageChecked: true };
    expect(buildBody(yes, FORM, RULES).stage).toEqual({ target: "CONTACTED" });
    expect(saveBlockers(yes, FORM, RULES, at, 1)).toEqual([]);
    // Not boş olsa da yalnız dosya eksikliği söylenir.
    expect(saveBlockers({ ...answered, note: "" }, FORM, RULES, at, 0)).toEqual(["contact.needFile"]);
  });

  it("iletişim kaydında dosya yalnız WhatsApp ve telefonda zorunlu", () => {
    const at = Date.parse(FORM.now);
    for (const type of ["email", "meeting", "site_visit"] as const) {
      const s = { ...initialState(FORM, RULES, { type }), note: "Konuşuldu", stageChecked: true };
      expect(saveBlockers(s, FORM, RULES, at, 0)).not.toContain("contact.needFile");
      expect(evidenceRule(type, null).required).toBe(false);
    }
    const call = { ...initialState(FORM, RULES, { type: "call" }), note: "Arandı", stageChecked: false };
    expect(saveBlockers(call, FORM, RULES, at, 0)).toContain("contact.needFile");
    expect(evidenceRule("call", null)).toEqual({ required: true, purposeKey: "attach.purpose.call" });
    expect(evidenceRule("whatsapp", "CONTACTED")).toEqual({ required: true, purposeKey: "attach.purpose.whatsapp" });
    expect(evidenceRule("email", null).purposeKey).toBe("attach.purpose.email");
    expect(evidenceRule("meeting", null).purposeKey).toBe("attach.purpose.contact");
    // Aşama ilerliyorsa ipucu aşamanınkidir; zorunluluk yine kanala bağlıdır.
    expect(evidenceRule("email", "WON")).toEqual({ required: false, purposeKey: "attach.purpose.WON" });
    expect(evidenceRule("call", "PROPOSAL")).toEqual({ required: true, purposeKey: "attach.purpose.PROPOSAL" });
  });

  it("aşama penceresi: Nitelikli / Teklif / Kazanıldı / Kaybedildi'de dosya zorunlu; aşama kapısı kanala bakar", () => {
    for (const target of ["QUALIFIED", "PROPOSAL", "WON", "LOST"] as const) {
      expect(stageEvidenceRule("email", target)).toEqual({ required: true, purposeKey: `attach.purpose.${target}` });
    }
    expect(stageEvidenceRule("email", "CONTACTED").required).toBe(false);
    expect(stageEvidenceRule("call", "CONTACTED").required).toBe(true);
  });

  it("'Dönüş alındı mı?': önseçili değilse cevapsız başlar ve kaydı durdurur; Evet aşamayı taşır, Hayır taşımaz", () => {
    const at = Date.parse(FORM.now);
    const base = { ...initialState(FORM, RULES, { type: "call" }), note: "Arandı" };
    // İşaretsiz gelen satır (Dönüş bekleniyor): cevap yok, Kaydet pasif.
    const waiting = retarget({ ...base, outcome: "awaiting_reply" }, FORM, RULES);
    expect(waiting.stageChecked).toBeNull();
    expect(saveBlockers(waiting, FORM, RULES, at)).toEqual(["contact.needReplyAnswer"]);
    const no = { ...waiting, stageChecked: false };
    expect(saveBlockers(no, FORM, RULES, at)).toEqual([]);
    expect(buildBody(no, FORM, RULES).stage).toBeUndefined();
    const yes = { ...waiting, stageChecked: true };
    expect(saveBlockers(yes, FORM, RULES, at)).toEqual([]);
    expect(buildBody(yes, FORM, RULES).stage).toEqual({ target: "CONTACTED" });
    // İşaretli gelen satır (Dönüş alındı): Evet önseçili, engel yok.
    const replied = retarget({ ...base, outcome: "reply_received" }, FORM, RULES);
    expect(replied.stageChecked).toBe(true);
    expect(saveBlockers(replied, FORM, RULES, at)).toEqual([]);
    // Takip edilecek: "Müşteri cevap verdi" ile Evet; işaret kalkınca yeniden cevapsız.
    const follow = retarget({ ...base, outcome: "follow_up" }, FORM, RULES);
    expect(follow.stageChecked).toBe(true);
    const unflagged = setReplied(follow, false, FORM);
    expect(unflagged.stageChecked).toBeNull();
    expect(saveBlockers(unflagged, FORM, RULES, at)).toEqual(["contact.needReplyAnswer"]);
    // Onay kutusu olan satırlar (Kazanıldı) cevapsız olmaz.
    const agreed = retarget({ ...base, outcome: "agreed" }, FORM, RULES);
    expect(agreed.stageChecked).toBe(false);
    expect(saveBlockers(agreed, FORM, RULES, at)).toEqual([]);
  });

  it("Kazanıldı için tutar, Kaybedildi için neden zorunlu; ileri saat reddi", () => {
    const won = {
      ...retarget({ ...initialState(FORM, RULES), outcome: "agreed" }, FORM, RULES),
      stageChecked: true,
      note: "Anlaştık",
    };
    expect(saveBlockers(won, FORM, RULES, Date.parse(FORM.now))).toEqual(["contact.needAmount"]);
    expect(buildBody({ ...won, amount: "12.500,5".replace(".", "") }, FORM, RULES).stage).toMatchObject({
      target: "WON",
      value: { amount: 12500.5, currency: "EUR" },
    });
    const lost = {
      ...retarget({ ...initialState(FORM, RULES), outcome: "negative" }, FORM, RULES),
      stageChecked: true,
      note: "İlgilenmiyor",
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

  describe("hücreden açılış", () => {
    const TWO: ContactFormDto = {
      ...FORM,
      openActivities: [
        { id: "c1", type: "call", subject: "Arama", dueAt: "2026-11-09T06:00:00Z" },
        { id: "w1", type: "whatsapp", subject: "WhatsApp", dueAt: "2026-11-10T06:00:00Z" },
      ],
      completableId: "c1",
      completableByType: { call: "c1", whatsapp: "w1", email: "c1" },
      defaultType: "call",
    };
    const free = { presetOutcome: undefined, planLocked: false };

    it("seçili kanalın planı tamamlanır, son kanalın planı değil", () => {
      expect(initialState(TWO, RULES, { type: "whatsapp" }).activityId).toBe("w1");
      expect(initialState(TWO, RULES).activityId).toBe("c1");
      expect(initialState(TWO, RULES, { type: "whatsapp", activityId: "c1" }).activityId).toBe("c1");
    });

    it("kanal değişince hücreden gelen sonuç kalır, plan yeni kanala göre seçilir", () => {
      const s = initialState(TWO, RULES, { type: "call", outcome: "proposal_sent" });
      const next = changeChannel(s, "whatsapp", TWO, RULES, { presetOutcome: "proposal_sent", planLocked: false });
      expect(next).toMatchObject({ type: "whatsapp", outcome: "proposal_sent", activityId: "w1" });
      expect(effectiveTarget(next, TWO, RULES)).toBe("PROPOSAL");
    });

    it("kullanıcı sonucu değiştirdiyse kanal varsayılanı geçerli; elle seçilen plan korunur", () => {
      const s = {
        ...initialState(TWO, RULES, { type: "call", outcome: "proposal_sent" }),
        outcome: "follow_up" as const,
      };
      expect(
        changeChannel(s, "whatsapp", TWO, RULES, { presetOutcome: "proposal_sent", planLocked: true }),
      ).toMatchObject({
        outcome: "awaiting_reply",
        activityId: "c1",
      });
      expect(changeChannel(s, "email", TWO, RULES, free).outcome).toBe("awaiting_reply");
    });

    it("plan seçimi kanalı plana çevirir, hücreden gelen sonucu silmez", () => {
      const s = initialState(TWO, RULES, { type: "whatsapp", outcome: "reply_received" });
      const plan = { id: "c1", type: "call" as const };
      expect(pickPlan(s, plan, TWO, RULES, "reply_received")).toMatchObject({
        activityId: "c1",
        type: "call",
        outcome: "reply_received",
      });
      expect(pickPlan(s, plan, TWO, RULES, undefined).outcome).toBe("awaiting_reply");
    });

    it("okunamayan teklif tutarı kaydı durdurur; boş ya da geçerli tutar durdurmaz", () => {
      const s = { ...initialState(FORM, RULES, { outcome: "proposal_sent" }), note: "Teklif gitti" };
      const at = Date.parse(FORM.now);
      expect(saveBlockers({ ...s, amount: "12.500,00" }, FORM, RULES, at)).toEqual(["contact.badAmount"]);
      expect(saveBlockers({ ...s, amount: "" }, FORM, RULES, at)).toEqual([]);
      expect(saveBlockers({ ...s, amount: "12500,50" }, FORM, RULES, at)).toEqual([]);
    });
  });
});
