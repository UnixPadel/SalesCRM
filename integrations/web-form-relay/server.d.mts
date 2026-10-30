import type { Server } from "node:http";
import type { FileQueue, ProcessStats } from "./lib.mjs";

export interface RelayOptions {
  crmUrl: string;
  secret: string;
  queueDir: string;
  formId?: string | undefined;
  consentTextVersion?: string | undefined;
  honeypotField?: string | undefined;
  cookieMap?: Record<string, string> | undefined;
  thanksUrl?: string | undefined;
  allowedOrigin?: string | undefined;
  log?: ((level: "info" | "warn" | "error", msg: string, data?: Record<string, unknown>) => void) | undefined;
  fetchImpl?: typeof fetch | undefined;
  now?: (() => number) | undefined;
}

export interface Relay {
  server: Server;
  queue: FileQueue;
  flush(): Promise<ProcessStats>;
}

export function createRelay(opts: RelayOptions): Relay;
