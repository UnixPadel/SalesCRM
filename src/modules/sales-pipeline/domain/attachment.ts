import { RuleError, err, ok, type Result } from "../../shared/kernel";
import type { StageCode } from "./stage";

/**
 * Lead dosya eki (2026-11-19): görüşme notuna ya da aşama geçişine eklenen dosya. Silme yumuşaktır: satır kalır,
 * silme nedeni zorunludur, içerik boşaltılır.
 */
export interface Attachment {
  id: string;
  leadId: string;
  /** Eklendiği görüşme (temas) kaydı; aşama penceresinden ya da lead sayfasından yüklendiyse null. */
  activityId: string | null;
  /** Yüklendiği andaki aşama. */
  stageCode: StageCode;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedBy: string;
  uploadedAt: Date;
  deletedAt: Date | null;
  deletedBy: string | null;
  deleteReason: string | null;
}

/** Dosya başına üst sınır. */
export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
/** Bir lead'deki silinmemiş ek sayısı üst sınırı (2026-11-24: her temas ve aşama penceresi dosya istediği için 50 → 200). */
export const ATTACHMENT_MAX_PER_LEAD = 200;
export const ATTACHMENT_NAME_MAX = 200;
export const ATTACHMENT_REASON_MIN = 3;
export const ATTACHMENT_REASON_MAX = 500;

/** Kabul edilen uzantılar → sunulacak içerik türü (tarayıcının bildirdiği türe güvenilmez). */
export const ATTACHMENT_TYPES: Readonly<Record<string, string>> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  csv: "text/csv",
  txt: "text/plain",
};
export const ATTACHMENT_EXTENSIONS: readonly string[] = Object.keys(ATTACHMENT_TYPES);

export const attachmentExtension = (fileName: string): string => {
  const i = fileName.lastIndexOf(".");
  return i < 0 ? "" : fileName.slice(i + 1).toLowerCase();
};

/** Tarayıcıda önizlenebilen görseller. */
export const isImageAttachment = (mimeType: string): boolean =>
  ["image/jpeg", "image/png", "image/gif", "image/webp"].includes(mimeType);

/** Yol parçalarını ve denetim karakterlerini atar; ad boş kalırsa "dosya". */
export function cleanFileName(raw: string): string {
  const base = raw.replace(/\\/g, "/").split("/").pop() ?? "";
  // eslint-disable-next-line no-control-regex
  const safe = base.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "").trim();
  return (safe || "dosya").slice(0, ATTACHMENT_NAME_MAX);
}

/** base64 metnin çözülmüş bayt sayısı; geçersizse null. */
export function base64Size(b64: string): number | null {
  if (!b64 || b64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return null;
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return (b64.length / 4) * 3 - pad;
}

export interface AttachmentUpload {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

/** Yüklenen dosyayı doğrular: ad, uzantı, boyut. İçerik türü uzantıdan belirlenir. */
export function validateUpload(rawName: unknown, contentBase64: unknown): Result<AttachmentUpload, RuleError> {
  if (typeof rawName !== "string" || !rawName.trim()) {
    return err(new RuleError("attachment.name", "Dosya adı gerekli."));
  }
  const fileName = cleanFileName(rawName);
  const ext = attachmentExtension(fileName);
  const mimeType = ATTACHMENT_TYPES[ext];
  if (!mimeType) {
    return err(
      new RuleError("attachment.type", "Bu dosya türü eklenemez.", { extension: ext, allowed: ATTACHMENT_EXTENSIONS }),
    );
  }
  const size = typeof contentBase64 === "string" ? base64Size(contentBase64) : null;
  if (size === null || size === 0) return err(new RuleError("attachment.empty", "Dosya boş ya da okunamadı."));
  if (size > ATTACHMENT_MAX_BYTES) {
    return err(
      new RuleError("attachment.too_large", "Dosya en çok 10 MB olabilir.", {
        maxMb: ATTACHMENT_MAX_BYTES / 1024 / 1024,
      }),
    );
  }
  return ok({ fileName, mimeType, sizeBytes: size });
}

/** Silme nedeni zorunludur. */
export function validateDeleteReason(raw: unknown): Result<string, RuleError> {
  const reason = typeof raw === "string" ? raw.trim() : "";
  if (reason.length < ATTACHMENT_REASON_MIN) {
    return err(new RuleError("attachment.reason", "Silme nedeni yazılmalı.", { min: ATTACHMENT_REASON_MIN }));
  }
  return ok(reason.slice(0, ATTACHMENT_REASON_MAX));
}
