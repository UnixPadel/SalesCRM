/**
 * "Temas kaydet" diyaloğunun saf durum mantığı (Faz 7g, iş emri §5.3). Kural yazmaz: varsayılanlar sunucunun
 * `contact-form` yanıtından, listeler `/reference.contactRules`'tan okunur [M-B1]. React ve DOM yok (test edilir).
 */
import type {
  ActivityOutcomeDto,
  ActivityTypeDto,
  StageCodeDto,
  TrackingReferenceDto,
} from "../../modules/sales-pipeline/api/dto";
import type { ContactFormDto, LogContactBody, StageLineModeDto } from "../../modules/sales-pipeline/api/dto.contact";
import { displayCurrency } from "../../state/currency";

export type ContactRules = TrackingReferenceDto["contactRules"];

export interface DialogState {
  activityId: string | null;
  type: ActivityTypeDto;
  outcome: ActivityOutcomeDto;
  replied: boolean;
  note: string;
  /** null = şimdi. Değer `datetime-local` biçimi (yerel). */
  occurredAt: string | null;
  planNext: boolean;
  nextType: ActivityTypeDto;
  /** ISO; boş = sunucu varsayılanı. */
  nextDueAt: string;
  /** undefined = dokunma. */
  status: string | null | undefined;
  /**
   * Önerilen aşama satırının cevabı (fixed'de anlamsız). "İletişim kuruldu" satırı "Dönüş alındı mı?" sorusudur
   * (Evet = true, Hayır = false) ve önseçili gelmiyorsa null başlar: biri seçilmeden kaydedilemez. Öteki satırlar
   * (Kazanıldı, Kaybedildi) onay kutusudur, null olmaz.
   */
  stageChecked: boolean | null;
  /** "İlgisiz" seçilince beliren Kaybedildi satırı. */
  lostChecked: boolean;
  amount: string;
  currency: string;
  lostReason: string;
}

export const isTerminalStage = (s: StageCodeDto) => s === "WON" || s === "LOST";

export function defaultsFor(form: ContactFormDto, type: ActivityTypeDto, outcome: ActivityOutcomeDto) {
  return form.defaults[type]?.[outcome] ?? { next: null, stage: null };
}

/** Kanalın varsayılan sonucu (`/reference.contactRules.defaultOutcome`). */
export const defaultOutcome = (type: ActivityTypeDto, rules: ContactRules): ActivityOutcomeDto =>
  rules.defaultOutcome[type] ?? "awaiting_reply";

export const showsReplied = (outcome: ActivityOutcomeDto, rules: ContactRules) =>
  rules.repliedFlagOutcomes.includes(outcome);

export const repliedDefault = (type: ActivityTypeDto, rules: ContactRules) => rules.repliedDefaultTypes.includes(type);

/** Müşteri durumu alanı yalnız konuşulan temaslarda görünür (Dönüş, Olumsuz, Anlaşma, Teklif ya da "cevap verdi"). */
export const showsStatus = (form: ContactFormDto, s: Pick<DialogState, "outcome" | "replied">, rules: ContactRules) =>
  form.canSetStatus && (rules.statusOutcomes.includes(s.outcome) || (showsReplied(s.outcome, rules) && s.replied));

/** Seçime göre başlangıç değerleri; kanal ya da sonuç değişince yeniden hesaplanır. */
export function initialState(
  form: ContactFormDto,
  rules: ContactRules,
  opts: { type?: ActivityTypeDto; outcome?: ActivityOutcomeDto; activityId?: string | null } = {},
): DialogState {
  // Kanal önceden seçiliyse (liste hücresi, bağlantı) o kanalın planı tamamlanır; başka kanalın planı değil.
  const activityId =
    opts.activityId !== undefined
      ? opts.activityId
      : opts.type
        ? (form.completableByType[opts.type] ?? null)
        : form.completableId;
  const planned = form.openActivities.find((a) => a.id === activityId);
  const type = opts.type ?? planned?.type ?? form.defaultType;
  const outcome = opts.outcome ?? defaultOutcome(type, rules);
  return retarget(
    {
      activityId,
      type,
      outcome,
      replied: false,
      note: "",
      occurredAt: null,
      planNext: true,
      nextType: type,
      nextDueAt: "",
      status: undefined,
      stageChecked: false,
      lostChecked: false,
      amount: "",
      // Lead'in çalışma para birimi, yoksa sağ üstteki görünüm para birimi.
      currency: form.lead.currency || displayCurrency(),
      lostReason: "",
    },
    form,
    rules,
  );
}

/** Kanal ya da sonuç değişince bağlı alanları (cevap işareti, aşama satırı, sonraki takip) sunucu varsayılanına çeker. */
export function retarget(s: DialogState, form: ContactFormDto, rules: ContactRules): DialogState {
  const replied = showsReplied(s.outcome, rules) ? repliedDefault(s.type, rules) : false;
  const d = defaultsFor(form, s.type, s.outcome);
  const mode = d.stage?.mode;
  const preset = mode === "checked" || (mode === "checked_if_replied" && replied);
  // "Dönüş alındı mı?": önseçili değilse cevapsız başlar (kullanıcı Evet ya da Hayır demek zorundadır).
  const stageChecked = isReplyQuestion(d.stage) && !preset ? null : preset;
  return {
    ...s,
    replied,
    stageChecked,
    lostChecked: false,
    planNext: d.next !== null,
    nextType: d.next?.type ?? s.type,
    nextDueAt: d.next?.dueAt ?? "",
  };
}

/**
 * Aşama satırı "Dönüş alındı mı?" (Evet / Hayır) sorusu mu: hedefi "İletişim kuruldu" olan, sabit olmayan satır.
 * Evet aşamayı "İletişim kuruldu" yapar, Hayır aşamaya dokunmaz.
 */
export const isReplyQuestion = (line: { target: StageCodeDto; mode: StageLineModeDto } | null | undefined): boolean =>
  !!line && line.target === "CONTACTED" && line.mode !== "fixed";

/** Hücreden gelen sonuç ("Teklif gönderildi", "Dönüş alındı") kullanıcı değiştirmedikçe kanal değişiminde korunur. */
const outcomeFor = (
  s: DialogState,
  type: ActivityTypeDto,
  rules: ContactRules,
  preset: ActivityOutcomeDto | undefined,
): ActivityOutcomeDto => (preset && s.outcome === preset ? preset : defaultOutcome(type, rules));

/** Kanal değişimi. Kullanıcı planı elle seçmediyse (`planLocked`) tamamlanacak plan yeni kanala göre yeniden seçilir. */
export function changeChannel(
  s: DialogState,
  type: ActivityTypeDto,
  form: ContactFormDto,
  rules: ContactRules,
  o: { presetOutcome: ActivityOutcomeDto | undefined; planLocked: boolean },
): DialogState {
  return retarget(
    {
      ...s,
      type,
      outcome: outcomeFor(s, type, rules, o.presetOutcome),
      activityId: o.planLocked ? s.activityId : (form.completableByType[type] ?? null),
    },
    form,
    rules,
  );
}

/** Tamamlanacak planın elle seçimi: kanal planın türü olur, hücreden gelen sonuç korunur. */
export function pickPlan(
  s: DialogState,
  plan: { id: string; type: ActivityTypeDto },
  form: ContactFormDto,
  rules: ContactRules,
  presetOutcome: ActivityOutcomeDto | undefined,
): DialogState {
  return retarget(
    { ...s, activityId: plan.id, type: plan.type, outcome: outcomeFor(s, plan.type, rules, presetOutcome) },
    form,
    rules,
  );
}

/**
 * "Müşteri cevap verdi" değişince `checked_if_replied` aşama satırı onunla birlikte işaretlenir; işaret kalkınca
 * "Dönüş alındı mı?" sorusu cevapsıza döner.
 */
export function setReplied(s: DialogState, replied: boolean, form: ContactFormDto): DialogState {
  const line = defaultsFor(form, s.type, s.outcome).stage;
  if (line?.mode !== "checked_if_replied") return { ...s, replied };
  return { ...s, replied, stageChecked: replied ? true : isReplyQuestion(line) ? null : false };
}

export interface StageLineView {
  target: StageCodeDto;
  mode: StageLineModeDto;
}

/** Görünen aşama satırı: sonuçtan önerilen; yoksa "İlgisiz" seçiliyse Kaybedildi önerisi. */
export function stageLineView(s: DialogState, form: ContactFormDto, rules: ContactRules): StageLineView | null {
  const d = defaultsFor(form, s.type, s.outcome).stage;
  if (d) return d;
  if (
    !isTerminalStage(form.lead.currentStage) &&
    typeof s.status === "string" &&
    rules.statusSuggestsLost.includes(s.status)
  ) {
    return { target: "LOST", mode: "unchecked" };
  }
  return null;
}

/** Kaydedince istenecek aşama (yoksa null). */
export function effectiveTarget(s: DialogState, form: ContactFormDto, rules: ContactRules): StageCodeDto | null {
  const line = stageLineView(s, form, rules);
  if (!line) return null;
  if (line.mode === "fixed") return line.target;
  const checked =
    line.target === "LOST" && !defaultsFor(form, s.type, s.outcome).stage ? s.lostChecked : s.stageChecked;
  return checked ? line.target : null;
}

/** Sonraki takip alanı gösterilir mi: hedef aşama takip açıyor ya da kapatıyorsa hayır. */
export function nextBlocked(s: DialogState, form: ContactFormDto, rules: ContactRules): "proposal" | "closed" | null {
  if (isTerminalStage(form.lead.currentStage)) return "closed";
  const target = effectiveTarget(s, form, rules);
  if (target === "PROPOSAL") return "proposal";
  if (target && rules.noNextTargets.includes(target)) return "closed";
  return null;
}

const amountOk = (v: string) => /^\d+([.,]\d{1,2})?$/.test(v.trim()) && Number(v.replace(",", ".")) > 0;

/** İletişim kaydında dosyanın zorunlu olduğu kanallar (2026-11-24): WhatsApp ve telefon. */
export const FILE_REQUIRED_CHANNELS: readonly ActivityTypeDto[] = ["whatsapp", "call"];

const isLaterStage = (target: StageCodeDto | null): target is StageCodeDto =>
  !!target && target !== "NEW" && target !== "CONTACTED";

const channelPurpose = (type: ActivityTypeDto): string =>
  type === "whatsapp" || type === "call" || type === "email" ? `attach.purpose.${type}` : "attach.purpose.contact";

/**
 * İletişim kaydının dosya kuralı (2026-11-24): kutu her kanalda görünür; yalnız WhatsApp ve telefonda zorunludur.
 * Bir pencere = bir kanıt: kayıt aşamayı da değiştiriyorsa ayrıca dosya istenmez. İpucu, aşama ilerliyorsa o aşamanın
 * (Teklif, Kazanıldı…), değilse kanalın metnidir.
 */
export function evidenceRule(
  type: ActivityTypeDto,
  target: StageCodeDto | null,
): { required: boolean; purposeKey: string } {
  return {
    required: FILE_REQUIRED_CHANNELS.includes(type),
    purposeKey: isLaterStage(target) ? `attach.purpose.${target}` : channelPurpose(type),
  };
}

/**
 * Aşama penceresinin dosya kuralı: Nitelikli / Teklif / Kazanıldı / Kaybedildi'ye geçişte dosya zorunludur. Aşama
 * kapısında "İletişim kuruldu"ya geçiş temas kaydı gibi sayılır: seçilen kanala göre (`evidenceRule`).
 */
export function stageEvidenceRule(
  type: ActivityTypeDto,
  target: StageCodeDto,
): { required: boolean; purposeKey: string } {
  return isLaterStage(target) ? { required: true, purposeKey: `attach.purpose.${target}` } : evidenceRule(type, null);
}

/**
 * Kaydet pasifken altında yazılan gerekçeler (çeviri anahtarları). `fileCount` seçilen dosya sayısıdır; dosya
 * `evidenceRule`'a göre gerekiyorsa ve yoksa "contact.needFile" eklenir. Verilmezse dosya denetlenmez.
 */
export function saveBlockers(
  s: DialogState,
  form: ContactFormDto,
  rules: ContactRules,
  nowMs: number,
  fileCount?: number,
): string[] {
  const out: string[] = [];
  const target = effectiveTarget(s, form, rules);
  // Görüşme notu zorunludur (2026-11-19).
  if (!s.note.trim()) out.push("contact.needNote");
  if (fileCount !== undefined && fileCount < 1 && evidenceRule(s.type, target).required) out.push("contact.needFile");
  // "Dönüş alındı mı?" cevapsız bırakılamaz.
  if (isReplyQuestion(defaultsFor(form, s.type, s.outcome).stage) && s.stageChecked === null) {
    out.push("contact.needReplyAnswer");
  }
  if (target === "WON" && !amountOk(s.amount)) out.push("contact.needAmount");
  // Teklif tutarı isteğe bağlıdır; ama yazıldıysa okunamayan tutar sessizce düşmesin.
  if (target === "PROPOSAL" && s.amount.trim() && !amountOk(s.amount)) out.push("contact.badAmount");
  if (target === "LOST" && !s.lostReason) out.push("contact.needReason");
  if (s.occurredAt && new Date(s.occurredAt).getTime() > nowMs + rules.futureToleranceMinutes * 60_000) {
    out.push("contact.futureTime");
  }
  return out;
}

/** Gövde (tek istek): temas, plan tamamlama, takip, durum ve aşama birlikte. */
export function buildBody(s: DialogState, form: ContactFormDto, rules: ContactRules): LogContactBody {
  const target = effectiveTarget(s, form, rules);
  const blocked = nextBlocked(s, form, rules);
  const body: LogContactBody = {
    activityId: s.activityId,
    type: s.type,
    outcome: s.outcome,
    customerReplied: showsReplied(s.outcome, rules) && s.replied,
    note: s.note.trim(),
    next:
      !blocked && s.planNext && s.nextDueAt ? { type: s.nextType, dueAt: new Date(s.nextDueAt).toISOString() } : null,
  };
  if (s.occurredAt) body.occurredAt = new Date(s.occurredAt).toISOString();
  if (s.status !== undefined && showsStatus(form, s, rules)) body.customerStatus = s.status;
  if (target) {
    body.stage = { target };
    if (target === "WON" || (target === "PROPOSAL" && amountOk(s.amount))) {
      body.stage.value = { amount: Number(s.amount.replace(",", ".")), currency: s.currency };
    }
    if (target === "LOST") body.stage.lostReasonCode = s.lostReason;
  }
  return body;
}

/** `datetime-local` değeri (yerel saat) ↔ ISO. */
export function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
