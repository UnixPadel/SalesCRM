/**
 * Meta Conversions API (CRM olayları) payload builder — saf kod, ağ yok.
 * Rehber ve Genel plan: event_name = eşleme tablosundaki ad; event_time = aşama anı (Unix saniye);
 * action_source = system_generated (Meta formu lead'i, user_data.lead_id = leadgen_id) ya da website
 * (web formu lead'i: lead_id yok, _fbc/_fbp ve event_source_url); em/ph SHA-256; custom_data.event_source = crm,
 * lead_event_source = Unixpadel CRM; WON'da value ve currency.
 * `lead_id` 64-bit tam sayıdır: JSON'a sayı olarak, hassasiyet kaybı olmadan yazılır (JSON.rawJSON).
 */
import type { OutboundStageEvent } from "../../../sales-pipeline/application";
import { hashEmailForMeta, hashPhoneForMeta } from "./normalize";

export const META_EVENT_SOURCE = "crm";
export const META_LEAD_EVENT_SOURCE = "Unixpadel CRM";

export type MetaActionSource = "system_generated" | "website";

export interface MetaEventInput {
  eventName: string;
  occurredAt: Date;
  /** Meta formu lead'i: leadgen_id (yalnız rakam). Web formu lead'inde null. */
  leadId: string | null;
  actionSource: MetaActionSource;
  email: string | null;
  phone: string | null;
  fbc?: string | null | undefined;
  fbp?: string | null | undefined;
  /** action_source=website için zorunlu: formun bulunduğu sayfa. */
  eventSourceUrl?: string | null | undefined;
  value?: { amount: number; currency: string } | null | undefined;
  /** Aynı olayın yeniden gönderiminde Meta'nın tekilleştirmesi için (aşama olayı kimliği). */
  eventId?: string | undefined;
}

export interface MetaUserData {
  /** Rakam dizisi; serileştirmede JSON sayısına çevrilir. */
  lead_id?: string;
  em?: string[];
  ph?: string[];
  fbc?: string;
  fbp?: string;
}

export interface MetaEvent {
  event_name: string;
  event_time: number;
  event_id?: string;
  action_source: MetaActionSource;
  event_source_url?: string;
  user_data: MetaUserData;
  custom_data: {
    event_source: typeof META_EVENT_SOURCE;
    lead_event_source: typeof META_LEAD_EVENT_SOURCE;
    value?: number;
    currency?: string;
  };
}

const LEAD_ID_RE = /^[1-9]\d{0,19}$/;

/** Geçerli 64-bit lead kimliği mi (yalnız rakam, en çok 20 hane, 2^64'ten küçük). */
export function isValidMetaLeadId(v: string | null | undefined): v is string {
  if (!v || !LEAD_ID_RE.test(v)) return false;
  return v.length < 20 || v <= "18446744073709551615";
}

export function buildMetaEvent(i: MetaEventInput): MetaEvent {
  const user: MetaUserData = {};
  if (i.actionSource === "system_generated" && isValidMetaLeadId(i.leadId)) user.lead_id = i.leadId;
  const em = hashEmailForMeta(i.email);
  const ph = hashPhoneForMeta(i.phone);
  if (em) user.em = [em];
  if (ph) user.ph = [ph];
  if (i.fbc) user.fbc = i.fbc;
  if (i.fbp) user.fbp = i.fbp;

  const event: MetaEvent = {
    event_name: i.eventName,
    event_time: Math.floor(i.occurredAt.getTime() / 1000),
    action_source: i.actionSource,
    user_data: user,
    custom_data: { event_source: META_EVENT_SOURCE, lead_event_source: META_LEAD_EVENT_SOURCE },
  };
  if (i.eventId) event.event_id = i.eventId;
  if (i.actionSource === "website" && i.eventSourceUrl) event.event_source_url = i.eventSourceUrl;
  if (i.value) {
    event.custom_data.value = i.value.amount;
    event.custom_data.currency = i.value.currency.toUpperCase();
  }
  return event;
}

/** Gönderilebilir mi: Meta en az bir eşleştirme anahtarı ister (lead_id, em, ph, fbc veya fbp). */
export function hasMatchKey(e: MetaEvent): boolean {
  const u = e.user_data;
  return Boolean(u.lead_id || u.em?.length || u.ph?.length || u.fbc || u.fbp);
}

export interface MetaBatchOptions {
  /** Staging: Events Manager → Test Olayları kodu; canlıda boş. */
  testEventCode?: string | undefined;
  /** Test kancası: JSON.rawJSON yerine serileştirici; `null` → yer tutucu değişimi yolu zorlanır. */
  rawJson?: ((s: string) => unknown) | null | undefined;
}

type RawJsonFn = (s: string) => unknown;
const nativeRawJson: RawJsonFn | undefined = (JSON as unknown as { rawJSON?: RawJsonFn }).rawJSON?.bind(JSON);

/**
 * Toplu istek gövdesi. `lead_id` sayı olarak yazılır: JSON.rawJSON varsa onunla, yoksa yer tutucu ile.
 * 64-bit değer JS number'a hiç çevrilmez.
 */
export function serializeMetaBatch(events: readonly MetaEvent[], opts: MetaBatchOptions = {}): string {
  const rawJson = opts.rawJson === null ? undefined : (opts.rawJson ?? nativeRawJson);
  const placeholders = new Map<string, string>();
  const data = events.map((e, idx) => {
    if (!e.user_data.lead_id) return e;
    const id = e.user_data.lead_id;
    if (rawJson) return { ...e, user_data: { ...e.user_data, lead_id: rawJson(id) } };
    const token = `__META_LEAD_ID_${idx}__`;
    placeholders.set(`"${token}"`, id);
    return { ...e, user_data: { ...e.user_data, lead_id: token } };
  });
  const body: Record<string, unknown> = { data };
  if (opts.testEventCode) body["test_event_code"] = opts.testEventCode;
  let json = JSON.stringify(body);
  for (const [token, id] of placeholders) json = json.replace(token, id);
  return json;
}

/** sales-pipeline bağlamı → builder girdisi. Kaynağa göre action_source seçilir. */
export function metaEventInputFrom(ctx: OutboundStageEvent, eventName: string): MetaEventInput {
  const web = ctx.lead.source === "web_form";
  return {
    eventName,
    occurredAt: ctx.occurredAt,
    leadId: web ? null : ctx.lead.platformLeadId,
    actionSource: web ? "website" : "system_generated",
    email: ctx.lead.email,
    phone: ctx.lead.phoneE164,
    fbc: ctx.attribution?.fbc ?? null,
    fbp: ctx.attribution?.fbp ?? null,
    eventSourceUrl: ctx.attribution?.landingUrl ?? null,
    value: ctx.stageCode === "WON" ? ctx.value : null,
    eventId: ctx.stageEventId,
  };
}
