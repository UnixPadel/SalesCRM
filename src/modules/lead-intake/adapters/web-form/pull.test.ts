import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { PullSourceError } from "../../application";
import {
  createWebPullClient,
  signPullRequest,
  verifyWebFormSignature,
  webPullEndpoint,
  webPullItemToInbox,
  type PullFetchLike,
} from "./index";

const SECRET = "pull-test-secret";
const NOW = Date.parse("2026-11-13T09:00:00Z");
const BASE = "https://www.example.test/?rest_route=/unixpadel/v1/crm";

describe("imza (sözleşme v1, push ile aynı şema)", () => {
  it("başlıklar sözleşmedeki formülle bağımsız hesaplanan HMAC ile aynı; push doğrulayıcısı kabul eder", () => {
    const body = '{"op":"pending","limit":50}';
    const h = signPullRequest(SECRET, NOW, body);
    const ts = Math.floor(NOW / 1000);
    // Sözleşme: sha256=<hex HMAC-SHA256(anahtar, "<timestamp>." + ham gövde)>; PHP: hash_hmac('sha256', $ts.'.'.$body, $key)
    const expected = createHmac("sha256", SECRET).update(`${ts}.${body}`, "utf8").digest("hex");
    expect(h).toEqual({
      "content-type": "application/json",
      "x-webform-timestamp": String(ts),
      "x-webform-signature": `sha256=${expected}`,
    });
    const check = verifyWebFormSignature(
      body,
      { signature: h["x-webform-signature"], timestamp: h["x-webform-timestamp"] },
      SECRET,
      NOW,
    );
    expect(check).toEqual({ ok: true });
    // Türkçe karakterli gövde bayt bayt imzalanır.
    const tr = '{"op":"ack","items":[{"submission_id":"ğüşiöç","status":"inserted"}]}';
    expect(signPullRequest(SECRET, NOW, tr)["x-webform-signature"]).toBe(
      `sha256=${createHmac("sha256", SECRET)
        .update(Buffer.from(`${ts}.${tr}`, "utf8"))
        .digest("hex")}`,
    );
  });
});

describe("uç adresleri", () => {
  it("rest_route değerinin sonuna eklenir; sorgu dizesinin geri kalanı korunur; güzel kalıcı bağlantıda yola", () => {
    expect(webPullEndpoint(BASE, "pending")).toBe("https://www.example.test/?rest_route=/unixpadel/v1/crm/pending");
    expect(webPullEndpoint(`${BASE}/`, "ack")).toBe("https://www.example.test/?rest_route=/unixpadel/v1/crm/ack");
    expect(webPullEndpoint("https://s.test/?lang=de&rest_route=/u/v1/crm&x=1", "ack")).toBe(
      "https://s.test/?lang=de&rest_route=/u/v1/crm/ack&x=1",
    );
    expect(webPullEndpoint("https://s.test/wp-json/unixpadel/v1/crm/", "pending")).toBe(
      "https://s.test/wp-json/unixpadel/v1/crm/pending",
    );
  });
});

describe("öğe → inbox kaydı", () => {
  it("submission_id üstten payload'a yazılır; payload nesne değilse boş gövde; kimliksiz / bozuk kimlik null", () => {
    expect(webPullItemToInbox({ submissionId: "a-1", payload: { fields: { name: "X" }, submission_id: "b" } })).toEqual(
      { platformLeadId: "a-1", payload: { fields: { name: "X" }, submission_id: "a-1" } },
    );
    expect(webPullItemToInbox({ submissionId: "a-2", payload: "bozuk" })).toEqual({
      platformLeadId: "a-2",
      payload: { submission_id: "a-2" },
    });
    expect(webPullItemToInbox({ submissionId: undefined, payload: {} })).toBeNull();
    expect(webPullItemToInbox({ submissionId: "", payload: {} })).toBeNull();
    expect(webPullItemToInbox({ submissionId: "a b", payload: {} })).toBeNull();
    expect(webPullItemToInbox({ submissionId: "x".repeat(129), payload: {} })).toBeNull();
  });
});

describe("istemci: yanıtlar ve hatalar", () => {
  const client = (fetchImpl: PullFetchLike) =>
    createWebPullClient({ baseUrl: BASE, secret: SECRET, fetchImpl, now: () => NOW });
  const reply =
    (status: number, body: unknown): PullFetchLike =>
    async () =>
      new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  const codeOf = async (p: Promise<unknown>) => {
    try {
      await p;
      return "ok";
    } catch (e) {
      expect(e).toBeInstanceOf(PullSourceError);
      const err = e as PullSourceError;
      return `${err.code}/${err.kind}`;
    }
  };

  it("pending ve ack gövdesi sözleşmedeki gibi gider; yanıt ayrıştırılır", async () => {
    const seen: { url: string; body: string; headers: Record<string, string> }[] = [];
    const fetchImpl: PullFetchLike = async (url, init) => {
      seen.push({ url, body: String(init.body), headers: init.headers as Record<string, string> });
      return url.endsWith("/pending")
        ? new Response(JSON.stringify({ ok: true, items: [{ submission_id: "s1", payload: { a: 1 } }], more: true }))
        : new Response(JSON.stringify({ ok: true, acked: 1, unknown: ["s9"] }));
    };
    const c = client(fetchImpl);
    expect(await c.pending(500)).toEqual({ items: [{ submissionId: "s1", payload: { a: 1 } }], more: true });
    expect(await c.ack([{ submissionId: "s1", status: "inserted" }])).toEqual({ acked: 1, unknown: ["s9"] });
    expect(seen.map((s) => s.body)).toEqual([
      '{"op":"pending","limit":100}',
      '{"op":"ack","items":[{"submission_id":"s1","status":"inserted"}]}',
    ]);
    for (const s of seen) {
      const ok = verifyWebFormSignature(
        s.body,
        { signature: s.headers["x-webform-signature"], timestamp: s.headers["x-webform-timestamp"] },
        SECRET,
        NOW,
      );
      expect(ok).toEqual({ ok: true });
    }
  });

  it("401 sebebi, 400, 429, 5xx, 503 not_configured, bozuk yanıt ve ağ hatası koda çevrilir", async () => {
    expect(await codeOf(client(reply(401, { ok: false, reason: "stale" })).pending(50))).toBe(
      "unauthorized.stale/config",
    );
    expect(await codeOf(client(reply(401, { ok: false, reason: "??" })).pending(50))).toBe(
      "unauthorized.unknown/config",
    );
    expect(await codeOf(client(reply(400, { ok: false })).pending(50))).toBe("bad_request/config");
    expect(await codeOf(client(reply(429, "")).pending(50))).toBe("rate_limited/transient");
    expect(await codeOf(client(reply(502, "<html>")).pending(50))).toBe("http_502/transient");
    expect(await codeOf(client(reply(503, { ok: false, error: "not_configured" })).pending(50))).toBe(
      "not_configured/config",
    );
    expect(await codeOf(client(reply(503, "bakım")).pending(50))).toBe("http_503/transient");
    expect(await codeOf(client(reply(200, "<html>")).pending(50))).toBe("bad_response/config");
    expect(await codeOf(client(reply(200, { ok: true, items: "x" })).pending(50))).toBe("bad_response/config");
    const down: PullFetchLike = async () => {
      throw new TypeError("fetch failed");
    };
    expect(await codeOf(client(down).pending(50))).toBe("network/transient");
  });
});
