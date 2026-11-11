/**
 * Data Manager API istek akıbeti (Faz 7c): `GET /v1/requestStatus:retrieve?requestId=…` yanıtını dağıtıcının
 * sağlayıcıdan bağımsız biçimine çevirir. Saf kod. Alan adları Google başvuru sayfasından (2026-11):
 * `requestStatusPerDestination[].requestStatus` (SUCCESS | PROCESSING | FAILED | PARTIAL_SUCCESS |
 * REQUEST_STATUS_UNKNOWN), `errorInfo.errorCounts[].recordCount`, `warningInfo.warningCounts[].recordCount`,
 * `eventsIngestionStatus.recordCount` (sayılar metin gelir). Tanınmayan alanlar yok sayılır.
 */
import type { PlatformRequestState, PlatformRequestStatus } from "../../application";

const STATE: Record<string, PlatformRequestState> = {
  SUCCESS: "success",
  PROCESSING: "processing",
  FAILED: "failure",
  PARTIAL_SUCCESS: "partial",
};

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : 0;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};

const sumCounts = (list: unknown): number =>
  Array.isArray(list)
    ? list.reduce<number>((s, x) => s + num((x as { recordCount?: unknown } | null)?.recordCount), 0)
    : 0;

/** Birden çok hedefte en kötü durum öne çıkar: hata > kısmi > işleniyor > başarılı. */
const overall = (states: readonly PlatformRequestState[]): PlatformRequestState => {
  if (!states.length) return "unknown";
  for (const s of ["failure", "partial", "processing", "unknown"] as const) if (states.includes(s)) return s;
  return "success";
};

export function translateRequestStatus(requestId: string, body: unknown): PlatformRequestStatus {
  const raw = (body as { requestStatusPerDestination?: unknown } | null)?.requestStatusPerDestination;
  const destinations = (Array.isArray(raw) ? raw : []).map((d) => {
    const x = (d ?? {}) as Record<string, unknown>;
    return {
      state: STATE[String(x["requestStatus"] ?? "")] ?? ("unknown" as const),
      recordCount: num((x["eventsIngestionStatus"] as { recordCount?: unknown } | undefined)?.recordCount),
      errorCount: sumCounts((x["errorInfo"] as { errorCounts?: unknown } | undefined)?.errorCounts),
      warningCount: sumCounts((x["warningInfo"] as { warningCounts?: unknown } | undefined)?.warningCounts),
    };
  });
  return { requestId, state: overall(destinations.map((d) => d.state)), destinations };
}
