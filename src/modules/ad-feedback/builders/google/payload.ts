/**
 * Google Data Manager API `events:ingest` payload builder — saf kod, ağ yok (ADR-0012).
 * Olay: transactionId (= aşama olayı kimliği, tekilleştirme), eventTimestamp (RFC 3339, saat dilimi ofsetiyle),
 * eventSource, userData.userIdentifiers (emailAddress / phoneNumber SHA-256 hex), adIdentifiers (gclid/gbraid/wbraid),
 * WON'da (ve girildiyse PROPOSAL'da) conversionValue + currency, consent (adUserData, adPersonalization).
 * İstek: destinations (hedef = Google Ads hesabı + dönüşüm işlemi), encoding HEX, validateOnly (staging).
 */
import type { OutboundStageEvent } from "../../../sales-pipeline/application";
import { hashEmailForGoogle, hashPhoneForGoogle } from "./normalize";

export const GOOGLE_ACCOUNT_TYPE = "GOOGLE_ADS";
export type GoogleEventSource = "WEB" | "APP" | "IN_STORE" | "PHONE" | "MESSAGE" | "OTHER";
export type GoogleConsentStatus = "CONSENT_GRANTED" | "CONSENT_DENIED" | "CONSENT_STATUS_UNSPECIFIED";

export interface GoogleEventInput {
  /** Dönüşüm işlemi kimliği (platform_stage_mappings.platform_event_name); hedef referansı olarak da kullanılır. */
  conversionActionId: string;
  transactionId: string;
  occurredAt: Date;
  timeZone: string;
  eventSource: GoogleEventSource;
  email: string | null;
  phone: string | null;
  gclid?: string | null | undefined;
  gbraid?: string | null | undefined;
  wbraid?: string | null | undefined;
  value?: { amount: number; currency: string } | null | undefined;
  consent?: { adUserData: GoogleConsentStatus; adPersonalization: GoogleConsentStatus } | undefined;
}

export type GoogleUserIdentifier = { emailAddress: string } | { phoneNumber: string };

export interface GoogleEvent {
  destinationReferences: string[];
  transactionId: string;
  eventTimestamp: string;
  eventSource: GoogleEventSource;
  userData?: { userIdentifiers: GoogleUserIdentifier[] };
  adIdentifiers?: { gclid?: string; gbraid?: string; wbraid?: string };
  conversionValue?: number;
  currency?: string;
  consent: { adUserData: GoogleConsentStatus; adPersonalization: GoogleConsentStatus };
}

export interface GoogleDestination {
  reference: string;
  operatingAccount: { accountType: typeof GOOGLE_ACCOUNT_TYPE; accountId: string };
  loginAccount?: { accountType: typeof GOOGLE_ACCOUNT_TYPE; accountId: string };
  productDestinationId: string;
}

export interface GoogleIngestRequest {
  destinations: GoogleDestination[];
  encoding: "HEX";
  validateOnly?: boolean;
  events: GoogleEvent[];
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Saat dilimi ofsetini dakika olarak verir (Intl; Node 22'de tam ICU). */
export function timeZoneOffsetMinutes(date: Date, timeZone: string): number {
  const part = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
    .formatToParts(date)
    .find((p) => p.type === "timeZoneName")?.value;
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(part ?? "");
  if (!m) return 0;
  const sign = m[1] === "-" ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3]));
}

/** RFC 3339, verilen saat diliminin ofsetiyle: 2026-03-01T13:00:00.000+03:00 */
export function formatRfc3339(date: Date, timeZone: string): string {
  const offset = timeZoneOffsetMinutes(date, timeZone);
  const local = new Date(date.getTime() + offset * 60_000);
  const sign = offset < 0 ? "-" : "+";
  const abs = Math.abs(offset);
  return (
    `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}` +
    `T${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}` +
    `.${String(local.getUTCMilliseconds()).padStart(3, "0")}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

const CLICK_ID_RE = /^[A-Za-z0-9_.-]{1,512}$/;
const clean = (v: string | null | undefined): string | undefined => {
  const s = String(v ?? "").trim();
  return s && CLICK_ID_RE.test(s) ? s : undefined;
};

export function buildGoogleEvent(i: GoogleEventInput): GoogleEvent {
  const ids: GoogleUserIdentifier[] = [];
  const em = hashEmailForGoogle(i.email);
  const ph = hashPhoneForGoogle(i.phone);
  if (em) ids.push({ emailAddress: em });
  if (ph) ids.push({ phoneNumber: ph });
  const ad: NonNullable<GoogleEvent["adIdentifiers"]> = {};
  const gclid = clean(i.gclid);
  const gbraid = clean(i.gbraid);
  const wbraid = clean(i.wbraid);
  if (gclid) ad.gclid = gclid;
  if (gbraid) ad.gbraid = gbraid;
  if (wbraid) ad.wbraid = wbraid;

  const event: GoogleEvent = {
    destinationReferences: [i.conversionActionId],
    transactionId: i.transactionId,
    eventTimestamp: formatRfc3339(i.occurredAt, i.timeZone),
    eventSource: i.eventSource,
    consent: i.consent ?? { adUserData: "CONSENT_GRANTED", adPersonalization: "CONSENT_GRANTED" },
  };
  if (ids.length) event.userData = { userIdentifiers: ids };
  if (Object.keys(ad).length) event.adIdentifiers = ad;
  if (i.value) {
    event.conversionValue = i.value.amount;
    event.currency = i.value.currency.toUpperCase();
  }
  return event;
}

export const hasClickId = (e: GoogleEvent): boolean => Boolean(e.adIdentifiers && Object.keys(e.adIdentifiers).length);
export const hasGoogleMatchKey = (e: GoogleEvent): boolean =>
  hasClickId(e) || Boolean(e.userData?.userIdentifiers.length);

export interface GoogleRequestOptions {
  customerId: string;
  loginCustomerId?: string | undefined;
  validateOnly?: boolean | undefined;
}

/** Olayların referans verdiği her dönüşüm işlemi için bir hedef; müşteri kimliği tiresiz 10 hane. */
export function buildGoogleRequest(events: readonly GoogleEvent[], o: GoogleRequestOptions): GoogleIngestRequest {
  const customerId = o.customerId.replace(/-/g, "");
  const actionIds = [...new Set(events.flatMap((e) => e.destinationReferences))];
  const destinations = actionIds.map((id): GoogleDestination => {
    const d: GoogleDestination = {
      reference: id,
      operatingAccount: { accountType: GOOGLE_ACCOUNT_TYPE, accountId: customerId },
      productDestinationId: id,
    };
    if (o.loginCustomerId)
      d.loginAccount = { accountType: GOOGLE_ACCOUNT_TYPE, accountId: o.loginCustomerId.replace(/-/g, "") };
    return d;
  });
  const req: GoogleIngestRequest = { destinations, encoding: "HEX", events: [...events] };
  if (o.validateOnly) req.validateOnly = true;
  return req;
}

/** sales-pipeline bağlamı → builder girdisi. */
export function googleEventInputFrom(
  ctx: OutboundStageEvent,
  conversionActionId: string,
  o: { timeZone: string; eventSource: GoogleEventSource },
): GoogleEventInput {
  return {
    conversionActionId,
    transactionId: ctx.stageEventId,
    occurredAt: ctx.occurredAt,
    timeZone: o.timeZone,
    eventSource: o.eventSource,
    email: ctx.lead.email,
    phone: ctx.lead.phoneE164,
    gclid: ctx.attribution?.gclid ?? null,
    gbraid: ctx.attribution?.gbraid ?? null,
    wbraid: ctx.attribution?.wbraid ?? null,
    value: ctx.stageCode === "WON" || ctx.stageCode === "PROPOSAL" ? ctx.value : null,
  };
}
