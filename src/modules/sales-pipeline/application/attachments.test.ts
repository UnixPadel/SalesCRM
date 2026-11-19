import { beforeEach, describe, expect, it } from "vitest";
import { MINUTE, unwrap } from "../../shared/kernel";
import { ATTACHMENT_MAX_PER_LEAD } from "../domain";
import { testDeps, type TestHarness } from "./fakes";
import { createSalesPipeline, type SalesPipeline } from "./index";

const ADMIN = { userId: "admin", isAdmin: true };
const REP = { userId: "rep-1", isAdmin: false };
const REP2 = { userId: "rep-2", isAdmin: false };
const PDF = Buffer.from("%PDF-1.4 test").toString("base64");

let h: TestHarness;
let sp: SalesPipeline;

const newLead = async (actor = REP) =>
  unwrap(
    await sp.createLead.execute({
      source: "manual",
      fullName: "Ek Testi",
      email: "ek@example.com",
      country: "TR",
      actor,
    }),
  ).lead;
const errCode = (r: { ok: boolean; error?: { code: string } }) => (r.ok ? "ok" : r.error?.code);
const add = (leadId: string, actor = REP, over: Record<string, unknown> = {}) =>
  sp.addAttachment.execute({ leadId, actor, fileName: "teklif.pdf", contentBase64: PDF, ...over });
const del = (attachmentId: string, actor: typeof REP, reason: unknown) =>
  sp.deleteAttachment.execute({ attachmentId, actor, reason });

beforeEach(() => {
  h = testDeps();
  sp = createSalesPipeline(h);
});

describe("AddAttachment", () => {
  it("ekler: yükleme tarihi, yükleyen ve o anki aşama yazılır; liste ve içerik okunur", async () => {
    const lead = await newLead();
    const a = unwrap(await add(lead.id));
    expect(a).toMatchObject({
      leadId: lead.id,
      activityId: null,
      stageCode: "NEW",
      fileName: "teklif.pdf",
      mimeType: "application/pdf",
      uploadedBy: "rep-1",
      deletedAt: null,
      deleteReason: null,
    });
    expect(a.uploadedAt).toEqual(h.clock.now());
    expect(a.sizeBytes).toBe(Buffer.from(PDF, "base64").length);
    expect(unwrap(await sp.attachments.list(lead.id, REP)).map((x) => x.id)).toEqual([a.id]);
    const content = unwrap(await sp.attachments.content(a.id, REP));
    expect(content.contentBase64).toBe(PDF);
    expect(content.attachment.fileName).toBe("teklif.pdf");
  });

  it("görüşmeye bağlanır: aktivite o lead'e ait olmalı", async () => {
    const lead = await newLead();
    const other = await newLead();
    const log = unwrap(
      await sp.logContact.execute({
        leadId: lead.id,
        actor: REP,
        activityId: null,
        type: "call",
        outcome: "reply_received",
        customerReplied: false,
        occurredAt: null,
        note: "Fiyat istedi",
        next: null,
        quick: false,
        stage: null,
      }),
    );
    const a = unwrap(await add(lead.id, REP, { activityId: log.activity.id }));
    expect(a.activityId).toBe(log.activity.id);
    expect(errCode(await add(other.id, REP, { activityId: log.activity.id }))).toBe("not_found");
    expect(errCode(await add(lead.id, REP, { activityId: "yok" }))).toBe("not_found");
  });

  it("doğrulama ve yetki: tür, boş içerik, başkasının lead'i, olmayan lead, üst sınır", async () => {
    const lead = await newLead();
    expect(errCode(await add(lead.id, REP, { fileName: "virus.exe" }))).toBe("attachment.type");
    expect(errCode(await add(lead.id, REP, { contentBase64: "" }))).toBe("attachment.empty");
    expect(errCode(await add(lead.id, REP2))).toBe("lead.forbidden");
    expect(errCode(await add("yok"))).toBe("not_found");
    expect(unwrap(await sp.attachments.list(lead.id, REP))).toEqual([]);
    for (let i = 0; i < ATTACHMENT_MAX_PER_LEAD; i++) unwrap(await add(lead.id, REP, { fileName: `d${i}.pdf` }));
    expect(errCode(await add(lead.id))).toBe("attachment.too_many");
  });
});

describe("DeleteAttachment", () => {
  it("neden zorunlu; silinen kayıt nedeniyle listede kalır, içeriği okunamaz", async () => {
    const lead = await newLead();
    const a = unwrap(await add(lead.id));
    expect(errCode(await del(a.id, REP, ""))).toBe("attachment.reason");
    expect(errCode(await del(a.id, REP, "  "))).toBe("attachment.reason");
    h.clock.advance(5 * MINUTE);
    const gone = unwrap(await del(a.id, REP, " Yanlış dosya yüklendi "));
    expect(gone).toMatchObject({ deletedBy: "rep-1", deleteReason: "Yanlış dosya yüklendi" });
    expect(gone.deletedAt).toEqual(h.clock.now());
    const listed = unwrap(await sp.attachments.list(lead.id, REP));
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ id: a.id, deleteReason: "Yanlış dosya yüklendi", deletedBy: "rep-1" });
    expect(errCode(await sp.attachments.content(a.id, REP))).toBe("attachment.deleted");
    expect(errCode(await del(a.id, REP, "tekrar"))).toBe("attachment.deleted");
    // Silinen ek üst sınırdan düşer.
    expect(errCode(await add(lead.id))).toBe("ok");
  });

  it("yalnız yükleyen ya da yönetici siler; başkasının lead'ine dokunulamaz", async () => {
    const pool = await newLead(ADMIN);
    const a = unwrap(await add(pool.id, REP));
    expect(errCode(await del(a.id, REP2, "gereksiz"))).toBe("attachment.not_owner");
    expect(errCode(await del(a.id, ADMIN, "gereksiz"))).toBe("ok");
    const mine = await newLead(REP);
    const b = unwrap(await add(mine.id, REP));
    expect(errCode(await del(b.id, REP2, "gereksiz"))).toBe("lead.forbidden");
    expect(errCode(await sp.attachments.content(b.id, REP2))).toBe("lead.forbidden");
    expect(errCode(await sp.attachments.list(mine.id, REP2))).toBe("lead.forbidden");
    expect(errCode(await del("yok", ADMIN, "gereksiz"))).toBe("not_found");
    expect(errCode(await sp.attachments.content("yok", ADMIN))).toBe("not_found");
  });
});
