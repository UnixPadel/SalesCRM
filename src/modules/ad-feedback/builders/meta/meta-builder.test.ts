import { describe, expect, it } from "vitest";
import type { OutboundStageEvent } from "../../../sales-pipeline/application";
import {
  buildMetaEvent,
  hasMatchKey,
  hashEmailForMeta,
  hashPhoneForMeta,
  isValidMetaLeadId,
  metaEventInputFrom,
  normalizeEmailForMeta,
  normalizePhoneForMeta,
  serializeMetaBatch,
} from "./index";

const AT = new Date("2026-03-01T10:00:00Z"); // 1772359200

describe("Meta normalleştirme ve SHA-256 (bilinen değerler)", () => {
  it("e-posta: küçük harf, boşluksuz; sha256('test@example.com') bilinen değer", () => {
    expect(normalizeEmailForMeta("  Test@Example.COM ")).toBe("test@example.com");
    expect(normalizeEmailForMeta("te st@example.com")).toBe("test@example.com");
    expect(normalizeEmailForMeta("yok")).toBeNull();
    expect(normalizeEmailForMeta(null)).toBeNull();
    expect(hashEmailForMeta("Test@Example.com")).toBe(
      "973dfe463ec85785f5f95af5ba3906eedb2d931c24e69824a89ea65dba4e813b",
    );
  });

  it("telefon: yalnız rakam, ülke kodu dahil, + yok; bilinen hash değerleri", () => {
    expect(normalizePhoneForMeta("+90 532 123 45 67")).toBe("905321234567");
    expect(normalizePhoneForMeta("+1 (415) 555-2671")).toBe("14155552671");
    expect(normalizePhoneForMeta("00905321234567")).toBe("905321234567");
    expect(normalizePhoneForMeta("12345")).toBeNull();
    expect(normalizePhoneForMeta("")).toBeNull();
    expect(hashPhoneForMeta("+905321234567")).toBe("7e3308159fc7cca243cef8a01acc25f18cd62d0d1ad92a6d38c3107d9aa3d8cc");
    expect(hashPhoneForMeta("+14155552671")).toBe("758fbf68945f21c416814c539ab578876c8d98fb69e6da692def92cd52417fe0");
  });

  it("lead_id: yalnız rakam, 64-bit sınırı", () => {
    expect(isValidMetaLeadId("1234567890123456")).toBe(true);
    expect(isValidMetaLeadId("18446744073709551615")).toBe(true);
    expect(isValidMetaLeadId("18446744073709551616")).toBe(false);
    expect(isValidMetaLeadId("0123")).toBe(false);
    expect(isValidMetaLeadId("abc")).toBe(false);
    expect(isValidMetaLeadId(null)).toBe(false);
  });
});

describe("buildMetaEvent (snapshot)", () => {
  it("Meta formu lead'i, NEW: system_generated, lead_id, em+ph hash, custom_data zorunlu alanlar", () => {
    const e = buildMetaEvent({
      eventName: "Yeni Lead",
      occurredAt: AT,
      leadId: "1234567890123456",
      actionSource: "system_generated",
      email: "Ayse@Example.com",
      phone: "+905321234567",
      eventId: "evt-1",
    });
    expect(e).toMatchSnapshot();
    expect(e.event_time).toBe(1772359200);
    expect(hasMatchKey(e)).toBe(true);
  });

  it("WON: value ve currency (büyük harf) custom_data'da", () => {
    const e = buildMetaEvent({
      eventName: "Kazanıldı",
      occurredAt: AT,
      leadId: "1234567890123456",
      actionSource: "system_generated",
      email: null,
      phone: "+905321234567",
      value: { amount: 185000, currency: "eur" },
    });
    expect(e).toMatchSnapshot();
    expect(e.custom_data).toMatchObject({ value: 185000, currency: "EUR" });
    expect(e.user_data.em).toBeUndefined();
  });

  it("web formu lead'i: website, lead_id yok, fbc/fbp ve event_source_url", () => {
    const e = buildMetaEvent({
      eventName: "Nitelikli Lead",
      occurredAt: AT,
      leadId: "ignored-for-website",
      actionSource: "website",
      email: "hans@mueller.de",
      phone: null,
      fbc: "fb.1.1709280000000.IwAR-x",
      fbp: "fb.1.1709270000000.1234567890",
      eventSourceUrl: "https://www.example.com/iletisim",
    });
    expect(e).toMatchSnapshot();
    expect(e.user_data.lead_id).toBeUndefined();
    expect(e.event_source_url).toBe("https://www.example.com/iletisim");
  });

  it("eşleştirme anahtarı yoksa hasMatchKey false", () => {
    const e = buildMetaEvent({
      eventName: "Yeni Lead",
      occurredAt: AT,
      leadId: "abc",
      actionSource: "system_generated",
      email: null,
      phone: "123",
    });
    expect(hasMatchKey(e)).toBe(false);
  });
});

describe("serializeMetaBatch: 64-bit lead_id sayı olarak, hassasiyet kaybı yok", () => {
  const big = buildMetaEvent({
    eventName: "Yeni Lead",
    occurredAt: AT,
    leadId: "18446744073709551615",
    actionSource: "system_generated",
    email: "a@b.co",
    phone: null,
  });
  const web = buildMetaEvent({
    eventName: "Yeni Lead",
    occurredAt: AT,
    leadId: null,
    actionSource: "website",
    email: "a@b.co",
    phone: null,
    fbp: "fb.1.2.3",
  });

  it("JSON.rawJSON ile: sayı değişmeden yazılır; test_event_code yalnız verilince", () => {
    const json = serializeMetaBatch([big, web], { testEventCode: "TEST123" });
    expect(json).toContain('"lead_id":18446744073709551615,');
    expect(json).not.toContain('"lead_id":"');
    expect(json).toContain('"test_event_code":"TEST123"');
    expect(JSON.parse(json).data).toHaveLength(2);
    expect(serializeMetaBatch([web])).not.toContain("test_event_code");
  });

  it("rawJSON yokken yer tutucu değişimi aynı sonucu verir", () => {
    const withNative = serializeMetaBatch([big, big, web]);
    const fallback = serializeMetaBatch([big, big, web], { rawJson: null });
    expect(fallback).toBe(withNative);
    expect(fallback).not.toContain("__META_LEAD_ID_");
    expect((fallback.match(/"lead_id":18446744073709551615,/g) ?? []).length).toBe(2);
  });

  it("snapshot: iki olaylık gövde", () => {
    expect(serializeMetaBatch([big, web], { testEventCode: "TEST123" })).toMatchSnapshot();
  });
});

describe("metaEventInputFrom (sales-pipeline bağlamı)", () => {
  const base: OutboundStageEvent = {
    stageEventId: "evt-9",
    leadId: "lead-9",
    stageCode: "WON",
    occurredAt: AT,
    undoneAt: null,
    origin: "manual",
    value: { amount: 1000, currency: "EUR" },
    lead: {
      source: "meta_form",
      platformLeadId: "555000001",
      email: "ayse@example.com",
      phoneE164: "+905321234567",
      isTest: false,
      country: "TR",
    },
    attribution: null,
    consents: [],
  };

  it("Meta formu: system_generated + lead_id; WON tutarı taşınır; event_id = aşama olayı", () => {
    expect(metaEventInputFrom(base, "Kazanıldı")).toEqual({
      eventName: "Kazanıldı",
      occurredAt: AT,
      leadId: "555000001",
      actionSource: "system_generated",
      email: "ayse@example.com",
      phone: "+905321234567",
      fbc: null,
      fbp: null,
      eventSourceUrl: null,
      value: { amount: 1000, currency: "EUR" },
      eventId: "evt-9",
    });
  });

  it("web formu: website, lead_id yok, fbc/fbp ve landing_url; WON dışı aşamada value yok", () => {
    const web: OutboundStageEvent = {
      ...base,
      stageCode: "QUALIFIED",
      lead: { ...base.lead, source: "web_form", platformLeadId: "sub-1" },
      attribution: {
        gclid: null,
        gbraid: null,
        wbraid: null,
        fbclid: "F1",
        fbc: "fb.1.1.F1",
        fbp: "fb.1.2.3",
        utmSource: null,
        utmMedium: null,
        utmCampaign: null,
        utmTerm: null,
        utmContent: null,
        landingUrl: "https://www.example.com/x",
        clickAt: null,
      },
    };
    expect(metaEventInputFrom(web, "Nitelikli Lead")).toMatchObject({
      leadId: null,
      actionSource: "website",
      fbc: "fb.1.1.F1",
      fbp: "fb.1.2.3",
      eventSourceUrl: "https://www.example.com/x",
      value: null,
    });
  });
});
