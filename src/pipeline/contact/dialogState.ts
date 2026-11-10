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
  /** Önerilen aşama satırının onay kutusu (fixed'de anlamsız). */
  stageChecked: boolean;
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
  const activityId = opts.activityId !== undefined ? opts.activityId : form.completableId;
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
      currency: "EUR",
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
  const stageChecked = mode === "checked" || (mode === "checked_if_replied" && replied);
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

/** "Müşteri cevap verdi" değişince `checked_if_replied` aşama satırı onunla birlikte işaretlenir. */
export function setReplied(s: DialogState, replied: boolean, form: ContactFormDto): DialogState {
  const mode = defaultsFor(form, s.type, s.outcome).stage?.mode;
  return { ...s, replied, stageChecked: mode === "checked_if_replied" ? replied : s.stageChecked };
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

/** Kaydet pasifken altında yazılan gerekçeler (çeviri anahtarları). */
export function saveBlockers(s: DialogState, form: ContactFormDto, rules: ContactRules, nowMs: number): string[] {
  const out: string[] = [];
  const target = effectiveTarget(s, form, rules);
  if (target === "WON" && !amountOk(s.amount)) out.push("contact.needAmount");
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
