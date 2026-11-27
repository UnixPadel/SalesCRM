import { describe, expect, it } from "vitest";
import { isInternalAddress, messageKey, recipientsOf, toStoredMessage } from "./message";
import { parseWeek, shiftWeek, weekOf, weekRangeOf } from "./week";

describe("rapor haftası (Pazartesi–Pazar, İstanbul)", () => {
  it("ISO hafta anahtarı", () => {
    expect(weekOf(new Date("2026-11-27T12:00:00Z"))).toBe("2026-W48");
    expect(weekOf(new Date("2024-12-30T12:00:00Z"))).toBe("2025-W01");
    // 2026 Perşembe başlar: 53 haftalık yıl; 1 Ocak 2027 Cuma hâlâ 2026'nın 53. haftasıdır.
    expect(weekOf(new Date("2027-01-01T12:00:00Z"))).toBe("2026-W53");
    expect(weekOf(new Date("2027-01-04T12:00:00Z"))).toBe("2027-W01");
  });

  it("sınır İstanbul saatine göre: Pazar 23:30 bu hafta, Pazartesi 00:10 sonraki hafta", () => {
    expect(weekOf(new Date("2026-11-29T20:30:00Z"))).toBe("2026-W48"); // Pazar 23:30 TSİ
    expect(weekOf(new Date("2026-11-29T21:10:00Z"))).toBe("2026-W49"); // Pazartesi 00:10 TSİ
    // UTC'de hâlâ Pazar ama İstanbul'da Pazartesi 00:30.
    expect(weekOf(new Date("2026-11-22T21:30:00Z"))).toBe("2026-W48");
  });

  it("hafta aralığı: Pazartesi 00:00 TSİ (dahil) – sonraki Pazartesi 00:00 TSİ (hariç)", () => {
    const w = parseWeek("2026-W48")!;
    expect(w.start.toISOString()).toBe("2026-11-22T21:00:00.000Z");
    expect(w.end.toISOString()).toBe("2026-11-29T21:00:00.000Z");
    expect(weekRangeOf(new Date("2026-11-25T10:00:00Z"))).toEqual(w);
    expect(parseWeek(" 2026-W53 ")?.key).toBe("2026-W53");
  });

  it("geçersiz anahtar null", () => {
    for (const k of ["", "abc", "2026W48", "2026-W00", "2026-W54", "2025-W53"]) expect(parseWeek(k)).toBeNull();
  });

  it("hafta kaydırma yıl sınırını geçer", () => {
    expect(shiftWeek(parseWeek("2026-W48")!, 1).key).toBe("2026-W49");
    expect(shiftWeek(parseWeek("2026-W01")!, -1).key).toBe("2025-W52");
    expect(shiftWeek(parseWeek("2026-W53")!, 1).key).toBe("2027-W01");
  });
});

describe("ileti → kayıt", () => {
  it("anahtar Message-ID; yoksa klasör sürümü + UID", () => {
    expect(messageKey({ uid: 7, messageId: " <a@b> " }, "99")).toBe("<a@b>");
    expect(messageKey({ uid: 7, messageId: null }, "99")).toBe("uid:99:7");
    expect(messageKey({ uid: 7, messageId: "  " }, "99")).toBe("uid:99:7");
  });

  it("alıcılar normalleşir, tekrarlanan adres ilk alanında kalır, adressiz grup atlanır", () => {
    expect(
      recipientsOf({
        to: [" Ali@Example.com ", "veli@example.com"],
        cc: ["ali@example.com", "undisclosed-recipients"],
        bcc: ["satis@unixpadel.com", "VELI@example.com"],
      }),
    ).toEqual([
      { address: "ali@example.com", kind: "to" },
      { address: "veli@example.com", kind: "to" },
      { address: "satis@unixpadel.com", kind: "bcc" },
    ]);
  });

  it("tarihsiz ya da bozuk tarihli ileti taranma anına yazılır", () => {
    const now = new Date("2026-11-27T10:00:00Z");
    const base = { uid: 1, messageId: null, to: ["a@b.co"], cc: [], bcc: [] };
    expect(toStoredMessage({ ...base, sentAt: null }, "1", now).sentAt).toBe(now);
    expect(toStoredMessage({ ...base, sentAt: new Date("x") }, "1", now).sentAt).toBe(now);
    const at = new Date("2026-11-20T08:00:00Z");
    expect(toStoredMessage({ ...base, sentAt: at }, "1", now)).toEqual({
      key: "uid:1:1",
      sentAt: at,
      uid: 1,
      recipients: [{ address: "a@b.co", kind: "to" }],
    });
  });

  it("şirket içi adres", () => {
    expect(isInternalAddress("Yusa@UnixPadel.com", "unixpadel.com")).toBe(true);
    expect(isInternalAddress("x@notunixpadel.com", "unixpadel.com")).toBe(false);
  });
});
