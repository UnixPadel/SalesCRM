// Faz 7g (iş emri §3.3.5): veri uyarıları için `valid` ve `callingCode`. Numaralar sentetiktir.
import { describe, expect, it } from "vitest";
import { unwrap } from "../kernel";
import { PhoneNumber } from "./phone";

describe("PhoneNumber.valid ve callingCode", () => {
  it.each([
    ["+905320000001", "TR", true, "90"],
    ["+447400123456", "GB", true, "44"],
    ["+12045550123", "CA", true, "1"],
    ["+12125550123", "US", true, "1"],
    ["+4915100000001", "DE", true, "49"],
  ])("%s → ülke %s, geçerli %s, arama kodu %s", (raw, country, valid, code) => {
    const p = unwrap(PhoneNumber.parse(raw));
    expect([p.country, p.valid, p.callingCode]).toEqual([country, valid, code]);
  });

  it("olası uzunlukta ama plana uymayan numara kaydedilir, valid false", () => {
    const p = unwrap(PhoneNumber.parse("+901111111111"));
    expect(p.e164).toBe("+901111111111");
    expect(p.valid).toBe(false);
    expect(p.callingCode).toBe("90");
  });

  it("varsayılan ülkeyle çözülen yerel numaranın arama kodu ülkeninki", () => {
    expect(unwrap(PhoneNumber.parse("0532 000 00 01", "TR")).callingCode).toBe("90");
  });
});

describe("PhoneNumber.callingCodeFor", () => {
  it.each([
    ["TR", "90"],
    ["tr", "90"],
    [" GB ", "44"],
    ["US", "1"],
    ["CA", "1"],
    ["XK", "383"],
  ])("%j → %s", (cc, code) => {
    expect(PhoneNumber.callingCodeFor(cc)).toBe(code);
  });

  it.each(["FX", "XX", "TUR", "", null, undefined])("%j → null (bilinmeyen ya da biçimsiz)", (cc) => {
    expect(PhoneNumber.callingCodeFor(cc)).toBeNull();
  });
});
