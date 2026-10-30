/**
 * Google için PlatformSender: bağlam → builder (saf) → toplu ingest (istemci). `prepare` içinde:
 *  - kaynak filtresi (varsayılan google_form, web_form; Meta formu lead'i Google tıklaması taşımaz) → no_match_key
 *  - eşleştirme anahtarı yok (gclid/gbraid/wbraid ya da e-posta/telefon) → no_match_key
 *  - yükleme penceresi geçti (tıklama 90 gün, yalnız e-posta/telefon 63 gün) → expired
 * Meta koduna dokunmaz; dağıtıcı değişmez.
 */
import type { Clock } from "../../../shared/kernel";
import type { OutboundStageEvent } from "../../../sales-pipeline/application";
import type { OutboundRow, PlatformSender, PrepareResult, PreparedEvent, SendResult } from "../../application";
import {
  buildGoogleEvent,
  buildGoogleRequest,
  checkUploadWindow,
  googleEventInputFrom,
  hasClickId,
  hasGoogleMatchKey,
  type GoogleEvent,
  type GoogleEventSource,
} from "../../builders/google";
import type { DataManagerClient } from "./client";

export const GOOGLE_PROVIDER = "google";

export interface GoogleSenderOptions {
  client: DataManagerClient;
  clock: Clock;
  /** integration_settings google/customer_id doluysa o, değilse ortam değişkeni. */
  customerId: () => Promise<string>;
  loginCustomerId: () => Promise<string>;
  validateOnly: boolean;
  clickWindowDays: number;
  userDataWindowDays: number;
  eventSource: GoogleEventSource;
  timeZone: string;
  sendSources: readonly string[];
}

export function googleDataManagerSender(o: GoogleSenderOptions): PlatformSender {
  return {
    provider: GOOGLE_PROVIDER,
    prepare(context: OutboundStageEvent, conversionActionId: string, row: OutboundRow): PrepareResult {
      if (!o.sendSources.includes(context.lead.source)) return { kind: "skip", reason: "no_match_key" };
      const event = buildGoogleEvent(
        googleEventInputFrom(context, conversionActionId, { timeZone: o.timeZone, eventSource: o.eventSource }),
      );
      if (!hasGoogleMatchKey(event)) return { kind: "skip", reason: "no_match_key" };
      const window = checkUploadWindow({
        now: o.clock.now(),
        clickAt: context.attribution?.clickAt ?? null,
        leadCreatedAt: context.lead.createdAt ?? null,
        occurredAt: context.occurredAt,
        hasClickId: hasClickId(event),
        clickWindowDays: o.clickWindowDays,
        userDataWindowDays: o.userDataWindowDays,
      });
      if (window.expired) return { kind: "skip", reason: "expired" };
      return { kind: "ready", event: { row, context, eventName: conversionActionId, payload: event } };
    },
    async send(events: readonly PreparedEvent[]): Promise<SendResult> {
      const customerId = await o.customerId();
      if (!customerId) return { kind: "retry", code: null, error: "Google Ads müşteri kimliği tanımlı değil." };
      const request = buildGoogleRequest(
        events.map((e) => e.payload as GoogleEvent),
        { customerId, loginCustomerId: (await o.loginCustomerId()) || undefined, validateOnly: o.validateOnly },
      );
      return o.client.ingest(request);
    },
  };
}
