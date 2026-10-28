import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPgliteDb, migrate, MIGRATIONS_DIR, readMigrations, type Db } from "../modules/shared/db";
import { mapLostReason, migrateLegacy, type LegacySnapshot } from "./migrateLegacy";

const snap: LegacySnapshot = {
  organizations: [{ id: "org1", name: "Örnek Kulüp", country: "TR" }],
  contacts: [
    {
      id: "c1",
      name: "Ali Veli",
      email: "ali@example.com",
      phone: "+905321112233",
      organization_id: "org1",
      country: "TR",
    },
    { id: "c2", name: "Jane Doe", email: "jane@example.co.uk", phone: "bozuk", organization_id: null, country: "GB" },
    { id: "c3", name: "No Contact", email: "", phone: "", organization_id: null, country: "DE" },
    { id: "c4", name: "Ali Veli", email: "ali@example.com", phone: "", organization_id: "org1", country: "TR" },
  ],
  leads: [
    {
      id: "l1",
      source: "instagram",
      status: "new",
      contact_id: "c2",
      campaign: "Padel Court",
      product: "Padel Court",
      court_count: "2",
      urgency: "asap",
      location: "UK, Essex",
      owner: "Yuşa",
      form_answers: "x | y",
      created_at: "2026-05-01T09:00:00Z",
      deal_id: null,
    },
    {
      id: "l2",
      source: "instagram",
      status: "discarded",
      contact_id: "c3",
      campaign: "",
      product: "",
      court_count: "",
      urgency: "",
      location: "",
      owner: "",
      form_answers: "",
      created_at: "2026-05-02T09:00:00Z",
      deal_id: null,
    },
    {
      id: "l3",
      source: "instagram",
      status: "qualified",
      contact_id: "c4",
      campaign: "Plate Padel",
      product: "Plate Padel",
      court_count: "1",
      urgency: "m13",
      location: "",
      owner: "Bilinmeyen",
      form_answers: "",
      created_at: "2026-05-03T09:00:00Z",
      deal_id: null,
    },
  ],
  deals: [
    {
      id: "d1",
      title: "Örnek Kulüp",
      organization_id: "org1",
      contact_id: "c1",
      stage: "site_visit",
      value: 95000,
      currency: "EUR",
      court_count: 2,
      court_model: "Panoramik",
      owner: "Yuşa",
      lost_reason: null,
      notes: "fuar",
      created_at: "2026-10-01T06:00:00Z",
      stage_entered_at: "2026-10-10T06:00:00Z",
      won_at: "2026-10-20T06:00:00Z",
      lost_at: null,
    },
    {
      id: "d2",
      title: "Kayıp",
      organization_id: null,
      contact_id: "c2",
      stage: "lost",
      value: 0,
      currency: "EUR",
      court_count: 0,
      court_model: "",
      owner: "",
      lost_reason: "Rakip firma seçildi",
      notes: "",
      created_at: "2026-10-02T06:00:00Z",
      stage_entered_at: "2026-10-05T06:00:00Z",
      won_at: null,
      lost_at: "2026-10-05T06:00:00Z",
    },
  ],
  stageChanges: [
    { id: "s1", deal_id: "d1", from_stage: null, to_stage: "contacted", changed_at: "2026-10-01T06:00:00Z" },
    { id: "s2", deal_id: "d1", from_stage: "contacted", to_stage: "interested", changed_at: "2026-10-03T06:00:00Z" },
  ],
};

let db: Db;
beforeAll(async () => {
  db = await createPgliteDb();
  await migrate(db, readMigrations(MIGRATIONS_DIR));
});
afterAll(() => db.close());

describe("migrateLegacy", () => {
  it("form lead'leri ve fırsatlar taşınır; geçersiz telefon düşürülür; aynı kişi birleşir; eski geçmiş saklanır", async () => {
    const r = await migrateLegacy(db, snap, { ownerIds: { Yuşa: "32" } });
    expect(r.leads).toEqual({ created: 2, existing: 0, skipped: [{ id: "l2", reason: "lead.contact_required" }] });
    expect(r.deals).toEqual({ created: 2, existing: 0, skipped: [], stageErrors: [] });
    expect(r.unknownOwners).toEqual(["Bilinmeyen"]);

    const leads = await db.query<{
      platform_lead_id: string;
      current_stage: string;
      assigned_user_id: string | null;
      phone_e164: string | null;
      person_id: string;
      company: string;
    }>(
      "SELECT platform_lead_id, current_stage, assigned_user_id, phone_e164, person_id, company FROM leads ORDER BY platform_lead_id",
    );
    const by = Object.fromEntries(leads.map((l) => [l.platform_lead_id, l]));
    expect(by["l1"]).toMatchObject({ current_stage: "NEW", assigned_user_id: "32", phone_e164: null });
    expect(by["l3"]).toMatchObject({ current_stage: "QUALIFIED", assigned_user_id: null });
    expect(by["d1"]).toMatchObject({ current_stage: "WON", assigned_user_id: "32", company: "Örnek Kulüp" });
    expect(by["d2"]).toMatchObject({ current_stage: "LOST" });
    // c1 ve c4 aynı e-posta → aynı kişi
    expect(by["d1"]?.person_id).toBe(by["l3"]?.person_id);
    // l1 ve d2 aynı kişi (jane) → aynı kişi, iki lead
    expect(by["l1"]?.person_id).toBe(by["d2"]?.person_id);

    const won = await db.query<{
      stage_code: string;
      origin: string;
      value_amount: string;
      currency: string;
      occurred_at: Date;
    }>(
      "SELECT e.stage_code, e.origin, e.value_amount, e.currency, e.occurred_at FROM lead_stage_events e JOIN leads l ON l.id = e.lead_id WHERE l.platform_lead_id = 'd1' ORDER BY sequence",
    );
    expect(won.map((e) => [e.stage_code, e.origin])).toEqual([
      ["NEW", "system"],
      ["CONTACTED", "auto_fill"],
      ["QUALIFIED", "auto_fill"],
      ["PROPOSAL", "auto_fill"],
      ["WON", "manual"],
    ]);
    expect(Number(won[4]?.value_amount)).toBe(95000);
    expect(new Date(won[4]!.occurred_at).toISOString()).toBe("2026-10-20T06:00:00.000Z");
    expect(new Date(won[0]!.occurred_at).toISOString()).toBe("2026-10-01T06:00:00.000Z");

    const lost = await db.query<{ lost_reason_code: string }>(
      "SELECT e.lost_reason_code FROM lead_stage_events e JOIN leads l ON l.id = e.lead_id WHERE l.platform_lead_id = 'd2' AND e.stage_code = 'LOST'",
    );
    expect(lost[0]?.lost_reason_code).toBe("competitor");
    const extra = await db.query<{ extra_answers: { legacy: { stageHistory: unknown[] } } }>(
      "SELECT extra_answers FROM leads WHERE platform_lead_id = 'd1'",
    );
    expect(extra[0]?.extra_answers.legacy.stageHistory).toHaveLength(2);
    expect(await db.query("SELECT 1 FROM outbound_conversion_events")).toHaveLength(0);
  });

  it("yeniden çalıştırmak çift kayıt açmaz", async () => {
    const r = await migrateLegacy(db, snap, { ownerIds: { Yuşa: "32" } });
    expect(r.leads.created).toBe(0);
    expect(r.leads.existing).toBe(2);
    expect(r.deals.existing).toBe(2);
    expect(await db.query("SELECT id FROM leads")).toHaveLength(4);
  });

  it("mapLostReason", () => {
    expect(mapLostReason("Fiyat yüksek bulundu")).toBe("price_too_high");
    expect(mapLostReason("Proje ertelendi / iptal — bütçe")).toBe("postponed");
    expect(mapLostReason("Yanıt vermiyor")).toBe("no_response");
    expect(mapLostReason(null)).toBe("unqualified");
  });
});
