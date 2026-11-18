/**
 * Arapça sözlük: `../dict.ts` içindeki bütün anahtarlar. Eksik anahtarı `../dict.ts` içindeki tip denetimi derlemede
 * yakalar; fazla anahtarı ve yer tutucu uyumunu `tests/i18n-parity.test.ts` denetler.
 */
import { AR_ADMIN } from "./admin";
import { AR_CONTACT } from "./contact";
import { AR_CORE } from "./core";
import { AR_LIST } from "./list";
import { AR_REPORT } from "./report";

export const AR = { ...AR_CORE, ...AR_CONTACT, ...AR_LIST, ...AR_REPORT, ...AR_ADMIN };

/** Aşama ve kayıp nedeni adları (API yalnız Türkçe ve İngilizce verir); anahtar `stage.<kod>` / `reason.<kod>`. */
export const AR_REF: Readonly<Record<string, string>> = {
  "stage.NEW": "عميل محتمل جديد",
  "stage.CONTACTED": "تم التواصل",
  "stage.QUALIFIED": "مؤهَّل",
  "stage.PROPOSAL": "تم إرسال عرض السعر",
  "stage.WON": "تم الفوز",
  "stage.LOST": "تمت الخسارة",
  "reason.price_too_high": "السعر مرتفع",
  "reason.competitor": "اختار شركة منافسة",
  "reason.postponed": "تأجّل المشروع / أُلغي",
  "reason.no_budget": "لا ميزانية / لا تمويل",
  "reason.no_response": "لا يردّ",
  "reason.site_permit": "مشكلة في الأرض / التصريح",
  "reason.unqualified": "غير مؤهَّل (خارج الفئة المستهدفة)",
};
