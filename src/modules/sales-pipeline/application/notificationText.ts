/**
 * Push bildiriminin metni. Tarayıcıdaki bildirim arayüz kapalıyken gösterilir, bu yüzden metni sunucu kurar; dil,
 * kişinin o tarayıcıda aboneliği açtığı andaki arayüz dilidir. Zildeki metinler `src/i18n` `notif.*` anahtarlarıdır
 * ve bunlarla aynı cümleleri taşır: birini değiştiren diğerini de değiştirir.
 */
import type { Notification, NotificationType } from "./notifications";

export type PushLang = "tr" | "en" | "ar";
export const isPushLang = (v: unknown): v is PushLang => v === "tr" || v === "en" || v === "ar";

const TEXT: Record<PushLang, Record<NotificationType, string>> = {
  tr: {
    lead_assigned: "Yeni lead atandı: {name}",
    lead_transferred: "Lead size devredildi: {name}",
    form_resubmitted: "{name} formu tekrar doldurdu",
    activity_due: "İş zamanı geldi: {name}",
    activity_overdue: "Geciken iş: {name}",
    hot_untouched: "Sıcak lead bekliyor: {name} · {hours} saattir işlem yok",
    hot_untouched_manager: "Sıcak lead'e {hours} saattir dokunulmadı: {name}",
  },
  en: {
    lead_assigned: "New lead assigned: {name}",
    lead_transferred: "A lead was handed over to you: {name}",
    form_resubmitted: "{name} filled in the form again",
    activity_due: "Task due now: {name}",
    activity_overdue: "Overdue task: {name}",
    hot_untouched: "Hot lead waiting: {name} · no action for {hours} h",
    hot_untouched_manager: "Hot lead untouched for {hours} h: {name}",
  },
  ar: {
    lead_assigned: "عميل محتمل جديد مُسند إليك: {name}",
    lead_transferred: "تم تحويل عميل محتمل إليك: {name}",
    form_resubmitted: "أعاد {name} تعبئة النموذج",
    activity_due: "حان موعد مهمة: {name}",
    activity_overdue: "مهمة متأخرة: {name}",
    hot_untouched: "عميل محتمل ساخن بانتظارك: {name} · لا إجراء منذ {hours} ساعة",
    hot_untouched_manager: "عميل محتمل ساخن بلا إجراء منذ {hours} ساعة: {name}",
  },
};

const parse = (raw: string): Record<string, unknown> => {
  try {
    const v = JSON.parse(raw) as unknown;
    return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

const text = (v: unknown): string => (typeof v === "string" || typeof v === "number" ? String(v) : "");

/** Başlık: olayın cümlesi. Gövde: işin konusu, firma, ülke (olanlar). */
export function pushText(
  n: Pick<Notification, "type" | "title" | "body">,
  lang: PushLang,
): { title: string; body: string } {
  const b = parse(n.body);
  const template = TEXT[lang][n.type];
  const title = template
    ? template.replace("{name}", text(b["leadName"]) || "—").replace("{hours}", text(b["hours"]))
    : n.title;
  const body = [text(b["subject"]), text(b["company"]), text(b["country"])].filter(Boolean).join(" · ");
  return { title, body };
}
