import { NotFoundError, RuleError, err, ok, type Result } from "../../shared/kernel";
import { ATTACHMENT_MAX_PER_LEAD, validateDeleteReason, validateUpload, type Attachment } from "../domain";
import type { Actor, UseCaseDeps } from "./types";
import { loadActionableLead } from "./visibility";

/**
 * Lead dosya ekleri (2026-11-19): görüşme notuna ya da aşama geçişine eklenen dosyalar. Lead'i görebilen ekler ve
 * indirir; yükleyen ya da yönetici siler. Silme yumuşaktır ve neden zorunludur.
 */
export interface AddAttachmentInput {
  leadId: string;
  actor: Actor;
  fileName: unknown;
  contentBase64: unknown;
  /** Eklendiği görüşme (temas) kaydı; o lead'e ait olmalı. */
  activityId?: string | null;
}

export class AddAttachment {
  constructor(private readonly deps: UseCaseDeps) {}

  async execute(input: AddAttachmentInput): Promise<Result<Attachment, RuleError>> {
    const upload = validateUpload(input.fileName, input.contentBase64);
    if (!upload.ok) return upload;
    const { uow, clock, ids } = this.deps;
    const out = await uow.run(async (repos): Promise<Result<Attachment, RuleError>> => {
      const loaded = await loadActionableLead(repos, input.leadId, input.actor);
      if (!loaded.ok) return loaded;
      const lead = loaded.value;
      const activityId = input.activityId ?? null;
      if (activityId) {
        const activity = await repos.activities.findById(activityId);
        if (!activity || activity.leadId !== lead.id) return err(new NotFoundError("Activity", activityId));
      }
      const live = (await repos.attachments.listByLead(lead.id)).filter((a) => a.deletedAt === null);
      if (live.length >= ATTACHMENT_MAX_PER_LEAD) {
        return err(
          new RuleError("attachment.too_many", "Bu lead'e daha fazla dosya eklenemez.", {
            max: ATTACHMENT_MAX_PER_LEAD,
          }),
        );
      }
      const attachment: Attachment = {
        id: ids.next(),
        leadId: lead.id,
        activityId,
        stageCode: lead.currentStage,
        ...upload.value,
        uploadedBy: input.actor.userId,
        uploadedAt: clock.now(),
        deletedAt: null,
        deletedBy: null,
        deleteReason: null,
      };
      await repos.attachments.insert(attachment, input.contentBase64 as string);
      return ok(attachment);
    });
    if (out.ok) {
      await this.deps.actions?.record({
        actor: input.actor,
        action: "attachment.added",
        lead: { id: out.value.leadId },
        details: { fileName: out.value.fileName, image: out.value.mimeType.startsWith("image/") },
      });
      this.deps.logger.info("dosya eklendi", {
        leadId: out.value.leadId,
        attachmentId: out.value.id,
        sizeBytes: out.value.sizeBytes,
        actorUserId: input.actor.userId,
      });
    }
    return out;
  }
}

export interface DeleteAttachmentInput {
  attachmentId: string;
  actor: Actor;
  reason: unknown;
}

export class DeleteAttachment {
  constructor(private readonly deps: UseCaseDeps) {}

  async execute(input: DeleteAttachmentInput): Promise<Result<Attachment, RuleError>> {
    const reason = validateDeleteReason(input.reason);
    if (!reason.ok) return reason;
    const { uow, clock } = this.deps;
    const out = await uow.run(async (repos): Promise<Result<Attachment, RuleError>> => {
      const found = await repos.attachments.findById(input.attachmentId);
      if (!found) return err(new NotFoundError("Attachment", input.attachmentId));
      const loaded = await loadActionableLead(repos, found.leadId, input.actor);
      if (!loaded.ok) return loaded;
      if (found.deletedAt) return err(new RuleError("attachment.deleted", "Bu dosya zaten silinmiş."));
      if (!input.actor.isAdmin && found.uploadedBy !== input.actor.userId) {
        return err(new RuleError("attachment.not_owner", "Dosyayı yalnız yükleyen kişi ya da yönetici silebilir."));
      }
      const at = clock.now();
      await repos.attachments.markDeleted(found.id, input.actor.userId, reason.value, at);
      return ok({ ...found, deletedAt: at, deletedBy: input.actor.userId, deleteReason: reason.value });
    });
    if (out.ok) {
      await this.deps.actions?.record({
        actor: input.actor,
        action: "attachment.deleted",
        lead: { id: out.value.leadId },
        details: { fileName: out.value.fileName },
      });
      this.deps.logger.info("dosya silindi", {
        leadId: out.value.leadId,
        attachmentId: out.value.id,
        actorUserId: input.actor.userId,
      });
    }
    return out;
  }
}

export interface AttachmentContent {
  attachment: Attachment;
  contentBase64: string;
}

export class AttachmentQueries {
  constructor(private readonly deps: UseCaseDeps) {}

  /** Lead'in ekleri (silinenler nedenleriyle birlikte), en yeni önce. */
  list(leadId: string, actor: Actor): Promise<Result<Attachment[], RuleError>> {
    return this.deps.uow.run(async (repos): Promise<Result<Attachment[], RuleError>> => {
      const loaded = await loadActionableLead(repos, leadId, actor);
      if (!loaded.ok) return loaded;
      return ok(await repos.attachments.listByLead(leadId));
    });
  }

  /** İndirme: silinmiş ekin içeriği yoktur. */
  content(attachmentId: string, actor: Actor): Promise<Result<AttachmentContent, RuleError>> {
    return this.deps.uow.run(async (repos): Promise<Result<AttachmentContent, RuleError>> => {
      const found = await repos.attachments.findById(attachmentId);
      if (!found) return err(new NotFoundError("Attachment", attachmentId));
      const loaded = await loadActionableLead(repos, found.leadId, actor);
      if (!loaded.ok) return loaded;
      const contentBase64 = found.deletedAt ? undefined : await repos.attachments.content(found.id);
      if (!contentBase64) return err(new RuleError("attachment.deleted", "Bu dosya silinmiş."));
      return ok({ attachment: found, contentBase64 });
    });
  }
}
