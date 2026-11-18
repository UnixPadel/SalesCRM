import { describe, expect, it } from "vitest";
import type { LeadListDto, ReferenceDto } from "../../modules/sales-pipeline/api/dto";
import { cellAction, cellPerms, forwardStages, frozenRows, type CellPerms } from "./cellEdit";
import { COLUMNS } from "./listColumns";

/** Sentetik liste öğesi (kişisel veri yok). */
const lead = (over: Partial<LeadListDto> = {}): LeadListDto =>
  ({
    id: "l1",
    fullName: "Lead 1",
    email: null,
    phoneE164: null,
    assignedUserId: "me",
    currentStage: "NEW",
    warnings: [],
    nextActivity: null,
    proposal: { given: false, at: null, via: null },
    contact: { state: "never", count: 0, firstAt: null, lastAt: null, replied: false, channels: {} },
    ...over,
  }) as unknown as LeadListDto;

const who = (over: Partial<Parameters<typeof cellPerms>[1]> = {}) => ({
  userId: "me",
  isAdmin: false,
  isViewer: false,
  repsEditProducts: true,
  ...over,
});
const ADMIN = cellPerms(lead(), who({ isAdmin: true }));
const REP = cellPerms(lead(), who());
const VIEWER = cellPerms(lead(), who({ isViewer: true }));
const replied = {
  count: 1,
  firstAt: "x",
  lastAt: "x",
  firstReplyAt: "2026-11-01T06:00:00Z",
  firstReplyEstimated: false,
};
const withChannels = (channels: object) =>
  lead({ contact: { state: "contacted", count: 1, firstAt: "x", lastAt: "x", channels } as never });

describe("cellPerms", () => {
  it("satışçı: kendi lead'i ve havuz; başkasının lead'i değil", () => {
    expect(cellPerms(lead(), who()).canAct).toBe(true);
    expect(cellPerms(lead({ assignedUserId: null }), who()).canAct).toBe(true);
    expect(cellPerms(lead({ assignedUserId: "other" }), who()).canAct).toBe(false);
  });

  it("ürünler: satışçı yalnız kendi lead'inde ve ayar açıkken; havuzda önce üstlenir", () => {
    expect(cellPerms(lead(), who()).canEditProducts).toBe(true);
    expect(cellPerms(lead(), who({ repsEditProducts: false })).canEditProducts).toBe(false);
    expect(cellPerms(lead({ assignedUserId: null }), who()).canEditProducts).toBe(false);
    expect(cellPerms(lead({ assignedUserId: null }), who({ isAdmin: true })).canEditProducts).toBe(true);
  });
});

describe("cellAction", () => {
  it("görüntüleyici hiçbir hücreyi düzenleyemez", () => {
    for (const c of COLUMNS) expect(cellAction(c.id, lead(), VIEWER), c.id).toBeNull();
  });

  it("başkasının lead'inde satışçıya hiçbir hücre açılmaz", () => {
    const l = lead({ assignedUserId: "other" });
    const perms = cellPerms(l, who());
    for (const c of COLUMNS) expect(cellAction(c.id, l, perms), c.id).toBeNull();
  });

  it("sistem ve reklam kaynağı sütunları kimseye açılmaz", () => {
    for (const id of ["createdAt", "name", "surface", "campaign", "excelNo", "excelOwner", "source"]) {
      expect(cellAction(id, lead(), ADMIN), id).toBeNull();
    }
  });

  it("kanal hücreleri o kanal seçili açılır, ✔ iken de yeni temas ekler", () => {
    expect(cellAction("wa", lead(), REP)).toEqual({ kind: "log", preset: { type: "whatsapp", pickChannel: true } });
    expect(cellAction("mail", withChannels({ email: replied }), REP)).toMatchObject({ preset: { type: "email" } });
    expect(cellAction("other", lead(), REP)).toMatchObject({ preset: { type: "call" } });
  });

  it("dönüş hücreleri 'Dönüş alındı' ile açılır; dönüş varsa pasif", () => {
    expect(cellAction("mailReply", lead(), REP)).toMatchObject({
      preset: { type: "email", outcome: "reply_received" },
    });
    expect(cellAction("waReply", withChannels({ whatsapp: replied }), REP)).toBeNull();
    expect(cellAction("otherReply", lead(), REP)).toMatchObject({ preset: { type: "call" } });
    expect(cellAction("otherReply", withChannels({ meeting: replied }), REP)).toBeNull();
  });

  it("teklif: kanal dayatmadan 'Teklif gönderildi'; verilmişse pasif", () => {
    expect(cellAction("proposal", lead(), REP)).toEqual({
      kind: "log",
      preset: { outcome: "proposal_sent", pickChannel: true },
    });
    const given = lead({ proposal: { given: true, at: null, via: "stage" } });
    expect(cellAction("proposal", given, REP)).toBeNull();
  });

  it("ilk temas yalnız boşken; son temas ve sayı her zaman yeni temas açar", () => {
    const met = lead({ contact: { state: "contacted", count: 1, firstAt: "x", lastAt: "x", channels: {} } as never });
    expect(cellAction("first", lead(), REP)).toEqual({ kind: "log", preset: {} });
    expect(cellAction("first", met, REP)).toBeNull();
    expect(cellAction("last", met, REP)).toEqual({ kind: "log", preset: {} });
    expect(cellAction("count", met, REP)).toEqual({ kind: "log", preset: {} });
  });

  it("sonraki adım: plan varsa onu tamamlar, yoksa plan formu; kapanmış lead'de pasif", () => {
    const nextActivity = { id: "a1", type: "call" as const, subject: "Arama", dueAt: "2026-11-20T06:00:00Z" };
    expect(cellAction("next", lead({ nextActivity }), REP)).toEqual({
      kind: "log",
      preset: { type: "call", activityId: "a1" },
    });
    expect(cellAction("next", lead(), REP)).toEqual({ kind: "form", form: "plan" });
    expect(cellAction("next", lead({ currentStage: "WON" }), REP)).toBeNull();
  });

  it("aşama ve durum satışçıya açık; kapanmış aşama değişmez", () => {
    expect(cellAction("stage", lead(), REP)).toEqual({ kind: "pick" });
    expect(cellAction("stage", lead({ currentStage: "LOST" }), REP)).toBeNull();
    expect(cellAction("status", lead({ currentStage: "LOST" }), REP)).toEqual({ kind: "pick" });
    expect(cellAction("note", lead(), REP)).toEqual({ kind: "form", form: "note" });
  });

  it("yönetici alanları satışçıya kapalı", () => {
    for (const id of ["owner", "country", "site", "timeline", "profile", "band", "phoneNo"]) {
      expect(cellAction(id, lead(), REP), id).toBeNull();
      expect(cellAction(id, lead(), ADMIN), id).not.toBeNull();
    }
  });

  it("telefon ve e-posta: yönetici yalnız boşken ekler, doluysa bağlantılar kalır", () => {
    expect(cellAction("email", lead(), ADMIN)).toEqual({ kind: "form", form: "contact" });
    expect(cellAction("email", lead({ email: "a@example.com" }), ADMIN)).toBeNull();
    expect(cellAction("phone", lead({ phoneE164: "+905550000000" }), ADMIN)).toBeNull();
  });

  it("uyarılar: yalnız yönetici ve uyarı varsa", () => {
    const warned = lead({ warnings: [{ code: "x" }] as never });
    expect(cellAction("warn", lead(), ADMIN)).toBeNull();
    expect(cellAction("warn", warned, ADMIN)).toEqual({ kind: "form", form: "warnings" });
    expect(cellAction("warn", warned, REP)).toBeNull();
  });

  it("ürünler ürün iznine bağlıdır, işlem iznine değil", () => {
    const pool = lead({ assignedUserId: null });
    const perms: CellPerms = cellPerms(pool, who());
    expect(perms.canAct).toBe(true);
    expect(cellAction("standard", pool, perms)).toBeNull();
    expect(cellAction("roof", lead(), REP)).toEqual({ kind: "form", form: "products" });
  });
});

describe("forwardStages", () => {
  const stage = (code: string, isTerminal = false) => ({ code, isTerminal }) as ReferenceDto["stages"][number];
  const STAGES = [
    stage("NEW"),
    stage("CONTACTED"),
    stage("QUALIFIED"),
    stage("PROPOSAL"),
    stage("WON", true),
    stage("LOST", true),
  ];

  it("yalnız ileri aşamalar ve Kaybedildi; kapanmış aşamadan hiçbiri", () => {
    expect(forwardStages(STAGES, "QUALIFIED")).toEqual(["PROPOSAL", "WON", "LOST"]);
    expect(forwardStages(STAGES, "WON")).toEqual([]);
    expect(forwardStages([], "NEW")).toEqual([]);
  });
});

describe("frozenRows", () => {
  it("sırayı korur, güncel satırı kullanır, süzgeç dışına düşeni ek listeden alır, kaybolanı atar", () => {
    const a = lead({ id: "a", fullName: "güncel" });
    const b = lead({ id: "b" });
    const out = frozenRows(["b", "a", "gone"], [a], new Map([["b", b]]));
    expect(out.map((r) => r.id)).toEqual(["b", "a"]);
    expect(out[1]?.fullName).toBe("güncel");
  });

  it("satır hem listede hem ek listede varsa liste kazanır", () => {
    const fresh = lead({ id: "a", fullName: "yeni" });
    const old = lead({ id: "a", fullName: "eski" });
    expect(frozenRows(["a"], [fresh], new Map([["a", old]]))[0]?.fullName).toBe("yeni");
  });
});
