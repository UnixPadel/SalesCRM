import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "./db";
import { MIGRATIONS_DIR } from "./open";
import { migrate, readMigrations } from "./migrate";
import { createPgliteDb } from "./pglite";

/**
 * Migration 0012 (Faz 7g, satış takip): aşamalı koşu [M-M6]. 1–11 uygulanır, eski verinin örnek satırları yazılır,
 * sonra 0012 uygulanır: veri düzeltmeleri (FX → FR, reklam yüzeyi, eski kayıt işareti), satır sayıları ve yeni
 * kısıtlar denetlenir. Sentetik veri; kişisel bilgi yok.
 */

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const P1 = uuid(1);
const P2 = uuid(2);
const L = {
  metaNew: uuid(101), // NEW, form lead'i, extra.platform = ig
  contactedNoDone: uuid(102), // CONTACTED, tamamlanmış aktivitesi yok → eski kayıt
  contactedWithDone: uuid(103), // CONTACTED, tamamlanmış aktivitesi var → işaretlenmez
  mysqlClient: uuid(104), // NEW, platform_lead_id mysql:… + extra.mysql.platform = Instagram
  mysqlExtraOnly: uuid(105), // NEW, yalnız extra.mysql (platform Website)
  fx: uuid(106), // ülke FX
  badPlatform: uuid(107), // extra.platform desene uymuyor
  mysqlWhatsapp: uuid(108), // extra.mysql.platform = whatsapp
  mysqlUnknown: uuid(109), // extra.mysql.platform tanınmıyor → NULL
  newWithOpen: uuid(110), // NEW, yalnız açık aktivite → işaretlenmez
  proposalOpenOnly: uuid(111), // PROPOSAL, yalnız açık aktivite → eski kayıt
};

describe("migration 0012 (Faz 7g): aşamalı koşu", () => {
  let db: Db;
  const all = readMigrations(MIGRATIONS_DIR);
  let counts: { leads: number; activities: number; persons: number };

  const count = async (table: string) =>
    Number((await db.query<{ n: string | number }>(`SELECT count(*) AS n FROM ${table}`))[0]!.n);
  const lead = async (id: string) =>
    (
      await db.query<{
        country: string | null;
        ad_surface: string | null;
        contact_history_unknown: boolean;
        checked_warnings: string[];
        roof_wanted: boolean;
        customer_status: string | null;
      }>(
        "SELECT country, ad_surface, contact_history_unknown, checked_warnings, roof_wanted, customer_status FROM leads WHERE id = $1",
        [id],
      )
    )[0]!;

  beforeAll(async () => {
    db = await createPgliteDb();
    expect(all.map((m) => m.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    await migrate(
      db,
      all.filter((m) => m.version <= 11),
    );

    await db.query("INSERT INTO persons (id, country) VALUES ($1, 'FX'), ($2, 'TR')", [P1, P2]);
    const ins = (id: string, stage: string, source: string, extra: object, pid: string | null, country = "TR") =>
      db.query(
        `INSERT INTO leads (id, source, platform_lead_id, person_id, current_stage, country, extra_answers)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [id, source, pid, P2, stage, country, JSON.stringify(extra)],
      );
    await ins(L.metaNew, "NEW", "meta_form", { platform: "ig" }, "m1");
    await ins(L.contactedNoDone, "CONTACTED", "manual", {}, null);
    await ins(L.contactedWithDone, "CONTACTED", "manual", {}, null);
    await ins(L.mysqlClient, "NEW", "import", { mysql: { table: "Clients", platform: "Instagram" } }, "mysql:client:1");
    await ins(L.mysqlExtraOnly, "NEW", "import", { mysql: { table: "Clients", platform: "Website" } }, "x:2");
    await ins(L.fx, "NEW", "manual", {}, null, "FX");
    await ins(L.badPlatform, "NEW", "web_form", { platform: "Not Valid!" }, "w1");
    await ins(L.mysqlWhatsapp, "NEW", "import", { mysql: { platform: "whatsapp" } }, "mysql:client:3");
    await ins(L.mysqlUnknown, "NEW", "import", { mysql: { platform: "Telefon" } }, "mysql:client:4");
    await ins(L.newWithOpen, "NEW", "manual", {}, null);
    await ins(L.proposalOpenOnly, "PROPOSAL", "manual", {}, null);

    const act = (n: number, leadId: string, done: boolean) =>
      db.query(
        "INSERT INTO activities (id, lead_id, type, subject, due_at, done_at) VALUES ($1, $2, 'call', 'Arama', now(), $3)",
        [uuid(n), leadId, done ? new Date("2026-10-01T09:00:00Z") : null],
      );
    await act(201, L.contactedWithDone, true);
    await act(202, L.newWithOpen, false);
    await act(203, L.proposalOpenOnly, false);
    counts = { leads: await count("leads"), activities: await count("activities"), persons: await count("persons") };

    const second = await migrate(db, all);
    expect(second.applied).toEqual(["0012_faz7g_satis_takip"]);
  });
  afterAll(() => db.close());

  it("satır sayıları değişmez; mevcut aktiviteler yeni sütunlarda varsayılanı alır", async () => {
    expect({
      leads: await count("leads"),
      activities: await count("activities"),
      persons: await count("persons"),
    }).toEqual(counts);
    const a = (
      await db.query<Record<string, unknown>>(
        "SELECT outcome, customer_replied, result_note, done_by_user_id, date_estimated, log_id, next_of_log_id FROM activities WHERE id = $1",
        [uuid(201)],
      )
    )[0];
    expect(a).toEqual({
      outcome: null,
      customer_replied: false,
      result_note: "",
      done_by_user_id: null,
      date_estimated: false,
      log_id: null,
      next_of_log_id: null,
    });
  });

  it("eski kayıt işareti: NEW olmayan ve MySQL kaynaklı lead'ler, tamamlanmış aktivitesi olmayanlar", async () => {
    const flagged = (
      await db.query<{ id: string }>("SELECT id FROM leads WHERE contact_history_unknown ORDER BY id")
    ).map((r) => r.id);
    expect(flagged).toEqual(
      [L.contactedNoDone, L.mysqlClient, L.mysqlExtraOnly, L.mysqlWhatsapp, L.mysqlUnknown, L.proposalOpenOnly].sort(),
    );
    expect((await lead(L.contactedWithDone)).contact_history_unknown).toBe(false);
    expect((await lead(L.newWithOpen)).contact_history_unknown).toBe(false);
    expect((await lead(L.metaNew)).contact_history_unknown).toBe(false);
  });

  it("reklam yüzeyi doldurulur: extra.platform ve eski sistemin platform adı", async () => {
    expect((await lead(L.metaNew)).ad_surface).toBe("ig");
    expect((await lead(L.mysqlClient)).ad_surface).toBe("ig");
    expect((await lead(L.mysqlExtraOnly)).ad_surface).toBe("web");
    expect((await lead(L.mysqlWhatsapp)).ad_surface).toBe("whatsapp");
    expect((await lead(L.mysqlUnknown)).ad_surface).toBeNull();
    expect((await lead(L.badPlatform)).ad_surface).toBeNull();
  });

  it("FX → FR (lead ve kişi); diğer alanlar varsayılanda", async () => {
    expect((await lead(L.fx)).country).toBe("FR");
    expect((await db.query<{ country: string }>("SELECT country FROM persons WHERE id = $1", [P1]))[0]!.country).toBe(
      "FR",
    );
    expect(await db.query("SELECT id FROM leads WHERE country = 'FX'")).toHaveLength(0);
    const l = await lead(L.fx);
    expect(l).toMatchObject({ checked_warnings: [], roof_wanted: false, customer_status: null });
  });

  describe("aktivite kısıtları", () => {
    let n = 300;
    const insert = (cols: Record<string, unknown>) => {
      const row = { id: uuid(++n), lead_id: L.metaNew, type: "call", due_at: new Date(), ...cols };
      const keys = Object.keys(row);
      return db.query(
        `INSERT INTO activities (${keys.join(", ")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(", ")})`,
        Object.values(row),
      );
    };
    const done = new Date("2026-11-01T09:00:00Z");

    it("whatsapp ve other kabul, sms red", async () => {
      await insert({ type: "whatsapp" });
      await insert({ type: "other" });
      await expect(insert({ type: "sms" })).rejects.toThrow(/activities_type_check/);
    });

    it("sonuç yalnız tamamlanmış satırda ve listeden", async () => {
      await insert({ outcome: "awaiting_reply", done_at: done });
      await expect(insert({ outcome: "awaiting_reply" })).rejects.toThrow(/activities_outcome_done/);
      await expect(insert({ outcome: "maybe", done_at: done })).rejects.toThrow(/activities_outcome_check/);
      await expect(insert({ date_estimated: true })).rejects.toThrow(/activities_estimated_done/);
      await insert({ date_estimated: true, done_at: done });
    });

    it("customer_replied yalnız follow_up / proposal_sent", async () => {
      await insert({ outcome: "follow_up", customer_replied: true, done_at: done });
      await insert({ outcome: "proposal_sent", customer_replied: true, done_at: done });
      await expect(insert({ outcome: "reply_received", customer_replied: true, done_at: done })).rejects.toThrow(
        /activities_replied_check/,
      );
      await expect(insert({ customer_replied: true, done_at: done })).rejects.toThrow(/activities_replied_check/);
    });
  });

  describe("lead kısıtları", () => {
    const set = (sql: string, params: unknown[] = []) =>
      db.query(`UPDATE leads SET ${sql} WHERE id = $1`, [L.newWithOpen, ...params]);

    it("adet 1–29", async () => {
      await set("qty_standard = 1, qty_panoramic = 29, qty_full_panoramic = NULL");
      await expect(set("qty_standard = 0")).rejects.toThrow(/leads_qty_standard_check/);
      await expect(set("qty_panoramic = 30")).rejects.toThrow(/leads_qty_panoramic_check/);
      await expect(set("qty_full_panoramic = 0")).rejects.toThrow(/leads_qty_full_panoramic_check/);
    });

    it("çatı ölçüsü Kapatma ister ve sıfırdan büyük; numeric(5,2)", async () => {
      await expect(set("roof_width_m = 10")).rejects.toThrow(/leads_roof_dims_need_roof/);
      await set("roof_wanted = true, roof_width_m = 10.555, roof_length_m = 20");
      const r = (
        await db.query<{ w: string | number; l: string | number }>(
          "SELECT roof_width_m AS w, roof_length_m AS l FROM leads WHERE id = $1",
          [L.newWithOpen],
        )
      )[0]!;
      expect(Number(r.w)).toBe(10.56);
      expect(Number(r.l)).toBe(20);
      await expect(set("roof_width_m = 0")).rejects.toThrow(/leads_roof_width_check/);
      await expect(set("roof_length_m = -1")).rejects.toThrow(/leads_roof_length_check/);
    });

    it("kod listeleri CHECK'te", async () => {
      await set("customer_status = 'buyer_ready', install_site = 'covered_court', install_timeline = 'm0_3'");
      await set("customer_profile = 'distributor', court_count_band = '7_plus', ad_surface = 'fb'");
      await expect(set("customer_status = 'hot'")).rejects.toThrow(/leads_customer_status_check/);
      await expect(set("install_site = 'moon'")).rejects.toThrow(/leads_install_site_check/);
      await expect(set("install_timeline = 'm12_24'")).rejects.toThrow(/leads_install_timeline_check/);
      await expect(set("customer_profile = 'other'")).rejects.toThrow(/leads_customer_profile_check/);
      await expect(set("court_count_band = '2'")).rejects.toThrow(/leads_court_count_band_check/);
      await expect(set("ad_surface = 'IG'")).rejects.toThrow(/leads_ad_surface_check/);
      await expect(set("ad_surface = ''")).rejects.toThrow(/leads_ad_surface_check/);
    });

    it("checked_warnings metin dizisi", async () => {
      await set("checked_warnings = $2::text[]", [["phone_invalid", "import_review"]]);
      expect((await lead(L.newWithOpen)).checked_warnings).toEqual(["phone_invalid", "import_review"]);
    });
  });

  it("form alanı eşlemesi yeni hedefleri kabul eder", async () => {
    const ins = (id: number, field: string, target: string) =>
      db.query(
        "INSERT INTO form_field_mappings (id, provider, platform_field, target_field) VALUES ($1, 'test', $2, $3)",
        [uuid(id), field, target],
      );
    for (const [i, t] of ["install_site", "install_timeline", "customer_profile", "court_count"].entries()) {
      await ins(400 + i, `q${i}`, t);
    }
    await expect(ins(410, "q9", "bogus")).rejects.toThrow(/form_field_mappings_target_field_check/);
  });

  it("contact_logs silinince activities.log_id ve next_of_log_id NULL olur; lead silinince kayıt gider", async () => {
    const log = uuid(500);
    await db.query(
      "INSERT INTO contact_logs (id, lead_id, actor_user_id, completed_activity_id) VALUES ($1, $2, 'rep-1', $3)",
      [log, L.newWithOpen, uuid(202)],
    );
    await db.query("UPDATE activities SET log_id = $1 WHERE id = $2", [log, uuid(202)]);
    await db.query(
      "INSERT INTO activities (id, lead_id, type, due_at, next_of_log_id) VALUES ($1, $2, 'whatsapp', now(), $3)",
      [uuid(501), L.newWithOpen, log],
    );
    const row = (
      await db.query<Record<string, unknown>>(
        "SELECT status_changed, assigned_on_log, prev_type, stage_change_id FROM contact_logs WHERE id = $1",
        [log],
      )
    )[0];
    expect(row).toEqual({ status_changed: false, assigned_on_log: false, prev_type: null, stage_change_id: null });

    await db.query("DELETE FROM contact_logs WHERE id = $1", [log]);
    const links = await db.query<{ id: string; log_id: string | null; next_of_log_id: string | null }>(
      "SELECT id, log_id, next_of_log_id FROM activities WHERE id = ANY($1::uuid[]) ORDER BY id",
      [[uuid(202), uuid(501)]],
    );
    expect(links).toEqual([
      { id: uuid(202), log_id: null, next_of_log_id: null },
      { id: uuid(501), log_id: null, next_of_log_id: null },
    ]);

    await db.query("INSERT INTO contact_logs (id, lead_id, actor_user_id) VALUES ($1, $2, 'rep-1')", [
      uuid(502),
      L.badPlatform,
    ]);
    await db.query("DELETE FROM leads WHERE id = $1", [L.badPlatform]);
    expect(await db.query("SELECT id FROM contact_logs WHERE id = $1", [uuid(502)])).toHaveLength(0);
  });

  it("tamamlanan plan silinince contact_logs.completed_activity_id NULL olur (indeksli)", async () => {
    await db.query("INSERT INTO activities (id, lead_id, type, due_at) VALUES ($1, $2, 'call', now())", [
      uuid(510),
      L.newWithOpen,
    ]);
    await db.query(
      "INSERT INTO contact_logs (id, lead_id, actor_user_id, completed_activity_id) VALUES ($1, $2, 'rep-1', $3)",
      [uuid(511), L.newWithOpen, uuid(510)],
    );
    await db.query("DELETE FROM activities WHERE id = $1", [uuid(510)]);
    const rows = await db.query<{ completed_activity_id: string | null }>(
      "SELECT completed_activity_id FROM contact_logs WHERE id = $1",
      [uuid(511)],
    );
    expect(rows).toEqual([{ completed_activity_id: null }]);
    const idx = await db.query<{ indexname: string }>(
      "SELECT indexname FROM pg_indexes WHERE tablename = 'contact_logs' ORDER BY indexname",
    );
    expect(idx.map((r) => r.indexname)).toEqual([
      "contact_logs_completed_idx",
      "contact_logs_lead_idx",
      "contact_logs_pkey",
    ]);
  });
});
