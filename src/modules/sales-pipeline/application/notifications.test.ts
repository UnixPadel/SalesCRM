import { beforeEach, describe, expect, it } from "vitest";
import { unwrap } from "../../shared/kernel";
import { createSalesPipeline, type SalesPipeline } from "./index";
import { testDeps, type TestHarness } from "./fakes";
import {
  InMemoryNotificationStore,
  LeadNotifier,
  NotificationQueries,
  RecordingEmailSender,
  StaticUserDirectory,
  leadLink,
} from "./notifications";

let h: TestHarness;
let sp: SalesPipeline;
let store: InMemoryNotificationStore;
let mail: RecordingEmailSender;
let queries: NotificationQueries;

const REP = { userId: "12", isAdmin: false };
const ADMIN = { userId: "admin", isAdmin: true };

beforeEach(() => {
  h = testDeps();
  store = new InMemoryNotificationStore();
  mail = new RecordingEmailSender();
  const notifier = new LeadNotifier({
    uow: h.uow,
    notifications: store,
    email: mail,
    users: new StaticUserDirectory([
      { id: "12", name: "Elshan", email: "elshan@example.com" },
      { id: "13", name: "Mailsiz", email: null },
    ]),
    clock: h.clock,
    ids: h.ids,
    logger: h.logger,
    publicBaseUrl: "https://crm.example.com",
  });
  // Gerçek kompozisyonla aynı: olaylar notifier'a gider.
  sp = createSalesPipeline({ ...h, events: notifier });
  queries = new NotificationQueries(store, h.clock);
});

const create = (over: Record<string, unknown> = {}) =>
  sp.createLead.execute({
    source: "meta_form",
    platformLeadId: String(Math.random()),
    fullName: "Ayşe Demir",
    email: "ayse@example.com",
    country: "TR",
    company: "Demir Spor",
    actor: null,
    ...over,
  });

describe("LeadNotifier", () => {
  it("atanan satışçıya uygulama içi bildirim ve e-posta; bağlantı lead sayfasına", async () => {
    h.uow.state.territories.push({ countryCode: "TR", assignedUserId: "12", fallbackUserId: null });
    const lead = unwrap(await create()).lead;
    const { items, unreadCount } = await queries.list(REP);
    expect(unreadCount).toBe(1);
    expect(items[0]).toMatchObject({ userId: "12", type: "lead_assigned", leadId: lead.id, readAt: null });
    expect(JSON.parse(items[0]!.body)).toEqual({
      leadName: "Ayşe Demir",
      company: "Demir Spor",
      country: "TR",
      source: "meta_form",
      isTest: false,
    });
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]).toMatchObject({ to: "elshan@example.com", subject: "Yeni lead: Ayşe Demir" });
    expect(mail.sent[0]!.text).toContain(leadLink("https://crm.example.com", lead.id));
    expect(mail.sent[0]!.text).not.toContain("ayse@example.com"); // müşteri iletişimi e-postada yok
  });

  it("havuza düşen lead bildirim üretmez; e-postasız kullanıcıda yalnız uygulama içi; e-posta hatası akışı bozmaz", async () => {
    unwrap(await create());
    expect(await store.unreadCount("12")).toBe(0);
    expect(mail.sent).toHaveLength(0);

    unwrap(await create({ assignedUserId: "13" }));
    expect(await store.unreadCount("13")).toBe(1);
    expect(mail.sent).toHaveLength(0);

    mail.failWith = new Error("smtp down");
    const r = await create({ assignedUserId: "12" });
    expect(r.ok).toBe(true);
    expect(await store.unreadCount("12")).toBe(1);
  });

  it("satışçının kendi açtığı lead için kendine bildirim gitmez; admin atarsa gider", async () => {
    unwrap(await create({ actor: { userId: "12", isAdmin: false } }));
    expect(await store.unreadCount("12")).toBe(0);
    unwrap(await create({ actor: { userId: "admin", isAdmin: true }, assignedUserId: "12" }));
    expect(await store.unreadCount("12")).toBe(1);
  });

  it("bildirim deposu hatası lead oluşturmayı bozmaz", async () => {
    store.insert = async () => {
      throw new Error("db down");
    };
    const r = await create({ assignedUserId: "12" });
    expect(r.ok).toBe(true);
  });
});

describe("NotificationQueries", () => {
  it("yalnız kendi bildirimleri; okundu işareti sahibine özel; tümünü okundu", async () => {
    unwrap(await create({ assignedUserId: "12" }));
    unwrap(await create({ assignedUserId: "12", email: "b@a.com" }));
    unwrap(await create({ assignedUserId: "admin", email: "c@a.com" }));
    const mine = await queries.list(REP);
    expect(mine.items).toHaveLength(2);
    expect(mine.unreadCount).toBe(2);
    expect((await queries.list(ADMIN)).items).toHaveLength(1);
    const first = mine.items[0]!;
    expect(await queries.markRead(first.id, ADMIN)).toBe(false); // başkasının bildirimi
    expect(await queries.markRead(first.id, REP)).toBe(true);
    expect((await queries.list(REP)).unreadCount).toBe(1);
    expect(await queries.markAllRead(REP)).toBe(1);
    expect((await queries.list(REP)).unreadCount).toBe(0);
    expect(await queries.markAllRead(REP)).toBe(0);
  });
});
