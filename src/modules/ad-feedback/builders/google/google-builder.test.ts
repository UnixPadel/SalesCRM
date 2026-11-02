import { describe, expect, it } from "vitest";
import type { OutboundStageEvent } from "../../../sales-pipeline/application";
import { hashPhoneForMeta } from "../meta";
import {
  buildGoogleEvent,
  buildGoogleRequest,
  checkUploadWindow,
  formatRfc3339,
  googleEventInputFrom,
  hasGoogleMatchKey,
  hashEmailForGoogle,
  hashPhoneForGoogle,
  normalizeEmailForGoogle,
  normalizePhoneForGoogle,
  timeZoneOffsetMinutes,
} from "./index";

const AT = new Date("2026-03-01T10:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

describe("Google normalleştirme (resmi kılavuz örnekleri) ve SHA-256", () => {
  it("e-posta: gmail/googlemail'de noktalar ve + sonrası silinir; diğer alan adlarında korunur; boşluklar silinir", () => {
    expect(normalizeEmailForGoogle("cloudy.sanfrancisco+shopping@gmail.com")).toBe("cloudysanfrancisco@gmail.com");
    expect(normalizeEmailForGoogle("Cloudy.San.Francisco@GoogleMail.com")).toBe("cloudysanfrancisco@googlemail.com");
    expect(normalizeEmailForGoogle("user.name+NYC@Example.com")).toBe("user.name+nyc@example.com");
    expect(normalizeEmailForGoogle("  ay se@ example.com ")).toBe("ayse@example.com");
    expect(normalizeEmailForGoogle("yok")).toBeNull();
    expect(normalizeEmailForGoogle("+tag@gmail.com")).toBeNull();
    expect(normalizeEmailForGoogle(null)).toBeNull();
  });

  it("telefon: E.164, + dahil; (800)555-0100 → +18005550100; 00 öneki ve baştaki sıfırlar", () => {
    expect(normalizePhoneForGoogle("(800)555-0100")).toBe("+8005550100");
    expect(normalizePhoneForGoogle("+1 (800) 555-0100")).toBe("+18005550100");
    expect(normalizePhoneForGoogle("+905321234567")).toBe("+905321234567");
    expect(normalizePhoneForGoogle("0090 532 123 45 67")).toBe("+905321234567");
    expect(normalizePhoneForGoogle("12345")).toBeNull();
    expect(normalizePhoneForGoogle("")).toBeNull();
  });

  it("hash değerleri sabit (Google çıktı örneği yayımlamaz; girdi örnekleri kılavuzdan, özetler bağımsız hesaplandı)", () => {
    expect(hashEmailForGoogle("cloudy.sanfrancisco+shopping@gmail.com")).toBe(
      "223ebda6f6889b1494551ba902d9d381daf2f642bae055888e96343d53e9f9c4",
    );
    expect(hashEmailForGoogle("user.name+NYC@Example.com")).toBe(
      "f109a2a632fbcea5fc82049f50beed3d8621bf9034399f437fb622222acccdac",
    );
    expect(hashPhoneForGoogle("+1 (800) 555-0100")).toBe(
      "fb4f73a6ec5fdb7077d564cdd22c3554b43ce49168550c3b12c547b78c517b30",
    );
    expect(hashPhoneForGoogle("+905321234567")).toBe(
      "57c4176feab36c8b2d9536954c377aee3fa760184cbdb9c3a431fbc707817386",
    );
  });

  it("aynı telefon için Meta ve Google hash'leri farklı (Meta + istemez, Google ister)", () => {
    const phone = "+90 532 123 45 67";
    const meta = hashPhoneForMeta(phone);
    const google = hashPhoneForGoogle(phone);
    expect(meta).toBe("7e3308159fc7cca243cef8a01acc25f18cd62d0d1ad92a6d38c3107d9aa3d8cc");
    expect(google).toBe("57c4176feab36c8b2d9536954c377aee3fa760184cbdb9c3a431fbc707817386");
    expect(meta).not.toBe(google);
  });
});

describe("yükleme penceresi: 89, 90 ve 91. gün", () => {
  const base = { occurredAt: AT, leadCreatedAt: null, clickWindowDays: 90, userDataWindowDays: 63 };
  const at = (days: number) => new Date(AT.getTime() + days * DAY);

  it("tıklama kimliğiyle 90 gün: 89 ve 90 geçerli, 91 expired", () => {
    expect(checkUploadWindow({ ...base, now: at(89), clickAt: AT, hasClickId: true })).toMatchObject({
      expired: false,
      ageDays: 89,
      windowDays: 90,
    });
    expect(checkUploadWindow({ ...base, now: at(90), clickAt: AT, hasClickId: true })).toMatchObject({
      expired: false,
      ageDays: 90,
    });
    expect(checkUploadWindow({ ...base, now: at(91), clickAt: AT, hasClickId: true })).toMatchObject({
      expired: true,
      ageDays: 91,
    });
  });

  it("yalnız e-posta/telefon 63 gün; taban: tıklama yoksa lead oluşturma, o da yoksa aşama zamanı", () => {
    const created = new Date(AT.getTime() - 10 * DAY);
    expect(
      checkUploadWindow({ ...base, now: at(53), clickAt: null, leadCreatedAt: created, hasClickId: false }),
    ).toMatchObject({ expired: false, ageDays: 63, basis: created });
    expect(
      checkUploadWindow({ ...base, now: at(54), clickAt: null, leadCreatedAt: created, hasClickId: false }),
    ).toMatchObject({ expired: true, ageDays: 64 });
    expect(
      checkUploadWindow({ ...base, now: at(1), clickAt: null, leadCreatedAt: null, hasClickId: false }).basis,
    ).toEqual(AT);
  });
});

describe("RFC 3339 ve saat dilimi", () => {
  it("Istanbul +03:00, New York yaz saati −04:00, UTC Z yerine +00:00", () => {
    expect(timeZoneOffsetMinutes(AT, "Europe/Istanbul")).toBe(180);
    expect(formatRfc3339(AT, "Europe/Istanbul")).toBe("2026-03-01T13:00:00.000+03:00");
    expect(formatRfc3339(new Date("2025-08-08T17:18:44.291Z"), "America/New_York")).toBe(
      "2025-08-08T13:18:44.291-04:00",
    );
    expect(formatRfc3339(AT, "UTC")).toBe("2026-03-01T10:00:00.000+00:00");
  });
});

describe("buildGoogleEvent / buildGoogleRequest (snapshot)", () => {
  it("Nitelikli: gclid + hash'li e-posta/telefon, Istanbul zamanı, onay verildi", () => {
    const e = buildGoogleEvent({
      conversionActionId: "123456789",
      transactionId: "evt-1",
      occurredAt: AT,
      timeZone: "Europe/Istanbul",
      eventSource: "WEB",
      email: "Ayse.Demir@Gmail.com",
      phone: "+905321234567",
      gclid: "Cj0KCQjw-test",
    });
    expect(e).toMatchSnapshot();
    expect(hasGoogleMatchKey(e)).toBe(true);
    expect(e.userData?.userIdentifiers).toHaveLength(2);
  });

  it("Kazanıldı: değer ve para birimi; yalnız telefon; gbraid", () => {
    const e = buildGoogleEvent({
      conversionActionId: "987654321",
      transactionId: "evt-2",
      occurredAt: AT,
      timeZone: "Europe/Istanbul",
      eventSource: "WEB",
      email: null,
      phone: "+905321234567",
      gbraid: "gbraid-1",
      value: { amount: 185000, currency: "eur" },
    });
    expect(e).toMatchSnapshot();
    expect(e).toMatchObject({ conversionValue: 185000, currency: "EUR", adIdentifiers: { gbraid: "gbraid-1" } });
  });

  it("eşleştirme anahtarı yoksa hasGoogleMatchKey false; geçersiz gclid atılır", () => {
    const e = buildGoogleEvent({
      conversionActionId: "1",
      transactionId: "t",
      occurredAt: AT,
      timeZone: "UTC",
      eventSource: "WEB",
      email: "yok",
      phone: "12",
      gclid: "bozuk id!",
    });
    expect(hasGoogleMatchKey(e)).toBe(false);
    expect(e.adIdentifiers).toBeUndefined();
    expect(e.userData).toBeUndefined();
  });

  it("istek: dönüşüm işlemi başına hedef, müşteri kimliği tiresiz, loginAccount isteğe bağlı, validateOnly yalnız verilince", () => {
    const a = buildGoogleEvent({
      conversionActionId: "111",
      transactionId: "a",
      occurredAt: AT,
      timeZone: "UTC",
      eventSource: "WEB",
      email: "a@b.co",
      phone: null,
    });
    const b = buildGoogleEvent({
      conversionActionId: "222",
      transactionId: "b",
      occurredAt: AT,
      timeZone: "UTC",
      eventSource: "WEB",
      email: "a@b.co",
      phone: null,
    });
    const c = buildGoogleEvent({
      conversionActionId: "111",
      transactionId: "c",
      occurredAt: AT,
      timeZone: "UTC",
      eventSource: "WEB",
      email: "a@b.co",
      phone: null,
    });
    const req = buildGoogleRequest([a, b, c], {
      customerId: "123-456-7890",
      loginCustomerId: "999-888-7777",
      validateOnly: true,
    });
    expect(req).toMatchSnapshot();
    expect(req.destinations.map((d) => d.reference)).toEqual(["111", "222"]);
    expect(req.destinations[0]).toMatchObject({
      operatingAccount: { accountType: "GOOGLE_ADS", accountId: "1234567890" },
      loginAccount: { accountType: "GOOGLE_ADS", accountId: "9998887777" },
      productDestinationId: "111",
    });
    expect(req.encoding).toBe("HEX");
    expect(req.validateOnly).toBe(true);
    const live = buildGoogleRequest([a], { customerId: "1234567890" });
    expect(live.validateOnly).toBeUndefined();
    expect(live.destinations[0]!.loginAccount).toBeUndefined();
  });
});

describe("googleEventInputFrom", () => {
  const ctx: OutboundStageEvent = {
    stageEventId: "evt-9",
    leadId: "lead-9",
    stageCode: "WON",
    occurredAt: AT,
    undoneAt: null,
    origin: "manual",
    value: { amount: 1000, currency: "EUR" },
    lead: {
      source: "google_form",
      platformLeadId: "g-1",
      email: "ayse@example.com",
      phoneE164: "+905321234567",
      isTest: false,
      country: "TR",
      createdAt: new Date(AT.getTime() - DAY),
    },
    attribution: {
      gclid: "G1",
      gbraid: null,
      wbraid: "W1",
      fbclid: null,
      fbc: null,
      fbp: null,
      utmSource: null,
      utmMedium: null,
      utmCampaign: null,
      utmTerm: null,
      utmContent: null,
      landingUrl: null,
      clickAt: null,
    },
    consents: [],
  };

  it("WON: tutar taşınır, tıklama kimlikleri attribution'dan, transactionId = aşama olayı", () => {
    expect(googleEventInputFrom(ctx, "555", { timeZone: "Europe/Istanbul", eventSource: "WEB" })).toEqual({
      conversionActionId: "555",
      transactionId: "evt-9",
      occurredAt: AT,
      timeZone: "Europe/Istanbul",
      eventSource: "WEB",
      email: "ayse@example.com",
      phone: "+905321234567",
      gclid: "G1",
      gbraid: null,
      wbraid: "W1",
      value: { amount: 1000, currency: "EUR" },
    });
    expect(
      googleEventInputFrom({ ...ctx, stageCode: "QUALIFIED" }, "555", { timeZone: "UTC", eventSource: "OTHER" }).value,
    ).toBeNull();
  });

  it("PROPOSAL: girilen teklif tutarı taşınır, girilmediyse yok", () => {
    const o = { timeZone: "UTC", eventSource: "WEB" as const };
    expect(googleEventInputFrom({ ...ctx, stageCode: "PROPOSAL" }, "444", o).value).toEqual({
      amount: 1000,
      currency: "EUR",
    });
    expect(googleEventInputFrom({ ...ctx, stageCode: "PROPOSAL", value: null }, "444", o).value).toBeNull();
  });
});
