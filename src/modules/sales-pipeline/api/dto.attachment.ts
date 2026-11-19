import type { StageCodeDto } from "./dto.codes";

/** Lead dosya eki (2026-11-19). Silinen ek listede kalır: `deletedAt`, `deletedBy`, `deleteReason` doludur. */
export interface AttachmentDto {
  id: string;
  leadId: string;
  /** Eklendiği görüşme (temas) kaydı. */
  activityId: string | null;
  /** Yüklendiği andaki aşama. */
  stageCode: StageCodeDto;
  fileName: string;
  mimeType: string;
  /** Tarayıcıda küçük önizlemesi gösterilebilir. */
  isImage: boolean;
  sizeBytes: number;
  uploadedBy: string;
  uploadedAt: string;
  deletedAt: string | null;
  deletedBy: string | null;
  deleteReason: string | null;
}

export interface AddAttachmentBody {
  fileName: string;
  /** Dosya içeriği, base64. */
  contentBase64: string;
  activityId?: string | null;
}

export interface DeleteAttachmentBody {
  /** Zorunlu. */
  reason: string;
}

/** `/reference.attachments`: istemci aynı sınırlarla ön denetim yapar. */
export interface AttachmentRulesDto {
  maxBytes: number;
  extensions: string[];
  reasonMin: number;
}
