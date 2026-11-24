import type { AttachmentDto, AttachmentRulesDto } from "../../modules/sales-pipeline/api/dto.attachment";
import { call } from "../api";

const enc = encodeURIComponent;

/** Dosyayı base64'e çevirir (FileReader veri adresinden; büyük dosyada yığın taşmaz). */
export const fileToBase64 = (file: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(r.error ?? new Error("read"));
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.readAsDataURL(file);
  });

export const attachmentApi = {
  list: (leadId: string) => call<AttachmentDto[]>("GET", `/leads/${enc(leadId)}/attachments`),
  upload: async (leadId: string, file: File, activityId?: string | null) =>
    call<AttachmentDto>("POST", `/leads/${enc(leadId)}/attachments`, {
      fileName: file.name,
      contentBase64: await fileToBase64(file),
      activityId: activityId ?? null,
    }),
  remove: (id: string, reason: string) => call<AttachmentDto>("DELETE", `/attachments/${enc(id)}`, { reason }),
  /** İndirme / önizleme adresi (oturum çereziyle). */
  url: (id: string) => `/api/pipeline/attachments/${enc(id)}/content`,
};

/** Dosyaları sırayla yükler; yüklenemeyenlerin adını döner. */
export async function uploadAll(leadId: string, files: readonly File[], activityId?: string | null): Promise<string[]> {
  const failed: string[] = [];
  for (const f of files) {
    try {
      await attachmentApi.upload(leadId, f, activityId);
    } catch {
      failed.push(f.name);
    }
  }
  return failed;
}

export const extensionOf = (name: string): string => {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i + 1).toLowerCase();
};

/** Seçilen dosyanın ön denetimi: çeviri anahtarı ya da null (sunucu aynı kuralı yeniden uygular). */
export function fileProblem(file: { name: string; size: number }, rules: AttachmentRulesDto): string | null {
  if (!rules.extensions.includes(extensionOf(file.name))) return "attach.badType";
  if (file.size === 0) return "attach.empty";
  if (file.size > rules.maxBytes) return "attach.tooLarge";
  return null;
}

/**
 * Panodan yapıştırılan adsız görüntünün adı: "ekran-goruntusu-2026-11-24-1432.png"; aynı anda birden çok dosya
 * yapıştırıldıysa sıra eki alır ("…-1432-2.png"). Yerel saat kullanılır.
 */
export function pastedName(at: Date, ext: string, seq = 0): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp = `${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())}-${p(at.getHours())}${p(at.getMinutes())}`;
  const clean =
    ext
      .toLowerCase()
      .replace(/^jpeg$/, "jpg")
      .replace(/[^a-z0-9]/g, "") || "png";
  return `ekran-goruntusu-${stamp}${seq ? `-${seq}` : ""}.${clean}`;
}

/** 1536 → "1,5 KB". */
export function fileSize(bytes: number, locale: string): string {
  const units = ["B", "KB", "MB"];
  let v = bytes;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v.toLocaleString(locale, { maximumFractionDigits: u === 0 ? 0 : 1 })} ${units[u]}`;
}
