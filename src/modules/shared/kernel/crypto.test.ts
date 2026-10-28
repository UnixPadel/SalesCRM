import { describe, expect, it, vi } from "vitest";
import { createAesGcmCipher, generateKeyBase64, hmacSha256Hex, plainTextCipher, safeEqual } from "./crypto";
import { loadConfig } from "./config";
import { createScheduler } from "./scheduler";
import { silentLogger } from "./logger";

describe("AES-256-GCM payload zarfı", () => {
  const key = generateKeyBase64();
  it("şifreler ve aynı anahtarla açar; zarf düz metni içermez", () => {
    const c = createAesGcmCipher(key);
    const env = c.encrypt('{"email":"ayse@example.com"}');
    expect(env.startsWith("v1.")).toBe(true);
    expect(env).not.toContain("ayse");
    expect(c.decrypt(env)).toBe('{"email":"ayse@example.com"}');
  });
  it("her şifreleme farklı iv kullanır", () => {
    const c = createAesGcmCipher(key);
    expect(c.encrypt("a")).not.toBe(c.encrypt("a"));
  });
  it("başka anahtar veya bozuk zarf açılmaz", () => {
    const env = createAesGcmCipher(key).encrypt("gizli");
    expect(() => createAesGcmCipher(generateKeyBase64()).decrypt(env)).toThrow();
    expect(() => createAesGcmCipher(key).decrypt(env.slice(0, -2) + "AA")).toThrow();
    expect(() => createAesGcmCipher(key).decrypt("v0.x.y.z")).toThrow(/zarf/);
  });
  it("anahtar 32 bayt değilse açılışta hata", () => {
    expect(() => createAesGcmCipher(Buffer.from("kisa").toString("base64"))).toThrow(/32 bayt/);
  });
  it("düz metin zarfı (yerel geliştirme) gidip gelir", () => {
    expect(plainTextCipher.decrypt(plainTextCipher.encrypt("{}"))).toBe("{}");
    expect(() => plainTextCipher.decrypt("v1.a.b.c")).toThrow();
  });
});

describe("HMAC ve sabit zamanlı karşılaştırma", () => {
  it("sha256 hex imza üretir", () => {
    expect(hmacSha256Hex("secret", "body")).toMatch(/^[0-9a-f]{64}$/);
    expect(hmacSha256Hex("secret", Buffer.from("body"))).toBe(hmacSha256Hex("secret", "body"));
  });
  it("safeEqual: eşit → true; farklı içerik veya uzunluk → false", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual("", "")).toBe(true);
  });
});

describe("config: Faz 2 alanları", () => {
  it("varsayılanlar", () => {
    const c = loadConfig({});
    expect(c.intake).toEqual({
      pollSeconds: 5,
      retryMinutes: [1, 5, 30, 120, 720],
      backfillIntervalMinutes: 60,
      backfillLookbackHours: 2,
      retentionDays: 30,
      defaultCountry: "TR",
    });
    expect(c.smtp.host).toBe("");
    expect(c.smtp.port).toBe(465);
    expect(c.publicBaseUrl).toBe("");
  });
  it("ortamdan okur; bozuk liste varsayılana döner; sondaki / atılır", () => {
    const c = loadConfig({
      INTAKE_RETRY_MINUTES: "2,x,4",
      INTAKE_DEFAULT_COUNTRY: "de",
      PUBLIC_BASE_URL: "https://crm.example.com/",
      SMTP_SECURE: "0",
    });
    expect(c.intake.retryMinutes).toEqual([2, 4]);
    expect(loadConfig({ INTAKE_RETRY_MINUTES: "x" }).intake.retryMinutes).toEqual([1, 5, 30, 120, 720]);
    expect(c.intake.defaultCountry).toBe("DE");
    expect(c.publicBaseUrl).toBe("https://crm.example.com");
    expect(c.smtp.secure).toBe(false);
  });
});

describe("zamanlayıcı", () => {
  it("aralıkla koşar, çakışmaz, hata durdurmaz, runNow bekler", async () => {
    vi.useFakeTimers();
    let runs = 0;
    let concurrent = 0;
    let maxConcurrent = 0;
    const job = {
      name: "j",
      everyMs: 100,
      async run() {
        concurrent += 1;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        runs += 1;
        if (runs === 2) {
          concurrent -= 1;
          throw new Error("boom");
        }
        await new Promise((r) => setTimeout(r, 250));
        concurrent -= 1;
      },
    };
    const s = createScheduler([job], silentLogger);
    s.start();
    expect(s.running()).toBe(true);
    await vi.advanceTimersByTimeAsync(100); // 1. koşu başlar (250 ms sürer)
    await vi.advanceTimersByTimeAsync(100); // 2. tik: hâlâ çalışıyor → atlanır
    await vi.advanceTimersByTimeAsync(200); // 1. biter; 3. tik → 2. koşu (hata)
    await vi.advanceTimersByTimeAsync(100); // 3. koşu
    expect(runs).toBeGreaterThanOrEqual(3);
    expect(maxConcurrent).toBe(1);
    s.stop();
    expect(s.running()).toBe(false);
    await expect(s.runNow("yok")).rejects.toThrow(/iş yok/);
    vi.useRealTimers();
  });
});
