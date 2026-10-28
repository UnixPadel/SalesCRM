import { describe, expect, it } from "vitest";
import { FixedClock, MINUTE } from "./clock";
import { loadConfig, readSecret } from "./config";
import { NotFoundError, PermanentError, RuleError, TransientError, isAppError } from "./errors";
import { SequentialIdGenerator, isUuid, uuidGenerator } from "./id";
import { createLogger, maskEmail, maskFields, maskPhone, maskText } from "./logger";
import { Money } from "./money";
import { all, err, flatMap, map, ok, unwrap } from "./result";

describe("Result", () => {
  it("map ve flatMap yalnız başarıda çalışır", () => {
    expect(map(ok(2), (n) => n * 2)).toEqual(ok(4));
    expect(map(err("x"), (n: number) => n * 2)).toEqual(err("x"));
    expect(flatMap(ok(2), (n) => (n > 1 ? ok("büyük") : err("küçük")))).toEqual(ok("büyük"));
  });
  it("all ilk hatayı döner", () => {
    expect(all([ok(1), ok(2)])).toEqual(ok([1, 2]));
    expect(all([ok(1), err("a"), err("b")])).toEqual(err("a"));
  });
  it("unwrap hatada fırlatır", () => {
    expect(unwrap(ok(1))).toBe(1);
    expect(() => unwrap(err(new Error("boom")))).toThrow("boom");
    expect(() => unwrap(err("düz"))).toThrow("düz");
  });
});

describe("hata türleri", () => {
  it("kind alanı üç türü ayırır", () => {
    expect(new RuleError("c", "m").kind).toBe("rule");
    expect(new TransientError("c", "m").kind).toBe("transient");
    expect(new PermanentError("c", "m").kind).toBe("permanent");
    expect(new NotFoundError("Lead", "1").code).toBe("not_found");
    expect(isAppError(new RuleError("c", "m"))).toBe(true);
    expect(isAppError(new Error("x"))).toBe(false);
  });
  it("cause taşır", () => {
    const e = new TransientError("net", "ağ", {}, new Error("inner"));
    expect((e.cause as Error).message).toBe("inner");
  });
});

describe("Clock ve Id", () => {
  it("FixedClock ilerletilir ve kopya döner", () => {
    const c = new FixedClock("2026-01-01T00:00:00Z");
    const a = c.now();
    a.setFullYear(1999);
    expect(c.now().toISOString()).toBe("2026-01-01T00:00:00.000Z");
    c.advance(10 * MINUTE);
    expect(c.now().toISOString()).toBe("2026-01-01T00:10:00.000Z");
    c.set("2026-02-01T00:00:00Z");
    expect(c.now().getUTCMonth()).toBe(1);
  });
  it("kimlikler", () => {
    const g = new SequentialIdGenerator("lead");
    expect(g.next()).toBe("lead-0001");
    expect(g.next()).toBe("lead-0002");
    expect(isUuid(uuidGenerator.next())).toBe(true);
    expect(isUuid("lead-0001")).toBe(false);
  });
});

describe("Money", () => {
  it("doğrular ve yuvarlar", () => {
    const m = unwrap(Money.create(1234.567, " eur "));
    expect(m.amount).toBe(1234.57);
    expect(m.currency).toBe("EUR");
    expect(m.toJSON()).toEqual({ amount: 1234.57, currency: "EUR" });
    expect(m.equals(unwrap(Money.create(1234.57, "EUR")))).toBe(true);
  });
  it("geçersiz girdiyi reddeder", () => {
    expect(Money.create(-1, "EUR").ok).toBe(false);
    expect(Money.create(Number.NaN, "EUR").ok).toBe(false);
    expect(Money.create(1, "euro").ok).toBe(false);
    const r = Money.create(1, "");
    expect(!r.ok && r.error.code).toBe("money.currency_invalid");
  });
});

describe("config", () => {
  it("varsayılanlar ve env", () => {
    const c = loadConfig({});
    expect(c.undoWindowMinutes).toBe(10);
    expect(c.dispatchDelayMinutes).toBe(10);
    expect(c.enabledProviders).toEqual([]);
    const d = loadConfig({ UNDO_WINDOW_MINUTES: "5", ENABLED_PROVIDERS: "meta, google", DATABASE_URL: "postgres://x" });
    expect(d.undoWindowMinutes).toBe(5);
    expect(d.dispatchDelayMinutes).toBe(5);
    expect(d.enabledProviders).toEqual(["meta", "google"]);
    expect(d.databaseUrl).toBe("postgres://x");
    expect(loadConfig({ UNDO_WINDOW_MINUTES: "abc" }).undoWindowMinutes).toBe(10);
  });
  it("secret adıyla okunur", () => {
    expect(readSecret("X", { X: "v" })).toBe("v");
    expect(readSecret("Y", {})).toBe("");
  });
});

describe("logger maskeleme (kural 9)", () => {
  it("e-posta ve telefon maskelenir", () => {
    expect(maskEmail("ahmet.yilmaz@example.com")).toBe("a***@example.com");
    expect(maskEmail("bozuk")).toBe("***");
    expect(maskPhone("+90 532 123 45 67")).toBe("+***67");
    expect(maskPhone("12")).toBe("***");
    expect(maskText("ara: +905321234567 yaz: a@b.co")).toBe("ara: +***67 yaz: a***@b.co");
  });
  it("alan adına göre tam, değere göre kalıp maskeleme; iç içe nesne", () => {
    const out = maskFields({
      email: "x@y.com",
      phone: "+905321234567",
      token: "abc",
      note: "müşteri x@y.com yazdı",
      leadId: "lead-1",
      nested: { telefon: "0532", safe: 1 },
      error: new Error("ulaşılamadı: a@b.co"),
    });
    expect(out).toMatchObject({
      email: "x***@y.com",
      phone: "+***67",
      token: "***",
      note: "müşteri x***@y.com yazdı",
      leadId: "lead-1",
      nested: { telefon: "***32", safe: 1 },
      error: { name: "Error", message: "ulaşılamadı: a***@b.co" },
    });
  });
  it("sink JSON satırı alır, child alanları taşır", () => {
    const lines: Record<string, unknown>[] = [];
    const log = createLogger(
      { app: "crm" },
      (l) => lines.push(l),
      () => new Date("2026-01-01T00:00:00Z"),
    ).child({
      correlationId: "c-1",
    });
    log.info("lead geldi", { leadId: "l-1", email: "p@q.com" });
    log.error("hata");
    expect(lines[0]).toEqual({
      level: "info",
      msg: "lead geldi",
      time: "2026-01-01T00:00:00.000Z",
      app: "crm",
      correlationId: "c-1",
      leadId: "l-1",
      email: "p***@q.com",
    });
    expect(lines[1]).toMatchObject({ level: "error", msg: "hata" });
  });
});
