import { api, ApiError } from "../data/api";
import type {
  ActivityDto,
  AddActivityBody,
  ApiErrorDto,
  AssignBody,
  BoardDto,
  ChangeStageBody,
  CreateLeadBody,
  LeadDetailDto,
  LeadDto,
  LeadListDto,
  NotificationsDto,
  OrganizationBody,
  OrganizationDto,
  OrganizationSummaryDto,
  PersonSummaryDto,
  ReferenceDto,
  ReportDto,
  SearchDto,
  StageCodeDto,
  TodayDto,
  UpdateContactBody,
  UpdateLeadBody,
} from "../modules/sales-pipeline/api/dto";

const BASE = "/api/pipeline";

/** API hata kodu (ör. "stage.backward"); çeviri anahtarı "err.<code>". */
export class PipelineError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  try {
    return await api<T>(method, BASE + path, body);
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

export const pipelineApi = {
  reference: () => call<ReferenceDto>("GET", "/reference"),
  list: (p: { stage?: StageCodeDto; q?: string; includeTest?: boolean } = {}) => {
    const qs = new URLSearchParams();
    if (p.stage) qs.set("stage", p.stage);
    if (p.q) qs.set("q", p.q);
    if (p.includeTest) qs.set("includeTest", "1");
    const s = qs.toString();
    return call<LeadListDto[]>("GET", "/leads" + (s ? "?" + s : ""));
  },
  /** Pano (Faz 6b): filtreler sunucuda, kolon istatistikleri aynı kümeden. */
  board: (p: { owner?: string; country?: string; source?: string; rotting?: boolean; includeTest?: boolean } = {}) => {
    const qs = new URLSearchParams();
    if (p.owner) qs.set("owner", p.owner);
    if (p.country) qs.set("country", p.country);
    if (p.source) qs.set("source", p.source);
    if (p.rotting) qs.set("rotting", "1");
    if (p.includeTest) qs.set("includeTest", "1");
    const s = qs.toString();
    return call<BoardDto>("GET", "/board" + (s ? "?" + s : ""));
  },
  get: (id: string) => call<LeadDetailDto>("GET", `/leads/${encodeURIComponent(id)}`),
  update: (id: string, body: UpdateLeadBody) => call<LeadDto>("PATCH", `/leads/${encodeURIComponent(id)}`, body),
  create: (body: CreateLeadBody) =>
    call<{ lead: LeadDto; created: boolean; personMatched: boolean }>("POST", "/leads", body),
  changeStage: (id: string, body: ChangeStageBody) =>
    call<{ lead: LeadDto; changeId: string; followUp: ActivityDto | null }>(
      "POST",
      `/leads/${encodeURIComponent(id)}/stage`,
      body,
    ),
  // Kuruluşlar ve kişiler (Faz 6d)
  organizations: (p: { q?: string | undefined } = {}) =>
    call<OrganizationSummaryDto[]>("GET", "/organizations" + (p.q ? "?q=" + encodeURIComponent(p.q) : "")),
  createOrganization: (body: OrganizationBody) => call<OrganizationDto>("POST", "/organizations", body),
  updateOrganization: (id: string, body: OrganizationBody) =>
    call<OrganizationDto>("PATCH", `/organizations/${encodeURIComponent(id)}`, body),
  persons: (p: { q?: string | undefined; organizationId?: string | undefined } = {}) => {
    const qs = new URLSearchParams();
    if (p.q) qs.set("q", p.q);
    if (p.organizationId) qs.set("organizationId", p.organizationId);
    const s = qs.toString();
    return call<PersonSummaryDto[]>("GET", "/persons" + (s ? "?" + s : ""));
  },
  updateContact: (id: string, body: UpdateContactBody) =>
    call<LeadDto>("PATCH", `/leads/${encodeURIComponent(id)}/contact`, body),
  search: (q: string) => call<SearchDto>("GET", "/search?q=" + encodeURIComponent(q)),
  // Raporlar (Faz 6c)
  reports: (months: number) => call<ReportDto>("GET", `/reports?months=${months}`),
  // Aktiviteler (Faz 6a)
  today: () => call<TodayDto>("GET", "/activities/today"),
  addActivity: (leadId: string, body: AddActivityBody) =>
    call<ActivityDto>("POST", `/leads/${encodeURIComponent(leadId)}/activities`, body),
  setActivityDone: (id: string, done: boolean) =>
    call<ActivityDto>("POST", `/activities/${encodeURIComponent(id)}/done`, { done }),
  deleteActivity: (id: string) => call<void>("DELETE", `/activities/${encodeURIComponent(id)}`),
  undo: (id: string) =>
    call<{ lead: LeadDto; revertedTo: StageCodeDto }>("POST", `/leads/${encodeURIComponent(id)}/undo`),
  assign: (id: string, body: AssignBody) => call<LeadDto>("POST", `/leads/${encodeURIComponent(id)}/assign`, body),
  notifications: () => call<NotificationsDto>("GET", "/notifications?limit=30"),
  markRead: (id: string) => call<{ ok: true }>("POST", `/notifications/${encodeURIComponent(id)}/read`),
  markAllRead: () => call<{ marked: number }>("POST", "/notifications/read-all"),
};

export type { ApiErrorDto };
