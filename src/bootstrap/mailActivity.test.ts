/** Mail gönderim raporu: gerçek Express + PGlite (migration 0026, Postgres deposu, lead eşleyici), sahte IMAP kaynağı. */
import express from "express";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FakeSentSource, sent } from "../modules/mail-activity/application/fakes";
import type { MailActivityStatusDto, MailWeekReportDto } from "../modules/mail-activity/api";
import { pickSentFolder, imapErrorCode, toSentMessage } from "../modules/mail-activity/infrastructure";
import { openDatabase, type Db } from "../modules/shared/db";
import { FixedClock, loadConfig, mailStatsSecretName, silentLogger } from "../modules/shared/kernel";
import {
  bootMailActivity,
  createMailActivity,
  mailStatsCredentials,
  sessionSeesMailStats,
  type MailActivity,
} from "./mailActivity";

const SATIS = "satis@unixpadel.com";
const EXPORT = "export3@unixpadel.com";

// Görme izni girişte hesaplanır (server/roles.mjs mailStatsViewers): elshan.rasulov ve admin bayrakla gelir.
const SESSIONS: Record<string, { userId: string; role: string; seesMailStats?: boolean }> = {
  elshan: { userId: "41", role: "admin", seesMailStats: true },
  admin: { userId: "admin", role: "admin", seesMailStats: true },
  veli: { userId: "7", role: "admin" },
  rep: { userId: "rep-1", role: "rep" },
};

let db: Db;
let server: Server;
let base: string;
let ma: MailActivity;
const source = new FakeSentSource();
const clock = new FixedClock("2026-11-30T09:00:00Z"); // Pazartesi: geçen hafta 2026-W48

async function call<T>(who: string, method: string, path: string) {
  const res = await fetch(base + "/api/mail-activity" + path, { method, headers: { "x-test-session": who } });
  return { status: res.status, body: (await res.json()) as T };
}

async function listen(router: express.Router): Promise<{ server: Server; base: string }> {
  const ex = express();
  ex.use((req, _res, next) => {
    (req as express.Request & { session?: unknown }).session = SESSIONS[req.header("x-test-session") ?? ""];
    next();
  });
  ex.use("/api/mail-activity", router);
  const s = await new Promise<Server>((resolve) => {
    const x = ex.listen(0, () => resolve(x));
  });
  const addr = s.address();
  return { server: s, base: `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}` };
}

beforeAll(async () => {
  const config = loadConfig({ MAIL_STATS_MAILBOXES: `${SATIS}, ${EXPORT}` });
  db = await openDatabase(config, { memory: true });
  await db.query(
    `INSERT INTO persons (id, full_name, email_normalized) VALUES
       ('00000000-0000-4000-8000-000000000001', 'Ali Kort', 'ali@kort.com'),
       ('00000000-0000-4000-8000-000000000002', 'Ayşe', NULL),
       ('00000000-0000-4000-8000-000000000003', 'Silinen', 'silinen@x.com')`,
  );
  await db.query(
    `INSERT INTO leads (id, source, person_id, full_name, email, current_stage, deleted_at) VALUES
       ('10000000-0000-4000-8000-000000000001', 'manual', '00000000-0000-4000-8000-000000000001', 'Ali Kort', 'ali@kort.com', 'NEW', NULL),
       ('10000000-0000-4000-8000-000000000002', 'manual', '00000000-0000-4000-8000-000000000002', 'Ayşe Padel', ' Ayse@Padel.com ', 'NEW', NULL),
       ('10000000-0000-4000-8000-000000000003', 'manual', '00000000-0000-4000-8000-000000000003', 'Silinen', 'silinen@x.com', 'NEW', now())`,
  );
  source.folders.set(SATIS, {
    path: "INBOX.Sent",
    uidValidity: "5",
    messages: [
      sent({ uid: 1, to: ["Ali@Kort.com"], cc: ["yusa@unixpadel.com"] }, "2026-11-24T08:00:00Z"),
      sent({ uid: 2, to: ["ayse@padel.com", "silinen@x.com"] }, "2026-11-29T20:30:00Z"), // Pazar 23:30 TSİ
      sent({ uid: 3, to: ["ali@kort.com"] }, "2026-11-29T21:10:00Z"), // Pazartesi 00:10 TSİ → W49
      // Aynı mailin ikinci kopyası (Outlook + MailService): tekil sayılır.
      sent({ uid: 4, messageId: "<m1@unixpadel.com>", to: ["ali@kort.com"] }, "2026-11-24T08:00:00Z"),
    ],
  });
  source.failing.set(EXPORT, "auth_failed");
  ma = createMailActivity({
    db,
    config: config.mailStats,
    logger: silentLogger,
    source,
    canView: sessionSeesMailStats,
    clock,
    start: false,
  });
  ({ server, base } = await listen(ma.router));
});
afterAll(async () => {
  server.close();
  await db.close();
});

describe("mail gönderim raporu API", () => {
  it("yalnız seesMailStats olan görür: elshan ve admin 200, başka yönetici ve satışçı 403", async () => {
    for (const who of ["elshan", "admin"]) expect((await call(who, "GET", "/status")).status).toBe(200);
    for (const who of ["veli", "rep"]) {
      for (const [m, p] of [
        ["GET", "/weekly"],
        ["GET", "/status"],
        ["POST", "/run"],
      ] as const) {
        const r = await call<{ code: string }>(who, m, p);
        expect([r.status, r.body.code]).toEqual([403, "mail_stats.forbidden"]);
      }
    }
  });

  it("elle tarama: başarılı hesap yazılır, hatalı hesap durumunu gösterir", async () => {
    const r = await call<MailActivityStatusDto>("elshan", "POST", "/run");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ enabled: true, running: false, minutes: 60, lastRunAt: "2026-11-30T09:00:00.000Z" });
    expect(r.body.mailboxes).toEqual([
      {
        mailbox: SATIS,
        configured: true,
        folder: "INBOX.Sent",
        lastOkAt: "2026-11-30T09:00:00.000Z",
        lastError: null,
        lastErrorAt: null,
      },
      {
        mailbox: EXPORT,
        configured: true,
        folder: null,
        lastOkAt: null,
        lastError: "auth_failed",
        lastErrorAt: "2026-11-30T09:00:00.000Z",
      },
    ]);
  });

  it("hafta raporu: İstanbul sınırı, Message-ID tekilleştirme, CRM eşleşmesi, iç adres", async () => {
    const { status, body } = await call<MailWeekReportDto>("admin", "GET", "/weekly");
    expect(status).toBe(200);
    expect([body.week, body.start, body.end, body.prev, body.next]).toEqual([
      "2026-W48",
      "2026-11-22T21:00:00.000Z",
      "2026-11-29T21:00:00.000Z",
      "2026-W47",
      "2026-W49",
    ]);
    const satis = body.mailboxes[0]!;
    expect(satis).toMatchObject({
      mailbox: SATIS,
      sent: 2,
      lastSentInWeek: "2026-11-29T20:30:00.000Z",
      lastSentEver: "2026-11-29T21:10:00.000Z",
      uniqueRecipients: 4,
    });
    const byAddr = Object.fromEntries(satis.recipients.map((r) => [r.address, r]));
    expect(byAddr["ali@kort.com"]).toMatchObject({ messages: 1, leadName: "Ali Kort", internal: false });
    expect(byAddr["ayse@padel.com"]).toMatchObject({ leadId: "10000000-0000-4000-8000-000000000002" });
    expect(byAddr["silinen@x.com"]).toMatchObject({ leadId: null, leadName: null });
    expect(byAddr["yusa@unixpadel.com"]).toMatchObject({ internal: true, leadId: null });
    expect(body.mailboxes[1]).toMatchObject({ mailbox: EXPORT, sent: 0, recipients: [] });

    const w49 = await call<MailWeekReportDto>("admin", "GET", "/weekly?week=2026-W49");
    expect([w49.body.mailboxes[0]!.sent, w49.body.next]).toEqual([1, null]);
  });

  it("yeniden tarama aynı maili iki kez saymaz", async () => {
    // UID 9: UID 2'nin kopyası (aynı Message-ID); UID 10: yeni mail.
    source.folders
      .get(SATIS)!
      .messages.push(
        sent({ uid: 9, messageId: "<m2@unixpadel.com>" }, "2026-11-29T20:30:00Z"),
        sent({ uid: 10, messageId: "<yeni@unixpadel.com>" }, "2026-11-25T10:00:00Z"),
      );
    await call("elshan", "POST", "/run");
    const rows = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM mailbox_sent_messages");
    expect(rows[0]!.n).toBe(4);
    const w = await call<MailWeekReportDto>("admin", "GET", "/weekly?week=2026-W48");
    expect(w.body.mailboxes[0]!.sent).toBe(3);
    const st = await db.query<{ last_uid: string }>("SELECT last_uid FROM mailbox_scan_state WHERE mailbox = $1", [
      SATIS,
    ]);
    expect(Number(st[0]!.last_uid)).toBe(10);
  });

  it("bozuk hafta 400", async () => {
    const r = await call<{ code: string }>("elshan", "GET", "/weekly?week=2026-W60");
    expect([r.status, r.body.code]).toEqual([400, "mail_stats.week_invalid"]);
  });
});

describe("sunucu bağlantısı ve giriş bilgileri", () => {
  it("şifre adı ve varsayılan dört hesap", () => {
    expect(mailStatsSecretName("satis@unixpadel.com")).toBe("MAIL_STATS_PASS_SATIS");
    expect(mailStatsSecretName("ex.port-3@x.com")).toBe("MAIL_STATS_PASS_EX_PORT_3");
    const cfg = loadConfig({}).mailStats;
    expect(cfg.mailboxes.map((b) => b.address)).toEqual([
      "satis@unixpadel.com",
      "export3@unixpadel.com",
      "export2@unixpadel.com",
      "yusa@unixpadel.com",
    ]);
    expect([cfg.enabled, cfg.minutes, cfg.backfillWeeks, cfg.imapHost, cfg.imapPort]).toEqual([
      true,
      60,
      12,
      "mail.unixpadel.com",
      993,
    ]);
  });

  it("hesabın kendi şifresi, yoksa master kullanıcı, yoksa atlanır", () => {
    const cfg = loadConfig({ IMAP_MASTER_USER: "master" }).mailStats;
    const creds = mailStatsCredentials(cfg, { MAIL_STATS_PASS_SATIS: "s1", IMAP_MASTER_PASSWORD: "m1" });
    expect(creds("satis@unixpadel.com")).toEqual({ user: "satis@unixpadel.com", pass: "s1" });
    expect(creds("yusa@unixpadel.com")).toEqual({ user: "yusa@unixpadel.com*master", pass: "m1" });
    expect(mailStatsCredentials(loadConfig({}).mailStats, {})("yusa@unixpadel.com")).toBeNull();
  });

  it("şifre yoksa tarama kapalı: zamanlayıcı yok, elle tarama 409, rapor yine okunur", async () => {
    const off = bootMailActivity({ db, config: loadConfig({}), logger: silentLogger }, {});
    expect(off.scheduler).toBeNull();
    expect(await off.runNow()).toEqual([]);
    const s = await listen(off.router);
    try {
      const run = await fetch(s.base + "/api/mail-activity/run", {
        method: "POST",
        headers: { "x-test-session": "admin" },
      });
      expect(run.status).toBe(409);
      const st = (await (
        await fetch(s.base + "/api/mail-activity/status", { headers: { "x-test-session": "admin" } })
      ).json()) as MailActivityStatusDto;
      expect(st.enabled).toBe(false);
      expect(st.mailboxes.every((m) => !m.configured)).toBe(true);
    } finally {
      s.server.close();
    }
  });
});

describe("IMAP yardımcıları", () => {
  it("Gönderilmiş klasörü: özel kullanım bayrağı, yoksa ad", () => {
    expect(pickSentFolder([{ path: "INBOX" }, { path: "Giden", specialUse: "\\Sent" }])).toBe("Giden");
    expect(pickSentFolder([{ path: "INBOX" }, { path: "INBOX.Sent Items" }])).toBe("INBOX.Sent Items");
    expect(pickSentFolder([{ path: "Gönderilmiş Öğeler" }])).toBe("Gönderilmiş Öğeler");
    expect(pickSentFolder([{ path: "INBOX" }, { path: "Consent" }])).toBeNull();
  });

  it("ENVELOPE → ileti; hata kodları", () => {
    expect(
      toSentMessage({
        uid: 3,
        envelope: { messageId: "<a@b>", date: "2026-11-24T08:00:00Z", to: [{ address: "a@b.co" }, { name: "Grup" }] },
        internalDate: "2026-11-24T08:01:00Z",
      }),
    ).toEqual({
      uid: 3,
      messageId: "<a@b>",
      sentAt: new Date("2026-11-24T08:00:00Z"),
      to: ["a@b.co"],
      cc: [],
      bcc: [],
    });
    expect(toSentMessage({ uid: 4, envelope: {}, internalDate: "bozuk" }).sentAt).toBeNull();
    expect(imapErrorCode({ authenticationFailed: true })).toBe("auth_failed");
    expect(imapErrorCode({ code: "ENOTFOUND", message: "getaddrinfo mail.x" })).toBe("unreachable");
    expect(imapErrorCode({ responseText: "Mailbox busy" })).toBe("Mailbox busy");
    expect(imapErrorCode(undefined)).toBe("unknown");
  });
});
