import { describe, expect, it } from "vitest";
import { unwrap } from "../kernel";
import { Email } from "./email";
import { PhoneNumber } from "./phone";

describe("Email", () => {
  it("kırpar ve küçük harfe çevirir", () => {
    const e = unwrap(Email.parse("  Ahmet.Yilmaz@Example.COM "));
    expect(e.value).toBe("ahmet.yilmaz@example.com");
    expect(e.domain).toBe("example.com");
    expect(e.equals(unwrap(Email.parse("ahmet.yilmaz@example.com")))).toBe(true);
    expect(String(e)).toBe("ahmet.yilmaz@example.com");
  });
  it.each(["", "   ", "bozuk", "a@b", "a b@c.com", "a@@b.com", "@x.com"])("reddeder: %j", (raw) => {
    const r = Email.parse(raw);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.code).toBe("email.invalid");
  });
  it("Gmail noktalarını korur (platform normalleştirmesi burada değil)", () => {
    expect(Email.normalize("A.B@gmail.com")).toBe("a.b@gmail.com");
  });
});

describe("PhoneNumber (E.164)", () => {
  it.each([
    ["+90 532 123 45 67", undefined, "+905321234567", "TR"],
    ["0532 123 45 67", "TR", "+905321234567", "TR"],
    ["05321234567", "tr", "+905321234567", "TR"],
    ["+44 7759 720037", undefined, "+447759720037", "GB"],
    ["07759 720037", "GB", "+447759720037", "GB"],
    ["+49 151 23456789", undefined, "+4915123456789", "DE"],
    ["(555) 123-4567", "US", "+15551234567", "US"],
  ])("%s (%s) → %s", (raw, country, e164, cc) => {
    const p = unwrap(PhoneNumber.parse(raw, country));
    expect(p.e164).toBe(e164);
    expect(p.country).toBe(cc);
  });
  it("Meta için yalnız rakam", () => {
    expect(unwrap(PhoneNumber.parse("+90 532 123 45 67")).digits).toBe("905321234567");
  });
  it("ülke kodu yoksa ve varsayılan ülke yoksa reddeder", () => {
    const r = PhoneNumber.parse("0532 123 45 67");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.code).toBe("phone.invalid");
  });
  it.each(["", "   ", "abc", "+90 1", "123"])("reddeder: %j", (raw) => {
    expect(PhoneNumber.parse(raw, "TR").ok).toBe(false);
  });
  it("eşitlik E.164 üzerinden", () => {
    const a = unwrap(PhoneNumber.parse("+905321234567"));
    const b = unwrap(PhoneNumber.parse("0532 123 45 67", "TR"));
    expect(a.equals(b)).toBe(true);
    expect(String(a)).toBe("+905321234567");
  });
});
