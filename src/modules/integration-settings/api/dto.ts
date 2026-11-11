/**
 * Yönetim paneli API sözleşmesi (`/api/admin`, Faz 7a–7c). Arayüz bu tipleri kullanır. Tarihler ISO metin.
 * Secret değeri hiçbir yanıtta yoktur: yalnız ortam değişkeninin adı ve "tanımlı mı" bilgisi.
 */
export interface AdminErrorDto {
  error: string;
  code: string;
  details?: Record<string, unknown>;
}

export interface CountDto {
  provider: string;
  status: string;
  count: number;
}

export interface ProviderHealthDto {
  provider: string;
  /** Gelen akış (webhook / form) yapılandırıldı mı; bu sağlayıcıda gelen akış yoksa null. */
  inbound: { configured: boolean } | null;
  /** Giden akış: gönderici kurulu mu, ENABLED_PROVIDERS'ta mı, acil durdurma anahtarı açık mı, akıbet sorgusu var mı. */
  outbound: { configured: boolean; listed: boolean; enabled: boolean; statusQuery: boolean } | null;
  secrets: { name: string; set: boolean }[];
}

export interface HealthDto {
  generatedAt: string;
  providers: ProviderHealthDto[];
  /** Sağlayıcıya bağlı olmayan gizli ayarlar (şifreleme anahtarı, SMTP…). */
  secrets: { name: string; set: boolean }[];
  inbox: {
    counts: CountDto[];
    receivedLastDay: number;
    oldestPendingAt: string | null;
    lastPurgedAt: string | null;
    purgeBacklog: number;
    retentionDays: number;
  };
  outbox: {
    counts: CountDto[];
    skipReasons: { provider: string; reason: string; count: number }[];
    oldestDueAt: string | null;
    lastSentAt: string | null;
  };
}

export interface OutboxItemDto {
  id: string;
  provider: string;
  status: string;
  attempts: number;
  nextAttemptAt: string;
  skipReason: string | null;
  lastResponseCode: number | null;
  lastError: string | null;
  createdAt: string;
  finishedAt: string | null;
  sentAt: string | null;
  hasRequestId: boolean;
  leadId: string | null;
  stageCode: string | null;
  occurredAt: string | null;
}

export interface InboxFailedDto {
  id: string;
  provider: string;
  kind: string;
  receivedAt: string;
  attempts: number;
  lastErrorCode: string | null;
  lastError: string | null;
  leadId: string | null;
  processedAt: string | null;
  hasPayload: boolean;
}

export interface RequeueBody {
  ids: string[];
}
export interface RequeueResultDto {
  requeued: number;
}

export interface RequestStatusDto {
  requestId: string;
  state: "processing" | "success" | "partial" | "failure" | "unknown";
  destinations: { state: string; recordCount: number; errorCount: number; warningCount: number }[];
}

export interface StageMappingDto {
  stageCode: string;
  platformEventName: string;
  enabled: boolean;
  isOptimizationTarget: boolean;
}
export interface StageMappingsDto {
  provider: string;
  /** Altı aşamanın hepsi; satırı olmayan aşama boş ve kapalı gelir. */
  rows: StageMappingDto[];
}

export interface FieldMappingDto {
  id: string;
  /** null: sağlayıcı varsayılanı (bütün formlar). */
  formId: string | null;
  platformField: string;
  target: string;
  isActive: boolean;
}
export interface FieldMappingsDto {
  provider: string;
  targets: string[];
  rows: FieldMappingDto[];
}
export interface FieldMappingBody {
  id?: string | null;
  formId?: string | null;
  platformField: string;
  target: string;
  isActive?: boolean;
}

export interface SettingDto {
  key: string;
  /** "text": tek değer; "list": virgülle ayrılmış kimlikler (JSON dizi olarak saklanır). */
  kind: "text" | "list";
  value: string;
  updatedAt: string | null;
}
export interface ProviderSettingsDto {
  provider: string;
  settings: SettingDto[];
  secrets: { name: string; set: boolean }[];
}
export interface SettingsBody {
  values: Record<string, string>;
}

export interface EurRatesDto {
  /** EUR karşılığı çarpanlar (EUR her zaman 1). */
  rates: Record<string, number>;
  /** Kurların geldiği yer: yönetim ekranı, ortam değişkeni ya da varsayılan tablo. */
  source: "setting" | "env" | "default";
  updatedAt: string | null;
}
export interface EurRatesBody {
  rates: Record<string, number>;
}
