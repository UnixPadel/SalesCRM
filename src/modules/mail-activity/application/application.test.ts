import { beforeEach, describe, expect, it, vi } from "vitest";
import { FixedClock, silentLogger } from "../../shared/kernel";
import { FakeLeadMatcher, FakeSentSource, InMemoryMailActivityStore, sent } from "./fakes";
import { errorText, scanSentFolders } from "./scanSentFolders";
import { MailActivityQueries } from "./weeklyReport";

const SATIS = "satis@unixpadel.com";
const EXPORT = "export3@unixpadel.com";
const YUSA = "yusa@unixpadel.com";

let store: InMemoryMailActivityStore;
let source: FakeSentSource;
let clock: FixedClock;
const scan = (mailboxes = [SATIS, EXPORT]) =>
  scanSentFolders({ source, store, mailboxes, clock, backfillWeeks: 12, logger: silentLogger });

beforeEach(() => {
  store = new InMemoryMailActivityStore();
  source = new FakeSentSource();
  clock = new FixedClock("2026-11-27T10:00:00Z");
});

describe("Gönderilmiş klasörü taraması", () => {
  it("ilk tarama son 12 haftayı okur, sonraki tarama yalnız yeni UID'leri", async () => {
    source.folders.set(SATIS, {
      path: "INBOX.Sent",
      uidValidity: "100",
      messages: [sent({ uid: 1 }), sent({ uid: 2 })],
    });
    source.unconfigured.add(EXPORT);
    const first = await scan();
    expect(first).toEqual([
      { mailbox: SATIS, status: "ok", seen: 2, added: 2, reset: true },
      { mailbox: EXPORT, status: "skipped", seen: 0, added: 0, reset: false },
    ]);
    expect(source.calls).toEqual([`${SATIS} since 2026-09-04`]);
    expect(store.scan.get(SATIS)).toMatchObject({ folder: "INBOX.Sent", uidValidity: "100", lastUid: 2 });

    // Yeni ileti yok: IMAP `3:*` son iletiyi (UID 2) yine döndürür; süzülür, iki kez sayılmaz.
    const idle = await scan([SATIS]);
    expect(idle[0]).toMatchObject({ status: "ok", seen: 0, added: 0, reset: false });
    expect(source.calls.at(-1)).toBe(`${SATIS} fromUid 3`);

    source.folders.get(SATIS)!.messages.push(sent({ uid: 5 }));
    const next = await scan([SATIS]);
    expect(next[0]).toMatchObject({ seen: 1, added: 1 });
    expect(store.scan.get(SATIS)?.lastUid).toBe(5);
    expect(store.messages).toHaveLength(3);
  });

  it("UIDVALIDITY değişirse klasör baştan okunur; aynı Message-ID ikinci kez yazılmaz", async () => {
    source.folders.set(SATIS, { path: "Sent", uidValidity: "1", messages: [sent({ uid: 10, messageId: "<x@y>" })] });
    await scan([SATIS]);
    source.folders.set(SATIS, {
      path: "Sent",
      uidValidity: "2",
      messages: [sent({ uid: 1, messageId: "<x@y>" }), sent({ uid: 2, messageId: null })],
    });
    const r = await scan([SATIS]);
    expect(r[0]).toMatchObject({ reset: true, seen: 2, added: 1 });
    expect(store.messages.map((m) => m.key)).toEqual(["<x@y>", "uid:2:2"]);
    expect(store.scan.get(SATIS)).toMatchObject({ uidValidity: "2", lastUid: 2 });
  });

  it("bir hesap hata verirse hata durumuna yazılır, diğerleri devam eder; sonraki başarılı tur hatayı siler", async () => {
    source.failing.set(SATIS, "auth_failed");
    source.folders.set(EXPORT, { path: "Sent", uidValidity: "1", messages: [sent({ uid: 1 })] });
    const r = await scan();
    expect(r.map((x) => [x.mailbox, x.status, x.error])).toEqual([
      [SATIS, "failed", "auth_failed"],
      [EXPORT, "ok", undefined],
    ]);
    expect(store.scan.get(SATIS)).toMatchObject({ lastError: "auth_failed", lastOkAt: null });

    source.failing.delete(SATIS);
    source.folders.set(SATIS, { path: "Sent", uidValidity: "1", messages: [] });
    await scan([SATIS]);
    expect(store.scan.get(SATIS)).toMatchObject({ lastError: null, lastUid: 0 });
  });

  it("hata kaydı da yazılamazsa tur yine biter", async () => {
    const logger = { ...silentLogger, warn: vi.fn(), error: vi.fn() };
    store.failMarkError = true;
    source.failing.set(SATIS, "unreachable");
    const r = await scanSentFolders({ source, store, mailboxes: [SATIS], clock, backfillWeeks: 1, logger });
    expect(r[0]?.status).toBe("failed");
    expect(logger.error).toHaveBeenCalledWith("tarama hatası kaydedilemedi", { error: "db down" });
    expect(errorText("düz metin")).toBe("düz metin");
    expect(errorText(new Error(""))).toBe("unknown");
  });
});

describe("haftalık rapor", () => {
  const queries = () =>
    new MailActivityQueries({
      store,
      matcher: new FakeLeadMatcher({ "ali@kort.com": { leadId: "L1", name: "Ali Kort" } }),
      mailboxes: [SATIS, EXPORT, YUSA],
      configured: (m) => m !== YUSA,
      clock,
      internalDomain: "unixpadel.com",
    });

  beforeEach(async () => {
    source.folders.set(SATIS, {
      path: "Sent",
      uidValidity: "1",
      messages: [
        // Geçen hafta (2026-W47: 16–22 Kasım TSİ)
        sent({ uid: 1, to: ["ali@kort.com"] }, "2026-11-17T08:00:00Z"),
        sent({ uid: 2, to: ["ali@kort.com", "veli@x.com"], cc: ["yusa@unixpadel.com"] }, "2026-11-22T20:30:00Z"),
        sent({ uid: 3, to: ["veli@x.com"] }, "2026-11-19T08:00:00Z"),
        // Bu hafta (Pazartesi 00:10 TSİ)
        sent({ uid: 4, to: ["ali@kort.com"] }, "2026-11-22T21:10:00Z"),
      ],
    });
    source.folders.set(EXPORT, { path: "Sent", uidValidity: "1", messages: [] });
    source.failing.set(YUSA, "auth_failed");
    await scan([SATIS, EXPORT, YUSA]);
  });

  it("varsayılan geçen tamamlanmış hafta; hesap başına sayı, son gönderim, tekil alıcı", async () => {
    const r = await queries().weekly();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const { week, prev, next, mailboxes } = r.value;
    expect([week.key, prev, next]).toEqual(["2026-W47", "2026-W46", "2026-W48"]);
    const [satis, exp, yusa] = mailboxes;
    expect(satis).toMatchObject({
      mailbox: SATIS,
      sent: 3,
      lastSentInWeek: new Date("2026-11-22T20:30:00Z"),
      lastSentEver: new Date("2026-11-22T21:10:00Z"),
      uniqueRecipients: 3,
    });
    expect(satis!.recipients).toEqual([
      {
        address: "ali@kort.com",
        messages: 2,
        lastSentAt: new Date("2026-11-22T20:30:00Z"),
        internal: false,
        lead: { leadId: "L1", name: "Ali Kort" },
      },
      { address: "veli@x.com", messages: 2, lastSentAt: new Date("2026-11-22T20:30:00Z"), internal: false, lead: null },
      {
        address: "yusa@unixpadel.com",
        messages: 1,
        lastSentAt: new Date("2026-11-22T20:30:00Z"),
        internal: true,
        lead: null,
      },
    ]);
    expect(exp).toMatchObject({ sent: 0, lastSentEver: null, recipients: [], scan: { configured: true } });
    expect(yusa!.scan).toMatchObject({ configured: false, lastError: "auth_failed" });
  });

  it("içinde bulunulan hafta seçilebilir ama sonrası yok; bozuk hafta hata", async () => {
    const r = await queries().weekly("2026-W48");
    expect(r.ok && [r.value.next, r.value.mailboxes[0]!.sent]).toEqual([null, 1]);
    const bad = await queries().weekly("2026-W99");
    expect(!bad.ok && bad.error.code).toBe("mail_stats.week_invalid");
  });

  it("durum: her hesap, taranmamış olsa da", async () => {
    const st = await queries().status();
    expect(st.map((s) => [s.mailbox, s.configured, s.lastUid, s.lastError])).toEqual([
      [SATIS, true, 4, null],
      [EXPORT, true, 0, null],
      [YUSA, false, 0, "auth_failed"],
    ]);
    store.scan.clear();
    expect((await queries().status())[0]).toMatchObject({ folder: null, lastOkAt: null });
  });
});
