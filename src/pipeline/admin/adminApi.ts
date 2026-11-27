import { api, ApiError } from "../../data/api";
import type {
  EurRatesDto,
  FieldMappingBody,
  FieldMappingsDto,
  HealthDto,
  InboxFailedDto,
  OutboxItemDto,
  ProviderSettingsDto,
  RequestStatusDto,
  RequeueResultDto,
  StageMappingDto,
  StageMappingsDto,
} from "../../modules/integration-settings/api/dto";
import type {
  CatalogImportBody,
  CatalogImportResultDto,
  CatalogProductDto,
  MergePersonResultDto,
  OrganizationDto,
  NonSalesReassignResultDto,
  PoolApplyResultDto,
  TerritoriesDto,
  TerritoryBody,
  TerritoryRuleDto,
} from "../../modules/sales-pipeline/api/dto";
import type {
  ActionLogPageDto,
  ActionResultDto,
  ActionTypeDto,
  TargetTypeDto,
} from "../../modules/sales-pipeline/api/dto.actionLog";
import type { MailActivityStatusDto, MailWeekReportDto } from "../../modules/mail-activity/api/dto";
import { PipelineError, call } from "../api";

/** Yönetim paneli istemcisi (Faz 7): `/api/admin` + satış modülündeki bölge / birleştirme / arşiv uçları. */
const enc = encodeURIComponent;

const admin = <T>(method: string, path: string, body?: unknown) => request<T>(method, "/api/admin" + path, body);
/** Mail gönderim raporu (yalnız seesMailStats; src/modules/mail-activity/api). */
const mail = <T>(method: string, path: string) => request<T>(method, "/api/mail-activity" + path);

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  try {
    return await api<T>(method, path, body);
  } catch (e) {
    if (e instanceof ApiError) {
      throw new PipelineError(
        e.status,
        e.status === 0 ? "network" : (e.code ?? "internal"),
        e.message,
        e.details ?? {},
      );
    }
    throw e;
  }
}

export const adminApi = {
  health: () => admin<HealthDto>("GET", "/health"),
  outbox: (statuses: readonly string[]) => admin<OutboxItemDto[]>("GET", `/outbox?status=${enc(statuses.join(","))}`),
  requeueOutbox: (ids: string[]) => admin<RequeueResultDto>("POST", "/outbox/requeue", { ids }),
  outboxStatus: (id: string) => admin<RequestStatusDto>("GET", `/outbox/${enc(id)}/status`),
  inboxFailed: () => admin<InboxFailedDto[]>("GET", "/inbox/failed"),
  requeueInbox: (ids: string[]) => admin<RequeueResultDto>("POST", "/inbox/requeue", { ids }),
  setOutbound: (provider: string, enabled: boolean) =>
    admin<{ provider: string; enabled: boolean }>("POST", `/providers/${enc(provider)}/outbound`, { enabled }),

  stageMappings: (provider: string) => admin<StageMappingsDto>("GET", `/stage-mappings/${enc(provider)}`),
  saveStageMappings: (provider: string, rows: StageMappingDto[]) =>
    admin<StageMappingsDto>("PUT", `/stage-mappings/${enc(provider)}`, { rows }),
  fieldMappings: (provider: string) => admin<FieldMappingsDto>("GET", `/field-mappings/${enc(provider)}`),
  saveFieldMapping: (provider: string, body: FieldMappingBody) =>
    admin<FieldMappingsDto>("PUT", `/field-mappings/${enc(provider)}`, body),
  removeFieldMapping: (provider: string, id: string) =>
    admin<FieldMappingsDto>("DELETE", `/field-mappings/${enc(provider)}/${enc(id)}`),

  settings: (provider: string) => admin<ProviderSettingsDto>("GET", `/settings/${enc(provider)}`),
  saveSettings: (provider: string, values: Record<string, string>) =>
    admin<ProviderSettingsDto>("PUT", `/settings/${enc(provider)}`, { values }),
  eurRates: () => admin<EurRatesDto>("GET", "/eur-rates"),
  saveEurRates: (rates: Record<string, number>) => admin<EurRatesDto>("PUT", "/eur-rates", { rates }),
  setEurRatesAuto: (auto: boolean) => admin<EurRatesDto>("PUT", "/eur-rates", { auto }),
  refreshEurRates: () => admin<EurRatesDto>("POST", "/eur-rates/refresh"),

  territories: () => call<TerritoriesDto>("GET", "/territories"),
  saveTerritory: (countryCode: string, body: TerritoryBody) =>
    call<TerritoryRuleDto>("PUT", `/territories/${enc(countryCode)}`, body),
  removeTerritory: (countryCode: string) => call<void>("DELETE", `/territories/${enc(countryCode)}`),
  applyToPool: (dryRun: boolean) => call<PoolApplyResultDto>("POST", "/territories/apply-to-pool", { dryRun }),
  reassignNonSales: (dryRun: boolean) =>
    call<NonSalesReassignResultDto>("POST", "/territories/reassign-non-sales", { dryRun }),

  products: () => call<CatalogProductDto[]>("GET", "/products"),
  importProducts: (body: CatalogImportBody) => call<CatalogImportResultDto>("POST", "/products/import", body),

  /** İşlem günlüğü (Loglar sekmesi): en yeni önce; `before` önceki sayfanın `next` değeri. */
  actionLogs: (p: {
    actor?: string | undefined;
    actions?: readonly ActionTypeDto[] | undefined;
    target?: TargetTypeDto | undefined;
    targetId?: string | undefined;
    q?: string | undefined;
    result?: ActionResultDto | undefined;
    from?: string | undefined;
    to?: string | undefined;
    before?: string | undefined;
    limit?: number | undefined;
  }) => {
    const q = new URLSearchParams();
    if (p.actor) q.set("actor", p.actor);
    if (p.actions?.length) q.set("action", p.actions.join(","));
    if (p.target) q.set("target", p.target);
    if (p.targetId) q.set("targetId", p.targetId);
    if (p.q) q.set("q", p.q);
    if (p.result) q.set("result", p.result);
    if (p.from) q.set("from", p.from);
    if (p.to) q.set("to", p.to);
    if (p.before) q.set("before", p.before);
    if (p.limit) q.set("limit", String(p.limit));
    const qs = q.toString();
    return call<ActionLogPageDto>("GET", `/action-logs${qs ? "?" + qs : ""}`);
  },

  mergePerson: (targetId: string, sourceId: string) =>
    call<MergePersonResultDto>("POST", `/persons/${enc(targetId)}/merge`, { sourceId }),
  archiveOrganization: (id: string, archived: boolean) =>
    call<OrganizationDto>("POST", `/organizations/${enc(id)}/${archived ? "archive" : "unarchive"}`),

  mailWeekly: (week?: string) => mail<MailWeekReportDto>("GET", `/weekly${week ? "?week=" + enc(week) : ""}`),
  mailStatus: () => mail<MailActivityStatusDto>("GET", "/status"),
  mailRun: () => mail<MailActivityStatusDto>("POST", "/run"),

  // Geri yükleme noktaları (yalnız admin; src/bootstrap/checkpoints.ts).
  checkpoints: () => admin<{ items: CheckpointDto[] }>("GET", "/checkpoints"),
  checkpointPreview: (id: string) => admin<CheckpointPreviewDto>("GET", `/checkpoints/${enc(id)}`),
  restoreCheckpoint: (id: string) => admin<CheckpointRestoreDto>("POST", `/checkpoints/${enc(id)}/restore`),
};

/** Sunucudaki `CheckpointListItem` (src/bootstrap/checkpoints.ts) ile aynı biçim. */
export interface CheckpointDto {
  id: string;
  createdAt: string;
  createdBy: string;
  label: string;
  source: string;
  summary: { leads: { created: number; changed: number }; tables: Record<string, Record<string, number>> };
  restoredAt: string | null;
  restoredBy: string | null;
}
export interface CheckpointPreviewDto {
  id: string;
  restoredAt: string | null;
  leads: { toDelete: number; toRevert: number };
  changedSince: number;
  addedSince: number;
}
export interface CheckpointRestoreDto {
  deleted: number;
  reinserted: number;
  reverted: number;
  keptPersons: number;
}
