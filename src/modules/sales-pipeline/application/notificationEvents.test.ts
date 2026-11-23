import { beforeEach, describe, expect, it } from "vitest";
import { unwrap } from "../../shared/kernel";
import { createSalesPipeline, type SalesPipeline } from "./index";
import { testDeps, type TestHarness } from "./fakes";
import { InMemoryNotificationStore, LeadNotifier, RecordingEmailSender, StaticUserDirectory } from "./notifications";
import {
  InMemoryPushSubscriptionStore,
  PushNotifier,
  PushSubscriptions,
  RecordingPushTransport,
  isPushEndpoint,
} from "./push";
import { pushText } from "./notificationText";

/** 2026-11-23: atama / devir, tekrar form bildirimi ve Web Push. */
let h: TestHarness;
let sp: SalesPipeline;
let store: InMemoryNotificationStore;
let mail: RecordingEmailSender;
let subs: InMemoryPushSubscriptionStore;
let transport: RecordingPushTransport;
let push: PushSubscriptions;

const ADMIN = { userId: "admin", isAdmin: true };
const REP = { userId: "12", isAdmin: false };
const ENDPOINT = "https://fcm.googleapis.com/fcm/send/abc";
const KEYS = { p256dh: "BPubKeyBPubKeyBPubKey", auth: "authauthauth" };

beforeEach(() => {
  h = testDeps();
  store = new InMemoryNotificationStore();
  mail = new RecordingEmailSender();
  subs = new InMemoryPushSubscriptionStore();
  transport = new RecordingPushTransport();
  push = new PushSubscriptions({ store: subs, clock: h.clock, ids: h.ids, publicKey: "BPublic" });
  const notifier = new LeadNotifier({
    uow: h.uow,
    notifications: store,
    push: new PushNotifier({ store: subs, transport, logger: h.logger }),
    email: mail,
    users: new StaticUserDirectory([{ id: "12", name: "Elshan", email: "elshan@example.com" }]),
    clock: h.clock,
    ids: h.ids,
    logger: h.logger,
    publicBaseUrl: "https://crm.example.com",
  });
  sp = createSalesPipeline({ ...h, events: notifier });
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

const typesFor = (userId: string) => store.rows.filter((r) => r.userId === userId).map((r) => r.type);

describe("atama ve devir bildirimi", () => {
  it("yeni lead tek bildirim üretir (LeadCreated + LeadAssigned aynı partide çift yazmaz)", async () => {
    unwrap(await create({ assignedUserId: "12" }));
    expect(typesFor("12")).toEqual(["lead_assigned"]);
    expect(mail.sent).toHaveLength(1);
  });

  it("yönetici havuzdaki lead'i atar: lead_assigned; başka birine devreder: yeni sorumluya lead_transferred", async () => {
    const lead = unwrap(await create()).lead;
    expect(store.rows).toHaveLength(0);
    unwrap(await sp.assignLead.execute({ leadId: lead.id, toUserId: "12", actor: ADMIN }));
    expect(typesFor("12")).toEqual(["lead_assigned"]);
    expect(mail.sent).toHaveLength(0); // e-posta yalnız yeni lead'de

    unwrap(await sp.assignLead.execute({ leadId: lead.id, toUserId: "13", actor: ADMIN }));
    expect(typesFor("13")).toEqual(["lead_transferred"]);
    expect(JSON.parse(store.rows.at(-1)!.body)).toMatchObject({ leadName: "Ayşe Demir", fromUserId: "12" });
    expect(typesFor("12")).toEqual(["lead_assigned"]); // eski sorumluya bildirim gitmez
  });

  it("havuzdan kendi üstlenen satışçıya ve havuza bırakmada bildirim gitmez", async () => {
    const lead = unwrap(await create()).lead;
    unwrap(await sp.assignLead.execute({ leadId: lead.id, toUserId: "12", actor: REP }));
    unwrap(await sp.assignLead.execute({ leadId: lead.id, toUserId: null, actor: ADMIN }));
    expect(store.rows).toHaveLength(0);
  });
});

describe("tekrar form bildirimi", () => {
  it("açık lead'in sahibine form_resubmitted; havuzdaki lead'de bildirim yok", async () => {
    unwrap(await create({ assignedUserId: "12" }));
    const again = unwrap(await create({ mergeRepeatSubmission: true }));
    expect(again.merged).toBe(true);
    expect(typesFor("12")).toEqual(["lead_assigned", "form_resubmitted"]);

    unwrap(await create({ email: "pool@example.com" }));
    unwrap(await create({ email: "pool@example.com", mergeRepeatSubmission: true }));
    expect(store.rows).toHaveLength(2);
  });
});

describe("Web Push", () => {
  it("abone tarayıcıya kişinin dilinde gider; geçersiz abonelik silinir; push hatası bildirimi bozmaz", async () => {
    unwrap(await push.subscribe({ actor: REP, endpoint: ENDPOINT, ...KEYS, lang: "en" }));
    const lead = unwrap(await create({ assignedUserId: "12" })).lead;
    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0]!.payload).toMatchObject({
      title: "New lead assigned: Ayşe Demir",
      body: "Demir Spor · TR",
      url: `/#/lead/${lead.id}`,
      lang: "en",
    });

    transport.gone.add(ENDPOINT);
    unwrap(await create({ assignedUserId: "12", email: "b@example.com" }));
    expect(subs.rows).toHaveLength(0);

    unwrap(await push.subscribe({ actor: REP, endpoint: ENDPOINT, ...KEYS, lang: "tr" }));
    transport.gone.clear();
    transport.send = async () => {
      throw new Error("push down");
    };
    unwrap(await create({ assignedUserId: "12", email: "c@example.com" }));
    expect(typesFor("12")).toHaveLength(3);
  });

  it("aynı tarayıcı başka kişiye geçer; çıkışta yalnız sahibi ayırır; kapalıyken ve geçersiz adreste reddeder", async () => {
    unwrap(await push.subscribe({ actor: REP, endpoint: ENDPOINT, ...KEYS, lang: "tr" }));
    unwrap(await push.subscribe({ actor: ADMIN, endpoint: ENDPOINT, ...KEYS, lang: "ar" }));
    expect(subs.rows).toMatchObject([{ userId: "admin", lang: "ar" }]);
    await push.unsubscribe(REP, ENDPOINT);
    expect(subs.rows).toHaveLength(1);
    await push.unsubscribe(ADMIN, ENDPOINT);
    expect(subs.rows).toHaveLength(0);

    for (const endpoint of ["http://fcm.googleapis.com/x", "https://10.0.0.5/hook", "https://evil.example.com/x", 5]) {
      const r = await push.subscribe({ actor: REP, endpoint, ...KEYS, lang: "tr" });
      expect(r.ok ? "" : r.error.code).toBe("push.invalid_subscription");
    }
    expect(isPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/x")).toBe(true);
    expect(isPushEndpoint("https://web.push.apple.com/abc")).toBe(true);

    const off = new PushSubscriptions({ store: subs, clock: h.clock, ids: h.ids, publicKey: "" });
    expect(off.config()).toEqual({ enabled: false, publicKey: "" });
    const r = await off.subscribe({ actor: REP, endpoint: ENDPOINT, ...KEYS, lang: "tr" });
    expect(r.ok ? "" : r.error.code).toBe("push.disabled");
  });

  it("metin: süre ve iş konusu yerine oturur; bilinmeyen tür düz başlığa düşer", () => {
    const body = JSON.stringify({ leadName: "Omar", hours: 26, subject: "Teklif araması", company: "", country: "AE" });
    expect(pushText({ type: "hot_untouched", title: "x", body }, "tr")).toEqual({
      title: "Sıcak lead bekliyor: Omar · 26 saattir işlem yok",
      body: "Teklif araması · AE",
    });
    expect(pushText({ type: "eski" as never, title: "Düz başlık", body: "bozuk" }, "ar").title).toBe("Düz başlık");
  });
});
