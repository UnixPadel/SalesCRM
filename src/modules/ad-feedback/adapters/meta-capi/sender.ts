/**
 * Meta için PlatformSender: bağlam → builder (saf) → toplu gönderim (istemci). Eşleştirme anahtarı olmayan
 * olay (lead_id, em, ph, fbc, fbp hiçbiri yok) gönderilmez: `skipped (no_match_key)`.
 */
import type { OutboundStageEvent } from "../../../sales-pipeline/application";
import type { OutboundRow, PlatformSender, PrepareResult, PreparedEvent, SendResult } from "../../application";
import {
  buildMetaEvent,
  hasMatchKey,
  metaEventInputFrom,
  serializeMetaBatch,
  type MetaEvent,
} from "../../builders/meta";
import type { CapiClient } from "./client";

export const META_PROVIDER = "meta";

export interface MetaSenderOptions {
  client: CapiClient;
  /** integration_settings `meta/dataset_id` doluysa o, değilse ortam değişkeni. */
  datasetId: () => Promise<string>;
  testEventCode?: string | undefined;
}

export function metaCapiSender(o: MetaSenderOptions): PlatformSender {
  return {
    provider: META_PROVIDER,
    prepare(context: OutboundStageEvent, eventName: string, row: OutboundRow): PrepareResult {
      const event = buildMetaEvent(metaEventInputFrom(context, eventName));
      if (!hasMatchKey(event)) return { kind: "skip", reason: "no_match_key" };
      return { kind: "ready", event: { row, context, eventName, payload: event } };
    },
    async send(events: readonly PreparedEvent[]): Promise<SendResult> {
      const body = serializeMetaBatch(
        events.map((e) => e.payload as MetaEvent),
        { testEventCode: o.testEventCode },
      );
      return o.client.sendEvents(await o.datasetId(), body);
    },
  };
}
