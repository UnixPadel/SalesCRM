import { describe, expect, it } from "vitest";
import {
  ATTACHMENT_MAX_BYTES,
  attachmentExtension,
  base64Size,
  cleanFileName,
  isImageAttachment,
  validateDeleteReason,
  validateUpload,
} from "./attachment";

const b64 = (bytes: number) => Buffer.alloc(bytes, 1).toString("base64");
const code = (r: { ok: boolean; error?: { code: string } }) => (r.ok ? "ok" : r.error?.code);

describe("dosya eki kuralları", () => {
  it("uzantı küçük harfe çevrilir; içerik türü uzantıdan gelir", () => {
    expect(attachmentExtension("Teklif.PDF")).toBe("pdf");
    expect(attachmentExtension("adsiz")).toBe("");
    const r = validateUpload("Saha Fotoğrafı.JPG", b64(10));
    expect(r.ok && r.value).toEqual({ fileName: "Saha Fotoğrafı.JPG", mimeType: "image/jpeg", sizeBytes: 10 });
    expect(isImageAttachment("image/jpeg")).toBe(true);
    expect(isImageAttachment("application/pdf")).toBe(false);
  });

  it("pdf, görsel, belge ve tablo türleri kabul edilir; çalıştırılabilir ve html reddedilir", () => {
    for (const name of ["a.pdf", "a.jpeg", "a.jpg", "a.png", "a.docx", "a.csv", "a.xlsx"]) {
      expect(code(validateUpload(name, b64(3))), name).toBe("ok");
    }
    for (const name of ["a.exe", "a.html", "a.svg", "a.js", "uzantisiz"]) {
      expect(code(validateUpload(name, b64(3))), name).toBe("attachment.type");
    }
  });

  it("ad: yol parçaları ve denetim karakterleri atılır; boş ad reddedilir", () => {
    expect(cleanFileName("C:\\Users\\x\\teklif.pdf")).toBe("teklif.pdf");
    expect(cleanFileName("../../etc/passwd.txt")).toBe("passwd.txt");
    expect(cleanFileName('a<b>:"c|d?.png')).toBe("abcd.png");
    expect(cleanFileName("  ")).toBe("dosya");
    expect(code(validateUpload("", b64(3)))).toBe("attachment.name");
    expect(code(validateUpload(42, b64(3)))).toBe("attachment.name");
  });

  it("boyut: boş, bozuk base64 ve 10 MB üstü reddedilir", () => {
    expect(base64Size(b64(1))).toBe(1);
    expect(base64Size(b64(2))).toBe(2);
    expect(base64Size(b64(3))).toBe(3);
    expect(base64Size("not base64!")).toBeNull();
    expect(code(validateUpload("a.pdf", ""))).toBe("attachment.empty");
    expect(code(validateUpload("a.pdf", undefined))).toBe("attachment.empty");
    expect(code(validateUpload("a.pdf", "%%%%"))).toBe("attachment.empty");
    expect(code(validateUpload("a.pdf", b64(ATTACHMENT_MAX_BYTES)))).toBe("ok");
    expect(code(validateUpload("a.pdf", b64(ATTACHMENT_MAX_BYTES + 1)))).toBe("attachment.too_large");
  });

  it("silme nedeni zorunlu: boş, boşluk ve çok kısa reddedilir; kırpılır", () => {
    expect(code(validateDeleteReason(""))).toBe("attachment.reason");
    expect(code(validateDeleteReason("   "))).toBe("attachment.reason");
    expect(code(validateDeleteReason("ab"))).toBe("attachment.reason");
    expect(code(validateDeleteReason(undefined))).toBe("attachment.reason");
    const r = validateDeleteReason("  Yanlış dosya  ");
    expect(r.ok && r.value).toBe("Yanlış dosya");
    const long = validateDeleteReason("x".repeat(900));
    expect(long.ok && long.value.length).toBe(500);
  });
});
