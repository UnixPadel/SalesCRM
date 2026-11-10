import type { LeadDto, LeadListDto, TrackingReportDto } from "../../modules/sales-pipeline/api/dto";
import type {
  ContactFormDto,
  ContactHistoryDto,
  LogContactBody,
  LogContactResultDto,
  UndoLogContactResultDto,
} from "../../modules/sales-pipeline/api/dto.contact";
import { call } from "../api";

/** Faz 7g istemcisi: temas kaydı, durum, uyarı kontrolü, Temas geçmişi, Özet rapor, ortak süzgeçli liste. */
const enc = encodeURIComponent;

export const contactApi = {
  form: (leadId: string) => call<ContactFormDto>("GET", `/leads/${enc(leadId)}/contact-form`),
  log: (leadId: string, body: LogContactBody) =>
    call<LogContactResultDto>("POST", `/leads/${enc(leadId)}/contacts`, body),
  undo: (logId: string) => call<UndoLogContactResultDto>("POST", `/contact-logs/${enc(logId)}/undo`),
  setStatus: (leadId: string, status: string | null) =>
    call<LeadDto>("PUT", `/leads/${enc(leadId)}/customer-status`, { status }),
  checkWarning: (leadId: string, code: string, checked: boolean) =>
    call<LeadDto>(checked ? "POST" : "DELETE", `/leads/${enc(leadId)}/warnings/${enc(code)}/check`),
  history: (params: URLSearchParams) =>
    call<ContactHistoryDto>("GET", `/activities/history${params.toString() ? "?" + params.toString() : ""}`),
  tracking: (params: URLSearchParams) =>
    call<TrackingReportDto>("GET", `/reports/tracking${params.toString() ? "?" + params.toString() : ""}`),
  /** Ortak süzgeç (`owner`, `country`, `source`, `stage`, `contact`, `hot`, `warning`, `scope`, `campaign`, `q`). */
  leads: (params: URLSearchParams) =>
    call<LeadListDto[]>("GET", `/leads${params.toString() ? "?" + params.toString() : ""}`),
};
