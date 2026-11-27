import { Router, type Request, type Response } from "express";
import type { MailActivityQueries, MailboxScanStatus, MailWeekReport } from "../application";
import type { MailActivityStatusDto, MailScanStatusDto, MailWeekReportDto } from "./dto";

/**
 * Mail gönderim raporu uçları (Yönetim > Mail Gönderimleri). Görme izni kişi bazındadır (`seesMailStats`,
 * server/roles.mjs CRM_MAIL_STATS_VIEWERS; yönetici rolü tek başına yetmez); izinsiz oturum 403 alır.
 *   GET  /weekly?week=2026-W48   hafta raporu (varsayılan geçen hafta)
 *   GET  /status                 tarama durumu
 *   POST /run                    elle tarama; bitince durumu döner
 */
export interface MailScanRunner {
  enabled: boolean;
  minutes: number;
  running(): boolean;
  lastRunAt(): Date | null;
  runNow(): Promise<void>;
}

export interface MailActivityRouteDeps {
  queries: MailActivityQueries;
  scan: MailScanRunner;
  canView(req: Request): boolean;
}

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

const scanDto = (s: MailboxScanStatus): MailScanStatusDto => ({
  mailbox: s.mailbox,
  configured: s.configured,
  folder: s.folder,
  lastOkAt: iso(s.lastOkAt),
  lastError: s.lastError,
  lastErrorAt: iso(s.lastErrorAt),
});

export const weekReportDto = (r: MailWeekReport): MailWeekReportDto => ({
  week: r.week.key,
  start: r.week.start.toISOString(),
  end: r.week.end.toISOString(),
  prev: r.prev,
  next: r.next,
  mailboxes: r.mailboxes.map((m) => ({
    mailbox: m.mailbox,
    sent: m.sent,
    lastSentInWeek: iso(m.lastSentInWeek),
    lastSentEver: iso(m.lastSentEver),
    uniqueRecipients: m.uniqueRecipients,
    recipients: m.recipients.map((x) => ({
      address: x.address,
      messages: x.messages,
      lastSentAt: x.lastSentAt.toISOString(),
      internal: x.internal,
      leadId: x.lead?.leadId ?? null,
      leadName: x.lead?.name ?? null,
    })),
    scan: scanDto(m.scan),
  })),
});

export function createMailActivityRouter(deps: MailActivityRouteDeps): Router {
  const r = Router();
  const gate = (req: Request, res: Response): boolean => {
    if (deps.canView(req)) return true;
    res.status(403).json({ error: "Mail gönderim raporunu görme izniniz yok.", code: "mail_stats.forbidden" });
    return false;
  };
  const status = async (): Promise<MailActivityStatusDto> => ({
    enabled: deps.scan.enabled,
    running: deps.scan.running(),
    minutes: deps.scan.minutes,
    lastRunAt: iso(deps.scan.lastRunAt()),
    mailboxes: (await deps.queries.status()).map(scanDto),
  });

  r.get("/weekly", async (req, res) => {
    if (!gate(req, res)) return;
    const week = typeof req.query["week"] === "string" ? req.query["week"] : undefined;
    const result = await deps.queries.weekly(week);
    if (!result.ok) return res.status(400).json({ error: result.error.message, code: result.error.code });
    res.setHeader("cache-control", "no-store");
    return res.json(weekReportDto(result.value));
  });

  r.get("/status", async (req, res) => {
    if (!gate(req, res)) return;
    res.setHeader("cache-control", "no-store");
    return res.json(await status());
  });

  r.post("/run", async (req, res) => {
    if (!gate(req, res)) return;
    if (!deps.scan.enabled)
      return res.status(409).json({ error: "Mail taraması kapalı.", code: "mail_stats.disabled" });
    await deps.scan.runNow();
    return res.json(await status());
  });

  return r;
}
