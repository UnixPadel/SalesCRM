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
  MergePersonResultDto,
  OrganizationDto,
  PoolApplyResultDto,
  TerritoriesDto,
  TerritoryBody,
  TerritoryRuleDto,
} from "../../modules/sales-pipeline/api/dto";
import { PipelineError, call } from "../api";

/** Yönetim paneli istemcisi (Faz 7): `/api/admin` + satış modülündeki bölge / birleştirme / arşiv uçları. */
const enc = encodeURIComponent;

async function admin<T>(method: string, path: string, body?: unknown): Promise<T> {
  try {
    return await api<T>(method, "/api/admin" + path, body);
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

  territories: () => call<TerritoriesDto>("GET", "/territories"),
  saveTerritory: (countryCode: string, body: TerritoryBody) =>
    call<TerritoryRuleDto>("PUT", `/territories/${enc(countryCode)}`, body),
  removeTerritory: (countryCode: string) => call<void>("DELETE", `/territories/${enc(countryCode)}`),
  applyToPool: (dryRun: boolean) => call<PoolApplyResultDto>("POST", "/territories/apply-to-pool", { dryRun }),

  mergePerson: (targetId: string, sourceId: string) =>
    call<MergePersonResultDto>("POST", `/persons/${enc(targetId)}/merge`, { sourceId }),
  archiveOrganization: (id: string, archived: boolean) =>
    call<OrganizationDto>("POST", `/organizations/${enc(id)}/${archived ? "archive" : "unarchive"}`),
};
