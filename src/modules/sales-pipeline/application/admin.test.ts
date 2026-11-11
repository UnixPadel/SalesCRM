/** Faz 7b/7d: bölge kuralları, havuza uygulama, kişi birleştirme, kuruluş arşivleme, kur kaynağı (bellek içi). */
import { beforeEach, describe, expect, it } from "vitest";
import { unwrap } from "../../shared/kernel";
import { parseTerritoryRule, planPersonMerge, planPoolAssignment, type Person } from "../domain";
import { testDeps, type TestHarness } from "./fakes";
import { createSalesPipeline, type SalesPipeline } from "./index";

const ADMIN = { userId: "admin", isAdmin: true };
const REP = { userId: "rep-1", isAdmin: false };

let h: TestHarness;
let sp: SalesPipeline;
let n = 0;

const lead = async (over: Record<string, unknown> = {}) =>
  unwrap(
    await sp.createLead.execute({
      source: "manual",
      fullName: `Lead ${++n}`,
      email: `lead${n}@example.com`,
      country: "TR",
      actor: ADMIN,
      assignedUserId: null,
      ...over,
    }),
  ).lead;

beforeEach(() => {
  h = testDeps();
  sp = createSalesPipeline({
    ...h,
    team: {
      activeSalesUserIds: async () => ["rep-1", "rep-2"],
      inactiveUserIds: async () => new Set(["rep-old"]),
    },
  });
  n = 0;
});

describe("bölge kuralı (saf)", () => {
  const active = new Set(["rep-1", "rep-2"]);
  it("ülke kodu, sorumlu, yedek ve aktiflik denetimi", () => {
    expect(unwrap(parseTerritoryRule({ countryCode: " tr ", assignedUserId: "rep-1" }, active))).toEqual({
      countryCode: "TR",
      assignedUserId: "rep-1",
      fallbackUserId: null,
    });
    const code = (raw: unknown) => {
      const r = parseTerritoryRule(raw, active);
      return r.ok ? "ok" : r.error.code;
    };
    expect(code({ countryCode: "TUR", assignedUserId: "rep-1" })).toBe("territory.country_invalid");
    expect(code({ countryCode: "TR", assignedUserId: "" })).toBe("territory.user_required");
    expect(code({ countryCode: "TR", assignedUserId: "rep-1", fallbackUserId: "rep-1" })).toBe(
      "territory.fallback_same",
    );
    expect(code({ countryCode: "TR", assignedUserId: "rep-old" })).toBe("territory.user_inactive");
    expect(code({ countryCode: "TR", assignedUserId: "rep-1", fallbackUserId: "rep-old" })).toBe(
      "territory.user_inactive",
    );
    // Dizin okunamıyorsa süzme yapılmaz.
    expect(parseTerritoryRule({ countryCode: "TR", assignedUserId: "rep-old" }, null).ok).toBe(true);
  });

  it("havuz planı: yalnız açık, test olmayan, etiketsiz havuz lead'i; pasif sorumluda yedek", () => {
    const base = { assignedUserId: null, currentStage: "NEW" as const, isTest: false, extraAnswers: {} };
    const plan = planPoolAssignment(
      [
        { ...base, id: "a", country: "TR" },
        { ...base, id: "b", country: "TR", assignedUserId: "rep-2" },
        { ...base, id: "c", country: "TR", currentStage: "LOST" },
        { ...base, id: "d", country: "TR", isTest: true },
        { ...base, id: "e", country: "TR", extraAnswers: { excel_owner: "Beyza" } },
        { ...base, id: "f", country: "DE" },
        { ...base, id: "g", country: "GB" },
        { ...base, id: "h", country: null },
      ],
      [
        { countryCode: "TR", assignedUserId: "rep-1", fallbackUserId: null },
        { countryCode: "DE", assignedUserId: "rep-old", fallbackUserId: "rep-2" },
      ],
      new Set(["rep-old"]),
    );
    expect(plan).toEqual([
      { leadId: "a", toUserId: "rep-1" },
      { leadId: "f", toUserId: "rep-2" },
    ]);
  });
});

describe("TerritoryAdmin", () => {
  it("kaydet, özet (lead ve havuz sayıları, kuralsız ülkeler), kaldır; yalnız yönetici", async () => {
    await lead();
    await lead({ assignedUserId: "rep-2" });
    await lead({ country: "DE" });
    const denied = await sp.territories.save({ actor: REP, fields: { countryCode: "TR", assignedUserId: "rep-1" } });
    expect(!denied.ok && denied.error.code).toBe("admin_only");
    unwrap(
      await sp.territories.save({
        actor: ADMIN,
        fields: { countryCode: "tr", assignedUserId: "rep-1", fallbackUserId: "rep-2" },
      }),
    );
    const bad = await sp.territories.save({ actor: ADMIN, fields: { countryCode: "TR", assignedUserId: "rep-old" } });
    expect(!bad.ok && bad.error.code).toBe("territory.user_inactive");

    const o = unwrap(await sp.territories.overview(ADMIN));
    expect(o.rules).toEqual([
      {
        rule: { countryCode: "TR", assignedUserId: "rep-1", fallbackUserId: "rep-2" },
        leadCount: 2,
        poolCount: 1,
        assignedInactive: false,
        fallbackInactive: false,
      },
    ]);
    expect(o.uncovered).toEqual([{ countryCode: "DE", leadCount: 1, poolCount: 1 }]);

    // Yeni lead kuralla atanır.
    const routed = await lead({ assignedUserId: undefined, actor: null });
    expect(routed.assignedUserId).toBe("rep-1");

    unwrap(await sp.territories.remove({ actor: ADMIN, countryCode: "tr" }));
    const again = await sp.territories.remove({ actor: ADMIN, countryCode: "TR" });
    expect(!again.ok && again.error.code).toBe("not_found");
  });

  it("havuza uygula: kuru çalıştırma yazmaz; uygulama havuz lead'lerini atar", async () => {
    const a = await lead();
    const b = await lead();
    const labelled = await lead({ extraAnswers: { excel_owner: "Beyza" } });
    const other = await lead({ country: "GB" });
    unwrap(await sp.territories.save({ actor: ADMIN, fields: { countryCode: "TR", assignedUserId: "rep-1" } }));

    const dry = unwrap(await sp.territories.applyToPool({ actor: ADMIN, dryRun: true }));
    expect(dry).toEqual({ dryRun: true, total: 2, byUser: [{ userId: "rep-1", count: 2 }] });
    expect(h.uow.state.leads.every((l) => l.assignedUserId === null)).toBe(true);

    const real = unwrap(await sp.territories.applyToPool({ actor: ADMIN, dryRun: false }));
    expect(real.total).toBe(2);
    const owner = (id: string) => h.uow.state.leads.find((l) => l.id === id)?.assignedUserId;
    expect([owner(a.id), owner(b.id), owner(labelled.id), owner(other.id)]).toEqual(["rep-1", "rep-1", null, null]);
    expect(unwrap(await sp.territories.applyToPool({ actor: ADMIN, dryRun: false })).total).toBe(0);
    const denied = await sp.territories.applyToPool({ actor: REP, dryRun: true });
    expect(!denied.ok && denied.error.code).toBe("admin_only");
  });
});

describe("kişi birleştirme", () => {
  const person = (over: Partial<Person>): Person => ({
    id: "p",
    fullName: "Kişi",
    emailNormalized: null,
    phoneE164: null,
    country: null,
    company: "",
    organizationId: null,
    mergedIntoId: null,
    createdAt: new Date(0),
    ...over,
  });

  it("kural (saf): aynı kişi, birleşmiş kaynak ve birleşmiş hedef reddedilir; boş alanlar kaynaktan dolar", () => {
    const t = person({ id: "t", emailNormalized: "t@example.com" });
    const s = person({ id: "s", emailNormalized: "s@example.com", phoneE164: "+905550000001", company: "Kulüp" });
    const plan = unwrap(planPersonMerge(t, s));
    expect(plan.targetPatch).toEqual({ phoneE164: "+905550000001", company: "Kulüp" });
    expect(plan.sourcePatch).toEqual({ phoneE164: null });
    const reason = (a: Person, b: Person) => {
      const r = planPersonMerge(a, b);
      return r.ok ? "ok" : `${r.error.code}:${String(r.error.details["reason"])}`;
    };
    expect(reason(t, t)).toBe("person.merge_invalid:same");
    expect(reason(t, { ...s, mergedIntoId: "x" })).toBe("person.merge_invalid:source_merged");
    expect(reason({ ...t, mergedIntoId: "x" }, s)).toBe("person.merge_invalid:target_merged");
  });

  it("lead'ler hedefe taşınır, kaynak gizlenir; arama yine bulur; yeni lead hedef kişiye bağlanır", async () => {
    const a = await lead({ email: "a@example.com", phone: null });
    const b = await lead({ email: "b@example.com", phone: "+90 532 123 45 67" });
    const denied = await sp.mergePersons.execute({ targetId: a.personId, sourceId: b.personId, actor: REP });
    expect(!denied.ok && denied.error.code).toBe("admin_only");

    const r = unwrap(await sp.mergePersons.execute({ targetId: a.personId, sourceId: b.personId, actor: ADMIN }));
    expect(r.movedLeads).toBe(1);
    expect(r.person).toMatchObject({ id: a.personId, emailNormalized: "a@example.com", phoneE164: "+905321234567" });
    const s = h.uow.state;
    expect(s.leads.map((l) => l.personId)).toEqual([a.personId, a.personId]);
    expect(s.persons.find((p) => p.id === b.personId)).toMatchObject({
      mergedIntoId: a.personId,
      emailNormalized: "b@example.com",
      phoneE164: null,
    });

    const listed = await sp.people.persons({ actor: ADMIN });
    expect(listed.map((p) => p.person.id)).toEqual([a.personId]);
    expect(listed[0]!.leads).toHaveLength(2);
    const found = await sp.people.persons({ actor: ADMIN, search: "b@example.com" });
    expect(found.map((p) => [p.person.id, p.person.mergedIntoId])).toEqual([[b.personId, a.personId]]);

    // Kaynağın e-postasıyla gelen yeni lead hedef kişiye bağlanır.
    const next = await lead({ email: "b@example.com", fullName: "Yeniden" });
    expect(next.personId).toBe(a.personId);

    // Döngü ve tekrar reddedilir.
    const loop = await sp.mergePersons.execute({ targetId: b.personId, sourceId: a.personId, actor: ADMIN });
    expect(!loop.ok && loop.error.code).toBe("person.merge_invalid");
    const twice = await sp.mergePersons.execute({ targetId: a.personId, sourceId: b.personId, actor: ADMIN });
    expect(!twice.ok && twice.error.code).toBe("person.merge_invalid");
    const missing = await sp.mergePersons.execute({ targetId: a.personId, sourceId: "yok", actor: ADMIN });
    expect(!missing.ok && missing.error.code).toBe("not_found");
  });
});

describe("kuruluş arşivleme", () => {
  it("arşivli kuruluş listeden ve seçim kutusundan düşer; bağlı kişi ve lead kalır; geri alınır", async () => {
    const org = unwrap(await sp.createOrganization.execute({ fields: { name: "Padel Kulübü" }, actor: ADMIN }));
    const l = await lead();
    unwrap(await sp.updateLeadFields.execute({ leadId: l.id, fields: { organizationId: org.id }, actor: ADMIN }));
    const denied = await sp.archiveOrganization.execute({ organizationId: org.id, archived: true, actor: REP });
    expect(!denied.ok && denied.error.code).toBe("admin_only");

    const archived = unwrap(
      await sp.archiveOrganization.execute({ organizationId: org.id, archived: true, actor: ADMIN }),
    );
    expect(archived.archivedAt).not.toBeNull();
    expect(await sp.people.organizations({ actor: ADMIN })).toEqual([]);
    expect((await sp.people.organizations({ actor: ADMIN, includeArchived: true })).map((o) => o.leadCount)).toEqual([
      1,
    ]);
    expect((await sp.people.search({ actor: ADMIN, q: "padel" })).organizations).toEqual([]);
    expect(h.uow.state.leads.find((x) => x.id === l.id)?.organizationId).toBe(org.id);

    const back = unwrap(
      await sp.archiveOrganization.execute({ organizationId: org.id, archived: false, actor: ADMIN }),
    );
    expect(back.archivedAt).toBeNull();
    expect(await sp.people.organizations({ actor: ADMIN })).toHaveLength(1);
    const missing = await sp.archiveOrganization.execute({ organizationId: "yok", archived: true, actor: ADMIN });
    expect(!missing.ok && missing.error.code).toBe("not_found");
  });
});

describe("kur kaynağı", () => {
  it("eurRatesSource verilirse pano toplamı her sorguda güncel kurla hesaplanır", async () => {
    let rates: Record<string, number> = { EUR: 1, USD: 0.5 };
    const withSource = createSalesPipeline({ ...h, eurRatesSource: async () => rates });
    const l = await lead({ assignedUserId: "rep-1" });
    for (const target of ["CONTACTED", "QUALIFIED"] as const) {
      unwrap(
        await withSource.changeLeadStage.execute({
          leadId: l.id,
          target,
          actor: ADMIN,
          ...(target === "QUALIFIED"
            ? { qualificationAnswers: { budget_approved: true, site_known: true, install_within_12m: true } }
            : {}),
        }),
      );
    }
    unwrap(
      await withSource.changeLeadStage.execute({
        leadId: l.id,
        target: "PROPOSAL",
        actor: ADMIN,
        value: { amount: 1000, currency: "USD" },
      }),
    );
    const total = async () =>
      (await withSource.queries.board({ actor: ADMIN })).columns.find((c) => c.stage === "PROPOSAL")!.totalEur;
    expect(await total()).toBe(500);
    rates = { EUR: 1, USD: 0.9 };
    expect(await total()).toBe(900);
  });
});
