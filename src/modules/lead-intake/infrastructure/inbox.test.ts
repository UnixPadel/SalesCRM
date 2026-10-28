import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPgliteDb, migrate, MIGRATIONS_DIR, readMigrations, type Db } from "../../shared/db";
import { createAesGcmCipher, generateKeyBase64, MINUTE } from "../../shared/kernel";
import type { InboxRepository } from "../application";
import { pgInboxRepository } from "./inboxRepository";

let db: Db;
let inbox: InboxRepository;
const key = generateKeyBase64();
const T0 = new Date("2026-03-01T10:00:00Z");
const at = (ms: number) => new Date(T0.getTime() + ms);

beforeAll(async () => {
  db = await createPgliteDb();
  await migrate(db, readMigrations(MIGRATIONS_DIR));
  inbox = pgInboxRepository(db, createAesGcmCipher(key));
});
afterAll(() => db.close());
beforeEach(() => db.exec("TRUNCATE inbound_webhook_events"));

const enqueue = (id: string, dedupeKey: string, payload: unknown = { id }, receivedAt = T0) =>
  inbox.enqueue({
    id,
    provider: "p",
    kind: "webhook",
    dedupeKey,
    payload,
    receivedAt,
    nextAttemptAt: receivedAt,
  });

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("inbound_webhook_events (PGlite)", () => {
  it("payload şifreli durur; okurken çözülür; aynı dedupe_key ikinci kez duplicate", async () => {
    expect(await enqueue(U(1), "p:1", { email: "ayse@example.com", nested: [1, 2] })).toBe("inserted");
    expect(await enqueue(U(2), "p:1", { email: "x" })).toBe("duplicate");
    const raw = await db.query<{ payload_ciphertext: string; n: string }>(
      "SELECT payload_ciphertext, (SELECT count(*)::int FROM inbound_webhook_events) AS n FROM inbound_webhook_events",
    );
    expect(raw).toHaveLength(1);
    expect(raw[0]?.payload_ciphertext).toMatch(/^v1\./);
    expect(raw[0]?.payload_ciphertext).not.toContain("ayse");
    const row = await inbox.findByDedupeKey("p:1");
    expect(row).toMatchObject({
      id: U(1),
      status: "pending",
      attempts: 0,
      payload: { email: "ayse@example.com", nested: [1, 2] },
    });
    expect(row?.receivedAt).toEqual(T0);
  });

  it("claimDue: sırası gelenleri alır, processing yapar, attempts artar, kilit süresi konur; tekrar almaz", async () => {
    await enqueue(U(1), "p:1");
    await enqueue(U(2), "p:2", {}, at(5 * MINUTE));
    const claimed = await inbox.claimDue(T0, 10, 10 * MINUTE);
    expect(claimed.map((c) => c.id)).toEqual([U(1)]);
    expect(claimed[0]).toMatchObject({ status: "processing", attempts: 1, nextAttemptAt: at(10 * MINUTE) });
    expect(await inbox.claimDue(T0, 10, 10 * MINUTE)).toEqual([]);
    expect((await inbox.claimDue(at(5 * MINUTE), 10, 10 * MINUTE)).map((c) => c.id)).toEqual([U(2)]);
    // kilit süresi dolan processing satırı yeniden alınır
    const again = await inbox.claimDue(at(10 * MINUTE), 10, 10 * MINUTE);
    expect(again.map((c) => c.id)).toEqual([U(1)]);
    expect(again[0]?.attempts).toBe(2);
  });

  it("markDone / markRetry / markFailed durum ve hata alanlarını yazar", async () => {
    await enqueue(U(1), "p:1");
    await enqueue(U(2), "p:2");
    await enqueue(U(3), "p:3");
    await inbox.claimDue(T0, 10, MINUTE);
    await db.query("INSERT INTO persons (id) VALUES ($1)", [U(9)]);
    await db.query(
      "INSERT INTO leads (id, source, platform_lead_id, person_id, current_stage) VALUES ($1,'meta_form','x',$2,'NEW')",
      [U(8), U(9)],
    );
    await inbox.markDone(U(1), U(8), at(1000));
    await inbox.markRetry(U(2), at(MINUTE), { code: "t", message: "geçici" });
    await inbox.markFailed(U(3), { code: "perm", message: "x".repeat(5000) }, at(2000));
    expect(await inbox.findByDedupeKey("p:1")).toMatchObject({ status: "done", leadId: U(8), processedAt: at(1000) });
    expect(await inbox.findByDedupeKey("p:2")).toMatchObject({
      status: "pending",
      nextAttemptAt: at(MINUTE),
      lastErrorCode: "t",
      lastError: "geçici",
    });
    const failed = await inbox.findByDedupeKey("p:3");
    expect(failed).toMatchObject({ status: "failed", lastErrorCode: "perm", processedAt: at(2000) });
    expect(failed?.lastError).toHaveLength(2000);
  });

  it("purgePayloads: eski satırın payload'ı silinir, satır kalır; yeniden okuma payload null", async () => {
    await enqueue(U(1), "p:old", { a: 1 }, at(-31 * 24 * 60 * MINUTE));
    await enqueue(U(2), "p:new", { a: 2 }, T0);
    expect(await inbox.purgePayloads(at(-30 * 24 * 60 * MINUTE), T0)).toBe(1);
    expect(await inbox.purgePayloads(at(-30 * 24 * 60 * MINUTE), T0)).toBe(0);
    expect((await inbox.findByDedupeKey("p:old"))?.payload).toBeNull();
    expect((await inbox.findByDedupeKey("p:new"))?.payload).toEqual({ a: 2 });
    const purged = await db.query<{ payload_purged_at: Date | null }>(
      "SELECT payload_purged_at FROM inbound_webhook_events WHERE dedupe_key = 'p:old'",
    );
    expect(purged[0]?.payload_purged_at).not.toBeNull();
  });

  it("başka anahtarla açılmaz (yanlış INBOX_ENCRYPTION_KEY görünür hata verir)", async () => {
    await enqueue(U(1), "p:1");
    const other = pgInboxRepository(db, createAesGcmCipher(generateKeyBase64()));
    await expect(other.findByDedupeKey("p:1")).rejects.toThrow();
  });
});
