export const HEADERS: { signature: string; timestamp: string };
export const ATTRIBUTION_KEYS: string[];
export const CONSENT_PREFIX: string;
export const DEFAULT_COOKIE_MAP: Record<string, string>;

export interface SubmissionPayload {
  submission_id: string;
  form_id: string | null;
  submitted_at: string;
  page_url: string | null;
  fields: Record<string, string | string[]>;
  attribution: Record<string, string>;
  consents: { type: string; granted: boolean; text_version: string }[];
  honeypot: string;
  is_test: boolean;
}

export interface BuildContext {
  now: Date;
  id?: string | undefined;
  pageUrl?: string | undefined;
  cookies?: Record<string, string> | undefined;
  formId?: string | undefined;
  consentTextVersion?: string | undefined;
  honeypotField?: string | undefined;
  cookieMap?: Record<string, string> | undefined;
}

export function parseCookies(header: string | undefined): Record<string, string>;
export function buildSubmission(form: Record<string, unknown>, ctx: BuildContext): SubmissionPayload;
export function signBody(secret: string, timestampSeconds: number, body: string): string;

export interface QueueEntry {
  payload: SubmissionPayload;
  attempts: number;
  lastError?: string;
}

export class FileQueue {
  constructor(dir: string);
  readonly dir: string;
  readonly failedDir: string;
  put(payload: SubmissionPayload): string;
  list(): string[];
  read(name: string): QueueEntry;
  bump(name: string, entry: QueueEntry, error: string): void;
  remove(name: string): void;
  fail(name: string, error: string): void;
  size(): number;
}

export interface DeliverOptions {
  crmUrl: string;
  secret: string;
  fetchImpl?: typeof fetch | undefined;
  now?: (() => number) | undefined;
  timeoutMs?: number | undefined;
  log?: ((level: "info" | "warn" | "error", msg: string, data?: Record<string, unknown>) => void) | undefined;
}

export type DeliverResult = { ok: true; status: string } | { ok: false; retryable: boolean; error: string };
export function deliver(payload: SubmissionPayload, opts: DeliverOptions): Promise<DeliverResult>;

export interface ProcessStats {
  delivered: number;
  failed: number;
  pending: number;
}
export function processQueue(queue: FileQueue, opts: DeliverOptions): Promise<ProcessStats>;
