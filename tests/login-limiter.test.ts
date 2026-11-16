import { describe, expect, it } from "vitest";
import { createLoginLimiter } from "../server/loginLimiter.mjs";

const clock = () => {
  let t = 1_000_000;
  return { now: () => t, advance: (ms: number) => (t += ms) };
};

describe("giriş deneme sınırı", () => {
  it("kullanıcı adı başına sınır; pencere dolunca açılır", () => {
    const c = clock();
    const l = createLoginLimiter({ maxPerUser: 3, maxPerIp: 100, windowMs: 60_000, now: c.now });
    for (let i = 0; i < 3; i++) {
      expect(l.retryAfter("ayse", "1.1.1.1")).toBe(0);
      l.fail("ayse", "1.1.1.1");
    }
    expect(l.retryAfter("ayse", "2.2.2.2")).toBe(60); // başka IP'den de kilitli
    expect(l.retryAfter("mehmet", "1.1.1.1")).toBe(0); // başka kullanıcı serbest
    c.advance(30_000);
    expect(l.retryAfter("ayse", "1.1.1.1")).toBe(30);
    c.advance(30_000);
    expect(l.retryAfter("ayse", "1.1.1.1")).toBe(0);
  });

  it("IP başına sınır: farklı kullanıcı adlarını taramak da durur", () => {
    const c = clock();
    const l = createLoginLimiter({ maxPerUser: 100, maxPerIp: 5, windowMs: 60_000, now: c.now });
    for (let i = 0; i < 5; i++) l.fail(`kullanici${i}`, "9.9.9.9");
    expect(l.retryAfter("yeni", "9.9.9.9")).toBeGreaterThan(0);
    expect(l.retryAfter("yeni", "8.8.8.8")).toBe(0);
  });

  it("başarılı giriş kullanıcı sayacını sıfırlar; sweep eski kayıtları siler", () => {
    const c = clock();
    const l = createLoginLimiter({ maxPerUser: 2, maxPerIp: 100, windowMs: 60_000, now: c.now });
    l.fail("ayse", "1.1.1.1");
    l.succeed("ayse");
    l.fail("ayse", "1.1.1.1");
    expect(l.retryAfter("ayse", "1.1.1.1")).toBe(0);
    c.advance(61_000);
    l.sweep();
    expect(l.size()).toBe(0);
  });
});
