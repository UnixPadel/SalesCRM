import { queryOne, type Queryable } from "../../shared/db";
import type { Attachment, AttachmentRepository, StageCode } from "../domain";

/** Lead dosya ekleri (migration 0018 `lead_attachments`). Listeler içerik sütununu okumaz. */
const COLS =
  "id, lead_id, activity_id, stage_code, file_name, mime_type, size_bytes, uploaded_by, uploaded_at, " +
  "deleted_at, deleted_by, delete_reason";

interface AttachmentRow extends Record<string, unknown> {
  id: string;
  lead_id: string;
  activity_id: string | null;
  stage_code: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  uploaded_by: string;
  uploaded_at: Date | string;
  deleted_at: Date | string | null;
  deleted_by: string | null;
  delete_reason: string | null;
}

const date = (v: Date | string): Date => (v instanceof Date ? v : new Date(v));

const fromRow = (r: AttachmentRow): Attachment => ({
  id: r.id,
  leadId: r.lead_id,
  activityId: r.activity_id,
  stageCode: r.stage_code as StageCode,
  fileName: r.file_name,
  mimeType: r.mime_type,
  sizeBytes: Number(r.size_bytes),
  uploadedBy: r.uploaded_by,
  uploadedAt: date(r.uploaded_at),
  deletedAt: r.deleted_at === null ? null : date(r.deleted_at),
  deletedBy: r.deleted_by,
  deleteReason: r.delete_reason,
});

export function pgAttachmentRepository(q: Queryable): AttachmentRepository {
  return {
    async insert(a, contentBase64) {
      await q.query(
        `INSERT INTO lead_attachments (${COLS}, content_base64)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          a.id,
          a.leadId,
          a.activityId,
          a.stageCode,
          a.fileName,
          a.mimeType,
          a.sizeBytes,
          a.uploadedBy,
          a.uploadedAt,
          a.deletedAt,
          a.deletedBy,
          a.deleteReason,
          contentBase64,
        ],
      );
    },
    async findById(id) {
      const r = await queryOne<AttachmentRow>(q, `SELECT ${COLS} FROM lead_attachments WHERE id = $1`, [id]);
      return r && fromRow(r);
    },
    async listByLead(leadId) {
      return (
        await q.query<AttachmentRow>(
          `SELECT ${COLS} FROM lead_attachments WHERE lead_id = $1 ORDER BY uploaded_at DESC, id DESC`,
          [leadId],
        )
      ).map(fromRow);
    },
    async content(id) {
      const r = await queryOne<{ content_base64: string | null }>(
        q,
        "SELECT content_base64 FROM lead_attachments WHERE id = $1 AND deleted_at IS NULL",
        [id],
      );
      return r?.content_base64 ?? undefined;
    },
    async markDeleted(id, by, reason, at) {
      await q.query(
        `UPDATE lead_attachments
            SET deleted_at = $2, deleted_by = $3, delete_reason = $4, content_base64 = NULL
          WHERE id = $1 AND deleted_at IS NULL`,
        [id, at, by, reason],
      );
    },
  };
}
