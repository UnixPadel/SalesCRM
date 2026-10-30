/**
 * Google yükleme penceresi (Google Ads yardımı, ADR-0012): tıklama kimliğiyle gönderilen dönüşüm son tıklamadan
 * 90 gün, yalnız e-posta/telefonla eşleşen 63 gün sonra içe alınmaz. Taban: tıklama zamanı; bilinmiyorsa lead'in
 * CRM'e düştüğü an; o da yoksa aşama zamanı. Sınır dahil: 90. gün geçerli, 91. gün `expired`. Saf kod.
 */
const DAY_MS = 24 * 60 * 60 * 1000;

export interface WindowInput {
  /** Dağıtım anı (yükleme zamanı). */
  now: Date;
  clickAt: Date | null | undefined;
  leadCreatedAt: Date | null | undefined;
  occurredAt: Date;
  hasClickId: boolean;
  clickWindowDays: number;
  userDataWindowDays: number;
}

export interface WindowResult {
  expired: boolean;
  basis: Date;
  ageDays: number;
  windowDays: number;
}

export function checkUploadWindow(i: WindowInput): WindowResult {
  const basis = i.clickAt ?? i.leadCreatedAt ?? i.occurredAt;
  const windowDays = i.hasClickId ? i.clickWindowDays : i.userDataWindowDays;
  const ageDays = Math.floor((i.now.getTime() - basis.getTime()) / DAY_MS);
  return { expired: ageDays > windowDays, basis, ageDays, windowDays };
}
