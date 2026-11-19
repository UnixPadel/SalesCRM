import type { Request, Response, Router } from "express";
import type { RuleError } from "../../shared/kernel";
import type { Actor, SalesPipeline } from "../application";
import {
  ATTACHMENT_EXTENSIONS,
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_REASON_MIN,
  isImageAttachment,
  type Attachment,
} from "../domain";
import type { AddAttachmentBody, AttachmentDto, AttachmentRulesDto, DeleteAttachmentBody } from "./dto.attachment";

/**
 * Lead dosya ekleri (2026-11-19). Yükleme JSON gövdesinde base64 gelir (sunucu JSON sınırı 25 MB; dosya sınırı 10 MB).
 * İndirme her zaman `attachment` olarak ve `nosniff` ile sunulur: yüklenen içerik tarayıcıda sayfa gibi çalışmaz.
 */
export interface AttachmentRouteDeps {
  pipeline: SalesPipeline;
  actor(req: Request, res: Response, write: boolean): (Actor & { readOnly: boolean }) | undefined;
  sendError(res: Response, error: RuleError): Response;
}

export const attachmentRules = (): AttachmentRulesDto => ({
  maxBytes: ATTACHMENT_MAX_BYTES,
  extensions: [...ATTACHMENT_EXTENSIONS],
  reasonMin: ATTACHMENT_REASON_MIN,
});

export const attachmentDto = (a: Attachment): AttachmentDto => ({
  id: a.id,
  leadId: a.leadId,
  activityId: a.activityId,
  stageCode: a.stageCode,
  fileName: a.fileName,
  mimeType: a.mimeType,
  isImage: isImageAttachment(a.mimeType),
  sizeBytes: a.sizeBytes,
  uploadedBy: a.uploadedBy,
  uploadedAt: a.uploadedAt.toISOString(),
  deletedAt: a.deletedAt ? a.deletedAt.toISOString() : null,
  deletedBy: a.deletedBy,
  deleteReason: a.deleteReason,
});

export function registerAttachmentRoutes(r: Router, deps: AttachmentRouteDeps): void {
  const { pipeline, actor, sendError } = deps;

  r.get("/leads/:id/attachments", async (req, res) => {
    const a = actor(req, res, false);
    if (!a) return;
    const result = await pipeline.attachments.list(String(req.params["id"]), a);
    if (!result.ok) return sendError(res, result.error);
    res.json(result.value.map(attachmentDto));
  });

  r.post("/leads/:id/attachments", async (req, res) => {
    const a = actor(req, res, true);
    if (!a) return;
    const b = (req.body ?? {}) as Partial<AddAttachmentBody>;
    const result = await pipeline.addAttachment.execute({
      leadId: String(req.params["id"]),
      actor: a,
      fileName: b.fileName,
      contentBase64: b.contentBase64,
      activityId: typeof b.activityId === "string" && b.activityId ? b.activityId : null,
    });
    if (!result.ok) return sendError(res, result.error);
    res.status(201).json(attachmentDto(result.value));
  });

  r.get("/attachments/:id/content", async (req, res) => {
    const a = actor(req, res, false);
    if (!a) return;
    const result = await pipeline.attachments.content(String(req.params["id"]), a);
    if (!result.ok) return sendError(res, result.error);
    const { attachment, contentBase64 } = result.value;
    const bytes = Buffer.from(contentBase64, "base64");
    res.setHeader("Content-Type", attachment.mimeType);
    res.setHeader("Content-Length", String(bytes.length));
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, max-age=300");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`,
    );
    res.end(bytes);
  });

  r.delete("/attachments/:id", async (req, res) => {
    const a = actor(req, res, true);
    if (!a) return;
    const b = (req.body ?? {}) as Partial<DeleteAttachmentBody>;
    const result = await pipeline.deleteAttachment.execute({
      attachmentId: String(req.params["id"]),
      actor: a,
      reason: b.reason,
    });
    if (!result.ok) return sendError(res, result.error);
    res.json(attachmentDto(result.value));
  });
}
