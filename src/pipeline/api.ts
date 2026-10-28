import { api, ApiError } from "../data/api";
import type {
  ApiErrorDto,
  AssignBody,
  ChangeStageBody,
  CreateLeadBody,
  LeadDetailDto,
  LeadDto,
  ReferenceDto,
  StageCodeDto,
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
    return call<LeadDto[]>("GET", "/leads" + (s ? "?" + s : ""));
  },
  get: (id: string) => call<LeadDetailDto>("GET", `/leads/${encodeURIComponent(id)}`),
  create: (body: CreateLeadBody) =>
    call<{ lead: LeadDto; created: boolean; personMatched: boolean }>("POST", "/leads", body),
  changeStage: (id: string, body: ChangeStageBody) =>
    call<{ lead: LeadDto; changeId: string }>("POST", `/leads/${encodeURIComponent(id)}/stage`, body),
  undo: (id: string) =>
    call<{ lead: LeadDto; revertedTo: StageCodeDto }>("POST", `/leads/${encodeURIComponent(id)}/undo`),
  assign: (id: string, body: AssignBody) => call<LeadDto>("POST", `/leads/${encodeURIComponent(id)}/assign`, body),
};

export type { ApiErrorDto };
