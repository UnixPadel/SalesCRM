import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

/**
 * TR / EN arayüz sözlüğü (Genel plan: arayüz metinleri TR ve EN). Kütüphanesiz: anahtar → iki metin.
 * Dil tarayıcıda hatırlanır. Aşama ve kayıp nedeni adları sözlükte değil, API'den (stage_definitions) gelir.
 */
export type Lang = "tr" | "en";
const LANG_KEY = "unixcrm.v2.lang";

const DICT = {
  "nav.inbox": ["Gelen kutusu", "Inbox"],
  "nav.board": ["Pano", "Board"],
  "nav.today": ["Bugün", "Today"],
  "nav.reports": ["Raporlar", "Reports"],
  "nav.contacts": ["Kişiler", "Contacts"],
  "nav.newLead": ["Yeni lead", "New lead"],
  "lang.switch": ["Language: English", "Dil: Türkçe"],
  "common.cancel": ["Vazgeç", "Cancel"],
  "common.save": ["Kaydet", "Save"],
  "common.close": ["Kapat", "Close"],
  "common.search": ["Ara…", "Search…"],
  "common.loading": ["Yükleniyor…", "Loading…"],
  "common.all": ["Hepsi", "All"],
  "common.pool": ["Ortak havuz", "Shared pool"],
  "common.me": ["Ben", "Me"],
  "common.unknown": ["Belirsiz", "Unknown"],
  "common.retry": ["Tekrar dene", "Retry"],
  "common.back": ["Geri", "Back"],
  "common.yes": ["Evet", "Yes"],
  "common.no": ["Hayır", "No"],
  "source.meta_form": ["Meta", "Meta"],
  "source.google_form": ["Google", "Google"],
  "source.web_form": ["Web", "Web"],
  "source.manual": ["Manuel", "Manual"],
  "source.import": ["İçe aktarım", "Import"],
  "since.justNow": ["az önce", "just now"],
  "since.min": ["{n} dk", "{n} min"],
  "since.hour": ["{n} sa", "{n} h"],
  "since.day": ["{n} gün", "{n} d"],
  "since.ago": ["{t} önce", "{t} ago"],
  "inbox.title": ["Gelen kutusu", "Inbox"],
  "inbox.empty": ["Görünür lead yok.", "No visible leads."],
  "inbox.emptyHint": [
    "Yeni lead eklemek için sağ üstteki düğmeyi kullanın. Reklam formları Faz 2'de otomatik düşecek.",
    "Use the button in the top right to add a lead. Ad forms will arrive automatically in phase 2.",
  ],
  "inbox.stageFilter": ["Aşama", "Stage"],
  "inbox.includeTest": ["Test lead'leri", "Test leads"],
  "inbox.col.lead": ["Lead", "Lead"],
  "inbox.col.source": ["Kaynak", "Source"],
  "inbox.col.country": ["Ülke", "Country"],
  "inbox.col.stage": ["Aşama", "Stage"],
  "inbox.col.owner": ["Sorumlu", "Owner"],
  "inbox.col.age": ["Geleli", "Age"],
  "inbox.untouched1h": ["1 saattir dokunulmadı", "Untouched for 1 hour"],
  "inbox.untouched24h": ["24 saattir dokunulmadı", "Untouched for 24 hours"],
  "inbox.count": ["{n} lead", "{n} leads"],
  "notif.title": ["Bildirimler", "Notifications"],
  "notif.open": ["Bildirimler, {n} okunmamış", "Notifications, {n} unread"],
  "notif.empty": ["Bildirim yok.", "No notifications."],
  "notif.markAll": ["Tümünü okundu say", "Mark all as read"],
  "notif.lead_assigned": ["Yeni lead atandı: {name}", "New lead assigned: {name}"],
  "notif.test": ["TEST", "TEST"],
  "lead.title": ["Lead", "Lead"],
  "lead.notFound": ["Lead bulunamadı ya da görme yetkiniz yok.", "Lead not found or not visible to you."],
  "lead.contact": ["Kişi", "Contact"],
  "lead.project": ["Proje", "Project"],
  "lead.sourceDetail": ["Kaynak detayı", "Source details"],
  "lead.timeline": ["Zaman çizelgesi", "Timeline"],
  "lead.notes": ["Notlar", "Notes"],
  "lead.company": ["Firma", "Company"],
  "lead.city": ["Şehir", "City"],
  "lead.product": ["İlgilenilen ürün", "Product of interest"],
  "lead.owner": ["Sorumlu", "Owner"],
  "lead.created": ["Oluşturulma", "Created"],
  "lead.platformId": ["Platform kimliği", "Platform id"],
  "lead.campaign": ["Kampanya", "Campaign"],
  "lead.adset": ["Reklam seti", "Ad set"],
  "lead.ad": ["Reklam", "Ad"],
  "lead.isTest": ["Test lead'i", "Test lead"],
  "lead.take": ["Üstlen", "Take"],
  "lead.release": ["Havuza bırak", "Release to pool"],
  "lead.assignTo": ["Sorumlu ata", "Assign to"],
  "lead.taken": ["Lead üstlenildi", "Lead taken"],
  "lead.released": ["Lead havuza bırakıldı", "Lead released to the pool"],
  "lead.assigned": ["Sorumlu değişti", "Owner changed"],
  "stage.next": ["Sonraki aşama", "Next stage"],
  "stage.other": ["Başka aşama", "Other stage"],
  "stage.lost": ["Kaybedildi", "Lost"],
  "stage.terminalHint": [
    "Bu lead kapandı. Yeniden ilgi gösterirse yeni lead açın.",
    "This lead is closed. Open a new lead if interest returns.",
  ],
  "stage.changed": ["Aşama: {stage}", "Stage: {stage}"],
  "stage.undo": ["Geri al", "Undo"],
  "stage.undoUntil": ["Geri al ({t})", "Undo ({t})"],
  "stage.undone": ["Aşama değişikliği geri alındı", "Stage change undone"],
  "stage.backwardBlocked": [
    'Aşama geriye alınmaz. Yanlış tık için {n} dakika içinde "Geri al" kullanın.',
    'Stages do not move backwards. Use "Undo" within {n} minutes for a wrong click.',
  ],
  "stage.autoFill": ["otomatik", "auto"],
  "stage.by": ["{who} tarafından", "by {who}"],
  "stage.undoneTag": ["geri alındı", "undone"],
  "dialog.qualified.title": ["Nitelikli mi?", "Qualified?"],
  "dialog.qualified.lede": [
    'Üç sorunun üçü de "evet" ise lead nitelikli sayılır. Biri "hayır" ise Kaybedildi (niteliksiz) seçin.',
    'The lead is qualified only if all three answers are "yes". If one is "no", choose Lost (unqualified).',
  ],
  "q.budget_approved": ["Bütçe onaylı mı?", "Is the budget approved?"],
  "q.site_known": ["Proje yeri belli mi?", "Is the project site known?"],
  "q.install_within_12m": ["Kurulum 12 ay içinde mi?", "Is installation within 12 months?"],
  "dialog.qualified.confirm": ["Nitelikli olarak işaretle", "Mark as qualified"],
  "dialog.qualified.notAll": ['Üç sorunun üçü de "evet" olmalı.', 'All three answers must be "yes".'],
  "dialog.won.title": ["Kazanıldı", "Won"],
  "dialog.won.lede": [
    "Satış tutarı ve para birimi platformlara değer olarak gider.",
    "Deal value and currency are sent to the ad platforms as value.",
  ],
  "dialog.won.amount": ["Tutar", "Amount"],
  "dialog.won.currency": ["Para birimi", "Currency"],
  "dialog.won.confirm": ["Kazanıldı olarak işaretle", "Mark as won"],
  "dialog.won.amountErr": ["Sıfırdan büyük bir tutar girin.", "Enter an amount greater than zero."],
  "dialog.lost.title": ["Kaybedildi", "Lost"],
  "dialog.lost.lede": [
    "Neden zorunlu; kampanya optimizasyonu ve raporlar bu alandan beslenir.",
    "A reason is required; campaign optimisation and reports use it.",
  ],
  "dialog.lost.reason": ["Neden", "Reason"],
  "dialog.lost.confirm": ["Kaybedildi olarak işaretle", "Mark as lost"],
  "dialog.lost.reasonErr": ["Bir neden seçin.", "Choose a reason."],
  "new.title": ["Yeni lead", "New lead"],
  "new.fullName": ["Ad soyad", "Full name"],
  "new.email": ["E-posta", "E-mail"],
  "new.phone": ["Telefon", "Phone"],
  "new.phoneHint": ["Uluslararası biçim: +90 532 …", "International format: +90 532 …"],
  "new.country": ["Ülke", "Country"],
  "new.city": ["Şehir", "City"],
  "new.company": ["Firma", "Company"],
  "new.product": ["İlgilenilen ürün", "Product of interest"],
  "new.notes": ["Notlar", "Notes"],
  "new.assign": ["Sorumlu", "Owner"],
  "new.isTest": ["Test lead'i (raporlara ve platformlara girmez)", "Test lead (excluded from reports and platforms)"],
  "new.create": ["Lead oluştur", "Create lead"],
  "new.created": ["Lead oluşturuldu", "Lead created"],
  "new.personMatched": [
    "Bu kişi zaten kayıtlıydı; yeni lead aynı kişiye bağlandı.",
    "This person already existed; the new lead is linked to them.",
  ],
  "new.contactErr": ["E-posta ya da telefon zorunlu.", "E-mail or phone is required."],
  "board.title": ["Pano", "Board"],
  "board.dropHere": ["Buraya bırak", "Drop here"],
  "board.empty": ["Boş", "Empty"],
  "board.open": ["Aç", "Open"],
  "err.unauthorized": ["Oturum açılmamış.", "Not signed in."],
  "err.read_only": ["Görüntüleyici hesabı değişiklik yapamaz.", "Viewer accounts cannot make changes."],
  "err.not_found": ["Kayıt bulunamadı.", "Record not found."],
  "err.lead.forbidden": ["Bu lead başka bir satışçıya ait.", "This lead belongs to another rep."],
  "err.assign.forbidden": [
    "Satışçı lead'i yalnız üstlenebilir ya da havuza bırakabilir.",
    "A rep may only take a lead or release it to the pool.",
  ],
  "err.stage.same": ["Lead zaten bu aşamada.", "The lead is already in this stage."],
  "err.stage.terminal": [
    "Kapanan lead'in aşaması değişmez; yeni lead açın.",
    "A closed lead cannot change stage; open a new lead.",
  ],
  "err.stage.backward": ["Aşama geriye alınmaz.", "Stages do not move backwards."],
  "err.stage.value_required": ["Kazanıldı için tutar ve para birimi zorunlu.", "Won requires an amount and currency."],
  "err.stage.reason_required": ["Kaybedildi için neden zorunlu.", "Lost requires a reason."],
  "err.stage.reason_unknown": ["Kayıp nedeni listede yok.", "Unknown loss reason."],
  "err.stage.qualification_incomplete": ["Üç soru da yanıtlanmalı.", "All three questions must be answered."],
  "err.stage.not_qualified": ['Üç sorunun üçü de "evet" olmalı.', 'All three answers must be "yes".'],
  "err.undo.nothing": ["Geri alınacak değişiklik yok.", "Nothing to undo."],
  "err.undo.expired": ["Geri alma süresi doldu.", "The undo window has expired."],
  "err.undo.not_owner": [
    "Yalnız değişikliği yapan kişi ya da admin geri alabilir.",
    "Only the person who made the change or an admin can undo.",
  ],
  "err.lead.name_required": ["Ad soyad zorunlu.", "Full name is required."],
  "err.lead.contact_required": ["E-posta ya da telefon zorunlu.", "E-mail or phone is required."],
  "err.lead.country_invalid": ["Ülke seçin.", "Choose a country."],
  "err.email.invalid": ["Geçerli bir e-posta adresi girin.", "Enter a valid e-mail address."],
  "err.phone.invalid": [
    "Telefon numarası uluslararası biçimde olmalı (+90 532 …).",
    "Phone must be in international format (+90 532 …).",
  ],
  "err.phone.empty": ["Telefon numarası girin.", "Enter a phone number."],
  "err.money.amount_negative": ["Tutar negatif olamaz.", "Amount cannot be negative."],
  "err.money.currency_invalid": ["Para birimi seçin.", "Choose a currency."],
  "err.internal": ["Beklenmeyen hata. Lütfen tekrar deneyin.", "Unexpected error. Please try again."],
  "err.network": ["Sunucuya ulaşılamadı.", "Could not reach the server."],
} as const satisfies Record<string, readonly [string, string]>;

export type TKey = keyof typeof DICT;

export function translate(lang: Lang, key: TKey | string, vars: Record<string, string | number> = {}): string {
  const entry = (DICT as Record<string, readonly [string, string]>)[key];
  let s = entry ? entry[lang === "tr" ? 0 : 1] : key;
  for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

interface LangCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: TKey | string, vars?: Record<string, string | number>) => string;
}
const Ctx = createContext<LangCtx | null>(null);

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    try {
      return localStorage.getItem(LANG_KEY) === "en" ? "en" : "tr";
    } catch {
      return "tr";
    }
  });
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(LANG_KEY, l);
    } catch {
      /* per-viewer convenience only */
    }
    document.documentElement.lang = l;
  }, []);
  const t = useCallback<LangCtx["t"]>((key, vars) => translate(lang, key, vars), [lang]);
  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLang(): LangCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useLang needs LangProvider");
  return c;
}
