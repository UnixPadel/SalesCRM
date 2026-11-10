import { describe, expect, it } from "vitest";
import {
  ACTIVITY_OUTCOMES,
  NO_CONTACT_FIELDS,
  type Activity,
  type ActivityOutcome,
  type ActivityType,
} from "./activity";
import {
  aggregateContacts,
  CONTACT_RULES,
  pickCompletable,
  repliedFlagApplies,
  stageLine,
  suggestNext,
  summarizeContacts,
  validateContact,
  type ContactAggregateRow,
  type ContactInput,
} from "./contact";
import { STAGE_CODES, type StageCode } from "./stage";

const TZ = "Europe/Istanbul";

let seq = 0;
const act = (over: Partial<Activity>): Activity => ({
  id: `a${++seq}`,
  leadId: "l1",
  type: "call",
  subject: "Arama",
  dueAt: new Date("2026-11-01T06:00:00Z"),
  doneAt: null,
  notes: "",
  autoCreated: false,
  createdByChangeId: null,
  createdByUserId: null,
  legacyId: null,
  ...NO_CONTACT_FIELDS,
  createdAt: new Date("2026-11-01T06:00:00Z"),
  updatedAt: new Date("2026-11-01T06:00:00Z"),
  ...over,
});

const done = (type: ActivityType, outcome: ActivityOutcome | null, at: string, over: Partial<Activity> = {}) =>
  act({ type, outcome, doneAt: new Date(at), dueAt: new Date(at), ...over });

const row = (over: Partial<ContactAggregateRow> & { at: string }): ContactAggregateRow => {
  const { at, ...rest } = over;
  return {
    leadId: "l1",
    type: "email",
    outcome: "awaiting_reply",
    customerReplied: false,
    estimated: false,
    n: 1,
    firstAt: new Date(at),
    lastAt: new Date(at),
    ...rest,
  };
};

const summary = (acts: Activity[], historyUnknown = false) =>
  summarizeContacts(aggregateContacts(acts), historyUnknown);

describe("aggregateContacts", () => {
  it("yalnız tamamlanmış satırlar; anahtar lead|tür|sonuç|cevap|tahmini; n, ilk ve son zaman", () => {
    const rows = aggregateContacts([
      done("email", "awaiting_reply", "2026-11-02T08:00:00Z"),
      done("email", "awaiting_reply", "2026-11-04T08:00:00Z"),
      done("email", "awaiting_reply", "2026-11-03T08:00:00Z"),
      done("email", "awaiting_reply", "2026-11-05T08:00:00Z", { dateEstimated: true }),
      done("call", "follow_up", "2026-11-03T09:00:00Z", { customerReplied: true }),
      done("call", "follow_up", "2026-11-03T10:00:00Z"),
      done("whatsapp", null, "2026-11-03T10:00:00Z", { leadId: "l2" }),
      act({ type: "email" }), // açık plan: temas değil
    ]);
    expect(rows).toHaveLength(5);
    const email = rows.find((r) => r.type === "email" && !r.estimated)!;
    expect(email).toMatchObject({ leadId: "l1", n: 3, outcome: "awaiting_reply" });
    expect(email.firstAt.toISOString()).toBe("2026-11-02T08:00:00.000Z");
    expect(email.lastAt.toISOString()).toBe("2026-11-04T08:00:00.000Z");
    expect(rows.filter((r) => r.type === "call").map((r) => r.customerReplied)).toEqual([false, true]);
    expect(rows.find((r) => r.leadId === "l2")).toMatchObject({ type: "whatsapp", outcome: null, n: 1 });
  });

  it("çıktı kararlı sırada (girdi sırasından bağımsız)", () => {
    const acts = [
      done("whatsapp", "awaiting_reply", "2026-11-03T08:00:00Z"),
      done("call", "reply_received", "2026-11-02T08:00:00Z"),
      done("email", "awaiting_reply", "2026-11-01T08:00:00Z", { leadId: "l0" }),
    ];
    expect(aggregateContacts(acts)).toEqual(aggregateContacts([...acts].reverse()));
    expect(aggregateContacts(acts).map((r) => `${r.leadId}:${r.type}`)).toEqual(["l0:email", "l1:call", "l1:whatsapp"]);
  });
});

describe("summarizeContacts: durum", () => {
  it("temas yok → never; eski kayıt → legacy; temas varsa eski kayıt işareti önemsiz", () => {
    expect(summarizeContacts([], false).state).toBe("never");
    expect(summarizeContacts([], true).state).toBe("legacy");
    expect(summary([done("email", "awaiting_reply", "2026-11-02T08:00:00Z")], true).state).toBe("contacted");
  });

  it("boş özet: sayılar 0, tarihler null, kanal yok", () => {
    expect(summarizeContacts([], false)).toEqual({
      state: "never",
      count: 0,
      firstAt: null,
      firstAtEstimated: false,
      lastAt: null,
      lastAtEstimated: false,
      lastOutcome: null,
      lastType: null,
      replied: false,
      firstReplyAt: null,
      channels: {},
      proposalContactAt: null,
    });
  });

  it("sonuçsuz tamamlanmış aktivite de temas sayılır (Excel AB)", () => {
    const s = summary([done("meeting", null, "2026-11-02T08:00:00Z")]);
    expect(s).toMatchObject({ state: "contacted", count: 1, lastOutcome: null, lastType: "meeting", replied: false });
  });
});

describe("summarizeContacts: dönüş", () => {
  it("dönüş yapışkandır: sonraki 'Dönüş bekleniyor' önceki dönüşü silmez", () => {
    const s = summary([
      done("whatsapp", "awaiting_reply", "2026-11-02T08:00:00Z"),
      done("whatsapp", "reply_received", "2026-11-03T08:00:00Z"),
      done("whatsapp", "awaiting_reply", "2026-11-05T08:00:00Z"),
    ]);
    expect(s.replied).toBe(true);
    expect(s.firstReplyAt?.toISOString()).toBe("2026-11-03T08:00:00.000Z");
    expect(s.lastOutcome).toBe("awaiting_reply");
    expect(s.channels.whatsapp).toMatchObject({ count: 3 });
    expect(s.channels.whatsapp?.firstReplyAt?.toISOString()).toBe("2026-11-03T08:00:00.000Z");
  });

  it.each([
    ["reply_received", false, true],
    ["negative", false, true],
    ["agreed", false, true],
    ["awaiting_reply", false, false],
    ["follow_up", false, false],
    ["proposal_sent", false, false],
    ["follow_up", true, true],
    ["proposal_sent", true, true],
  ] as const)("sonuç %s, cevap işareti %s → dönüş %s", (outcome, customerReplied, replied) => {
    expect(summary([done("call", outcome, "2026-11-02T08:00:00Z", { customerReplied })]).replied).toBe(replied);
  });

  it("kanal bazında ilk dönüş ve genel ilk dönüş; dönüşü olmayan kanalda null", () => {
    const s = summary([
      done("email", "awaiting_reply", "2026-11-01T08:00:00Z"),
      done("email", "reply_received", "2026-11-06T08:00:00Z"),
      done("email", "reply_received", "2026-11-04T08:00:00Z"),
      done("whatsapp", "awaiting_reply", "2026-11-02T08:00:00Z"),
      done("call", "follow_up", "2026-11-03T08:00:00Z", { customerReplied: true }),
    ]);
    expect(s.channels.email?.firstReplyAt?.toISOString()).toBe("2026-11-04T08:00:00.000Z");
    expect(s.channels.call?.firstReplyAt?.toISOString()).toBe("2026-11-03T08:00:00.000Z");
    expect(s.channels.whatsapp?.firstReplyAt).toBeNull();
    expect(s.channels.meeting).toBeUndefined();
    expect(s.firstReplyAt?.toISOString()).toBe("2026-11-03T08:00:00.000Z");
    expect(s.count).toBe(5);
    expect(s.channels.email).toMatchObject({ count: 3 });
    expect(s.channels.email?.firstAt.toISOString()).toBe("2026-11-01T08:00:00.000Z");
    expect(s.channels.email?.lastAt.toISOString()).toBe("2026-11-06T08:00:00.000Z");
  });

  it("tahmini işaretler: ilk, son ve kanal dönüşü", () => {
    const s = summary([
      done("email", "awaiting_reply", "2026-10-22T06:00:00Z", { dateEstimated: true }),
      done("email", "reply_received", "2026-10-22T06:01:00Z", { dateEstimated: true }),
      done("call", "awaiting_reply", "2026-11-02T08:00:00Z"),
    ]);
    expect(s.firstAtEstimated).toBe(true);
    expect(s.lastAtEstimated).toBe(false);
    expect(s.channels.email?.firstReplyEstimated).toBe(true);
    expect(s.channels.call?.firstReplyEstimated).toBe(false);
  });

  it("teklif teması: sonucu ya da türü proposal_sent olan ilk temas", () => {
    expect(
      summary([
        done("email", "proposal_sent", "2026-11-05T08:00:00Z"),
        done("proposal_sent", null, "2026-11-03T08:00:00Z"),
        done("email", "awaiting_reply", "2026-11-01T08:00:00Z"),
      ]).proposalContactAt?.toISOString(),
    ).toBe("2026-11-03T08:00:00.000Z");
    expect(summary([done("email", "awaiting_reply", "2026-11-01T08:00:00Z")]).proposalContactAt).toBeNull();
  });
});

describe("summarizeContacts: eşit zaman sıralaması [K-I7]", () => {
  const at = "2026-11-02T08:00:00Z";

  it("dönüş > teklif > diğer", () => {
    const s = summarizeContacts(
      [
        row({ at, type: "email", outcome: "awaiting_reply" }),
        row({ at, type: "email", outcome: "proposal_sent" }),
        row({ at, type: "whatsapp", outcome: "reply_received" }),
      ],
      false,
    );
    expect([s.lastType, s.lastOutcome]).toEqual(["whatsapp", "reply_received"]);
    const t = summarizeContacts(
      [row({ at, type: "email", outcome: "awaiting_reply" }), row({ at, type: "meeting", outcome: "proposal_sent" })],
      false,
    );
    expect(t.lastOutcome).toBe("proposal_sent");
    const u = summarizeContacts(
      [row({ at, type: "call", outcome: "follow_up" }), row({ at, type: "proposal_sent", outcome: null })],
      false,
    );
    expect(u.lastType).toBe("proposal_sent");
  });

  it("aynı tür sonuçta tahmini olmayan önce", () => {
    const s = summarizeContacts(
      [
        row({ at, type: "call", outcome: "awaiting_reply", estimated: true }),
        row({ at, type: "whatsapp", outcome: "awaiting_reply", estimated: false }),
      ],
      false,
    );
    expect(s.lastType).toBe("whatsapp");
    expect(s.lastAtEstimated).toBe(false);
    expect(s.firstAtEstimated).toBe(false);
  });

  it("sonra tür, sonra sonuç alfabetik; girdi sırası önemsiz", () => {
    const rows = [
      row({ at, type: "whatsapp", outcome: "awaiting_reply" }),
      row({ at, type: "call", outcome: "follow_up" }),
      row({ at, type: "call", outcome: "awaiting_reply" }),
    ];
    for (const list of [rows, [...rows].reverse()]) {
      const s = summarizeContacts(list, false);
      expect([s.lastType, s.lastOutcome]).toEqual(["call", "awaiting_reply"]);
    }
  });

  it("Excel aktarımı: gönderim 09:00 ve dönüş 09:01 → son temas sonucu 'Dönüş alındı'", () => {
    const s = summary([
      done("email", "awaiting_reply", "2026-10-22T06:00:00Z", { dateEstimated: true }),
      done("email", "reply_received", "2026-10-22T06:01:00Z", { dateEstimated: true }),
    ]);
    expect(s.lastOutcome).toBe("reply_received");
    expect(s.count).toBe(2);
  });
});

describe("stageLine", () => {
  const OUTCOMES = ACTIVITY_OUTCOMES;
  const expected = (outcome: ActivityOutcome, current: StageCode, outbound: boolean): ReturnType<typeof stageLine> => {
    if (current === "WON" || current === "LOST") return null;
    if (outcome === "proposal_sent" && ["NEW", "CONTACTED", "QUALIFIED"].includes(current)) {
      return { target: "PROPOSAL", mode: "fixed" };
    }
    if (outcome === "agreed") return { target: "WON", mode: "unchecked" };
    if (outcome === "negative") return { target: "LOST", mode: "unchecked" };
    if (current !== "NEW") return null;
    if (outcome === "reply_received") return { target: "CONTACTED", mode: "checked" };
    if (outcome === "follow_up") return { target: "CONTACTED", mode: "checked_if_replied" };
    if (outcome === "awaiting_reply") return { target: "CONTACTED", mode: outbound ? "checked" : "unchecked" };
    return null;
  };

  for (const outbound of [false, true]) {
    for (const current of STAGE_CODES) {
      for (const outcome of OUTCOMES) {
        it(`${outcome} @ ${current} (contactedOnOutbound=${outbound})`, () => {
          expect(stageLine({ outcome, current }, { contactedOnOutbound: outbound })).toEqual(
            expected(outcome, current, outbound),
          );
        });
      }
    }
  }

  it("varsayılan kural CONTACT_RULES.contactedOnOutbound (kapalı)", () => {
    expect(CONTACT_RULES.contactedOnOutbound).toBe(false);
    expect(stageLine({ outcome: "awaiting_reply", current: "NEW" })).toEqual({
      target: "CONTACTED",
      mode: "unchecked",
    });
  });

  it("QUALIFIED hiçbir birleşimde önerilmez", () => {
    for (const current of STAGE_CODES) {
      for (const outcome of OUTCOMES) expect(stageLine({ outcome, current })?.target).not.toBe("QUALIFIED");
    }
  });
});

describe("suggestNext", () => {
  const now = new Date("2026-11-10T12:00:00Z"); // Salı, İstanbul 15:00
  const base = { now, current: "NEW" as StageCode, stageTarget: null, timeZone: TZ };

  it("WhatsApp, Dönüş bekleniyor → WhatsApp takibi 2 gün sonra 09:00 (İstanbul)", () => {
    expect(suggestNext({ ...base, outcome: "awaiting_reply", type: "whatsapp" })).toEqual({
      type: "whatsapp",
      subject: "WhatsApp takibi",
      dueAt: new Date("2026-11-12T06:00:00Z"),
    });
  });

  it("gün sayısı sonuca göre; tür call/email/whatsapp aynı, diğerleri arama", () => {
    expect(suggestNext({ ...base, outcome: "reply_received", type: "email" })).toMatchObject({
      type: "email",
      subject: "E-posta takibi",
      dueAt: new Date("2026-11-13T06:00:00Z"),
    });
    expect(suggestNext({ ...base, outcome: "follow_up", type: "meeting" })).toMatchObject({
      type: "call",
      subject: "Takip araması",
    });
    expect(suggestNext({ ...base, outcome: "reply_received", type: "other" })?.type).toBe("call");
    expect(suggestNext({ ...base, outcome: "reply_received", type: "site_visit" })?.type).toBe("call");
    expect(suggestNext({ ...base, outcome: "awaiting_reply", type: "call" })?.type).toBe("call");
  });

  it("Olumsuz ve Anlaşma'da takip yok", () => {
    expect(suggestNext({ ...base, outcome: "negative", type: "call" })).toBeNull();
    expect(suggestNext({ ...base, outcome: "agreed", type: "call" })).toBeNull();
  });

  it("aşama hedefi PROPOSAL, WON ya da LOST iken null (PROPOSAL'da teklif takibi otomatik)", () => {
    for (const stageTarget of ["PROPOSAL", "WON", "LOST"] as const) {
      expect(suggestNext({ ...base, outcome: "proposal_sent", type: "email", stageTarget })).toBeNull();
    }
    expect(suggestNext({ ...base, outcome: "reply_received", type: "email", stageTarget: "CONTACTED" })).not.toBeNull();
  });

  it("terminal aşamada null; PROPOSAL'da zaten olan lead'e teklif teması takip alır", () => {
    expect(suggestNext({ ...base, current: "WON", outcome: "reply_received", type: "call" })).toBeNull();
    expect(suggestNext({ ...base, current: "LOST", outcome: "reply_received", type: "call" })).toBeNull();
    expect(suggestNext({ ...base, current: "PROPOSAL", outcome: "proposal_sent", type: "email" })).toMatchObject({
      type: "email",
      dueAt: new Date("2026-11-13T06:00:00Z"),
    });
  });

  it("saat dilimi: İstanbul'da ertesi güne geçmiş an (UTC 22:30) gün sayımını yerel günden yapar", () => {
    const late = new Date("2026-11-10T22:30:00Z"); // İstanbul 11 Kas 01:30
    expect(suggestNext({ ...base, now: late, outcome: "awaiting_reply", type: "call" })?.dueAt).toEqual(
      new Date("2026-11-13T06:00:00Z"),
    );
    expect(
      suggestNext({ ...base, now: late, timeZone: "UTC", outcome: "awaiting_reply", type: "call" })?.dueAt,
    ).toEqual(new Date("2026-11-12T09:00:00Z"));
  });
});

describe("pickCompletable", () => {
  const now = new Date("2026-11-10T12:00:00Z");
  const plan = (id: string, type: ActivityType, due: string, over: Partial<Activity> = {}) =>
    act({ id, type, dueAt: new Date(due), ...over });

  it("vadesi bugünün sonuna kadar gelenler; önce aynı tür, sonra en erken vade", () => {
    const open = [
      plan("call-old", "call", "2026-11-05T06:00:00Z"),
      plan("wa-today", "whatsapp", "2026-11-10T20:00:00Z"),
      plan("wa-old", "whatsapp", "2026-11-08T06:00:00Z"),
    ];
    expect(pickCompletable(open, "whatsapp", now, TZ)?.id).toBe("wa-old");
    expect(pickCompletable(open, "call", now, TZ)?.id).toBe("call-old");
    expect(pickCompletable(open, "email", now, TZ)?.id).toBe("call-old");
  });

  it("bugün sonu sınırı saat dilimine göre: İstanbul 23:59 dahil, ertesi gün 00:00 hariç", () => {
    const last = plan("last-minute", "call", "2026-11-10T20:59:00Z"); // İstanbul 23:59
    const next = plan("tomorrow", "call", "2026-11-10T21:00:00Z"); // İstanbul 11 Kas 00:00
    expect(pickCompletable([next, last], "call", now, TZ)?.id).toBe("last-minute");
    expect(pickCompletable([next], "call", now, TZ)).toBeNull();
    expect(pickCompletable([next], "call", now, "UTC")?.id).toBe("tomorrow");
  });

  it("gelecekteki plan ve tamamlanmış satır varsayılan olmaz", () => {
    expect(
      pickCompletable(
        [
          plan("future", "whatsapp", "2026-11-24T06:00:00Z"),
          plan("done", "whatsapp", "2026-11-09T06:00:00Z", { doneAt: new Date("2026-11-09T07:00:00Z") }),
        ],
        "whatsapp",
        now,
        TZ,
      ),
    ).toBeNull();
    expect(pickCompletable([], "call", now, TZ)).toBeNull();
  });

  it("aynı vade ve türde kimliğe göre kararlı", () => {
    const due = "2026-11-10T06:00:00Z";
    expect(pickCompletable([plan("b", "call", due), plan("a", "call", due)], "call", now, TZ)?.id).toBe("a");
  });
});

describe("validateContact", () => {
  const now = new Date("2026-11-10T12:00:00Z");
  const input = (over: Partial<ContactInput> = {}): ContactInput => ({
    type: "whatsapp",
    outcome: "awaiting_reply",
    customerReplied: false,
    occurredAt: now,
    now,
    note: "",
    completingType: null,
    timeZone: TZ,
    ...over,
  });
  const code = (over: Partial<ContactInput>) => {
    const r = validateContact(input(over));
    return r.ok ? "ok" : r.error.code;
  };

  it("geçerli girdi; not kırpılır", () => {
    const r = validateContact(input({ note: "  Fiyat listesi istedi.  " }));
    expect(r.ok && r.value).toEqual({
      type: "whatsapp",
      outcome: "awaiting_reply",
      customerReplied: false,
      occurredAt: now,
      note: "Fiyat listesi istedi.",
    });
  });

  it("tür: 5 kanal serbest; proposal_sent/site_visit yalnız aynı türde plan tamamlanırken [M-M5]", () => {
    for (const type of ["call", "whatsapp", "email", "meeting", "other"]) expect(code({ type })).toBe("ok");
    expect(code({ type: "proposal_sent" })).toBe("contact.type");
    expect(code({ type: "site_visit", completingType: "proposal_sent" })).toBe("contact.type");
    expect(code({ type: "proposal_sent", completingType: "proposal_sent", outcome: "proposal_sent" })).toBe("ok");
    expect(code({ type: "site_visit", completingType: "site_visit", outcome: "reply_received" })).toBe("ok");
    expect(code({ type: "sms" })).toBe("contact.type");
    expect(code({ type: undefined })).toBe("contact.type");
  });

  it("sonuç listede olmalı", () => {
    expect(code({ outcome: "maybe" })).toBe("contact.outcome");
    expect(code({ outcome: null })).toBe("contact.outcome");
  });

  it("cevap işareti yalnız follow_up ve proposal_sent'te", () => {
    expect(code({ outcome: "follow_up", customerReplied: true })).toBe("ok");
    expect(code({ outcome: "proposal_sent", customerReplied: true })).toBe("ok");
    expect(code({ outcome: "reply_received", customerReplied: true })).toBe("contact.replied_flag");
    expect(code({ outcome: "awaiting_reply", customerReplied: true })).toBe("contact.replied_flag");
    expect(repliedFlagApplies("follow_up")).toBe(true);
    expect(repliedFlagApplies("negative")).toBe(false);
  });

  it("ileri tarih: şimdi + 5 dk dahil, sonrası red", () => {
    expect(code({ occurredAt: new Date(now.getTime() + 5 * 60_000) })).toBe("ok");
    expect(code({ occurredAt: new Date(now.getTime() + 5 * 60_000 + 1) })).toBe("contact.future");
  });

  it("2024-01-01 öncesi red; sınır İstanbul günüyle", () => {
    expect(code({ occurredAt: new Date("2023-12-31T21:00:00Z") })).toBe("ok"); // İstanbul 1 Oca 2024 00:00
    expect(code({ occurredAt: new Date("2023-12-31T20:59:59Z") })).toBe("contact.too_old");
    expect(code({ occurredAt: new Date("2023-12-31T20:59:59Z"), timeZone: "UTC" })).toBe("contact.too_old");
    expect(code({ occurredAt: new Date("2024-01-01T00:00:00Z"), timeZone: "UTC" })).toBe("ok");
  });

  it("geçersiz zaman red", () => {
    expect(code({ occurredAt: new Date("bozuk") })).toBe("contact.occurred_invalid");
  });

  it("not en fazla 4000 karakter (kırpıldıktan sonra)", () => {
    expect(code({ note: "x".repeat(4000) })).toBe("ok");
    expect(code({ note: ` ${"x".repeat(4000)} ` })).toBe("ok");
    expect(code({ note: "x".repeat(4001) })).toBe("contact.note_too_long");
  });
});

describe("CONTACT_RULES", () => {
  it("her tür için varsayılan sonuç ve her sonuç için takip günü tanımlı", () => {
    expect(Object.keys(CONTACT_RULES.defaultOutcome).sort()).toEqual(
      ["call", "email", "whatsapp", "meeting", "proposal_sent", "site_visit", "other"].sort(),
    );
    expect(Object.keys(CONTACT_RULES.nextAfterDays).sort()).toEqual([...ACTIVITY_OUTCOMES].sort());
    expect(CONTACT_RULES.defaultOutcome.meeting).toBe("reply_received");
    expect(CONTACT_RULES.defaultOutcome.whatsapp).toBe("awaiting_reply");
  });
});
