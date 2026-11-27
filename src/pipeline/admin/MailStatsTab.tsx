import { Fragment, useCallback, useState } from "react";
import { Button, Empty, Icon, IconButton, Skeleton, StatusTag, fmtDate } from "../../components/ui";
import { useLang } from "../../i18n";
import type {
  MailActivityStatusDto,
  MailboxWeekDto,
  MailScanStatusDto,
  MailWeekReportDto,
} from "../../modules/mail-activity/api/dto";
import { useCrm } from "../../state/CrmContext";
import { useErrorText } from "../hooks";
import { adminApi } from "./adminApi";
import { LoadError, SectionHead, useLoad } from "./bits";

/**
 * Yönetim > Mail Gönderimleri (2026-11-27): satis@, export3@, export2@, yusa@ hesaplarından seçilen haftada
 * (Pazartesi–Pazar, İstanbul) kaç mail gitti, son gönderim ne zaman, kime yazıldı. Kaynak hesapların Gönderilmiş
 * klasörü (saatlik salt-okunur tarama). Yalnız oturumu `seesMailStats` olan kişi görür; sunucu da 403 ile reddeder.
 */

const KNOWN_ERRORS = ["auth_failed", "unreachable", "no_sent_folder", "no_credentials"];

export function MailStatsTab() {
  const { t } = useLang();
  const errText = useErrorText();
  const { toast } = useCrm();
  // Hafta boş: sunucu geçen (tamamlanmış) haftayı verir.
  const [week, setWeek] = useState<string | undefined>(undefined);
  const [open, setOpen] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const loadReport = useCallback(() => adminApi.mailWeekly(week), [week]);
  const report = useLoad(loadReport);
  const loadStatus = useCallback(() => adminApi.mailStatus(), []);
  const status = useLoad(loadStatus);

  const errorLabel = (code: string) => (KNOWN_ERRORS.includes(code) ? t(`mail.err.${code}`) : code);

  const scan = async () => {
    setScanning(true);
    try {
      const s = await adminApi.mailRun();
      const failed = s.mailboxes.filter((m) => m.lastError).length;
      toast(failed ? t("mail.scanFailed", { n: failed }) : t("mail.scanned"), failed ? { bad: true } : undefined);
      void status.reload();
      void report.reload();
    } catch (e) {
      toast(errText(e), { bad: true });
    } finally {
      setScanning(false);
    }
  };

  return (
    <div className="adm-stack">
      <SectionHead title={t("mail.title")} help={t("mail.help")}>
        {status.data?.enabled && (
          <Button icon="refresh" onClick={() => void scan()} loading={scanning}>
            {t("mail.scanNow")}
          </Button>
        )}
      </SectionHead>
      {report.error && !report.data ? (
        <LoadError message={errText(report.error)} onRetry={() => void report.reload()} />
      ) : !report.data ? (
        <div aria-busy="true">
          <Skeleton h={48} />
          <Skeleton h={200} />
        </div>
      ) : (
        <>
          <WeekNav report={report.data} onGo={setWeek} />
          <MailboxTable
            report={report.data}
            open={open}
            onToggle={(m) => setOpen(open === m ? null : m)}
            errorLabel={errorLabel}
          />
        </>
      )}
      {status.data && <ScanFooter status={status.data} />}
      <p className="muted mail-note" role="note">
        {t("mail.limits")}
      </p>
    </div>
  );
}

function WeekNav({ report, onGo }: { report: MailWeekReportDto; onGo: (week: string) => void }) {
  const { t } = useLang();
  // Bitiş hariç (sonraki Pazartesi 00:00); ekranda Pazar günü görünür.
  const lastDay = new Date(new Date(report.end).getTime() - 1).toISOString();
  return (
    <div className="mail-week" role="group" aria-label={t("mail.week")}>
      <IconButton icon="arrowL" label={t("mail.prevWeek")} onClick={() => onGo(report.prev)} />
      <h3 className="mail-week-label">
        {t("mail.weekLabel", { week: report.week.replace(/^\d{4}-W0?/, ""), year: report.week.slice(0, 4) })}
        <span className="muted">
          {fmtDate(report.start)} – {fmtDate(lastDay)}
        </span>
      </h3>
      <IconButton
        icon="arrow"
        label={t("mail.nextWeek")}
        onClick={() => report.next && onGo(report.next)}
        disabled={!report.next}
      />
    </div>
  );
}

function ScanTag({ scan, errorLabel }: { scan: MailScanStatusDto; errorLabel: (code: string) => string }) {
  const { t } = useLang();
  if (!scan.configured)
    return (
      <StatusTag tone="neutral" icon="lock">
        {t("mail.scan.noPassword")}
      </StatusTag>
    );
  if (scan.lastError)
    return (
      <StatusTag tone="bad" icon="warn" title={scan.lastErrorAt ? fmtDate(scan.lastErrorAt, true) : undefined}>
        {errorLabel(scan.lastError)}
      </StatusTag>
    );
  if (scan.lastOkAt)
    return (
      <StatusTag tone="ok" icon="check">
        {t("mail.scan.ok", { at: fmtDate(scan.lastOkAt, true) })}
      </StatusTag>
    );
  return (
    <StatusTag tone="neutral" icon="clock">
      {t("mail.scan.pending")}
    </StatusTag>
  );
}

function MailboxTable({
  report,
  open,
  onToggle,
  errorLabel,
}: {
  report: MailWeekReportDto;
  open: string | null;
  onToggle: (mailbox: string) => void;
  errorLabel: (code: string) => string;
}) {
  const { t } = useLang();
  return (
    <div className="adm-table-wrap">
      <table className="tbl mail-tbl">
        <thead>
          <tr>
            <th scope="col">{t("mail.col.mailbox")}</th>
            <th scope="col" className="num">
              {t("mail.col.sent")}
            </th>
            <th scope="col">{t("mail.col.lastInWeek")}</th>
            <th scope="col">{t("mail.col.lastEver")}</th>
            <th scope="col" className="num">
              {t("mail.col.recipients")}
            </th>
            <th scope="col">{t("mail.col.scan")}</th>
          </tr>
        </thead>
        <tbody>
          {report.mailboxes.map((m) => (
            <Fragment key={m.mailbox}>
              <tr>
                <th scope="row" className="adm-rowhead">
                  <button
                    type="button"
                    className="mail-toggle"
                    aria-expanded={open === m.mailbox}
                    aria-controls={`mail-r-${m.mailbox}`}
                    onClick={() => onToggle(m.mailbox)}
                    disabled={!m.recipients.length}
                  >
                    <Icon name="chevron" size={14} className={open === m.mailbox ? "mail-chev open" : "mail-chev"} />
                    <bdi>{m.mailbox}</bdi>
                  </button>
                </th>
                <td className="num">{m.sent}</td>
                <td>{fmtDate(m.lastSentInWeek, true)}</td>
                <td>{fmtDate(m.lastSentEver, true)}</td>
                <td className="num">{m.uniqueRecipients}</td>
                <td>
                  <ScanTag scan={m.scan} errorLabel={errorLabel} />
                </td>
              </tr>
              {open === m.mailbox && (
                <tr id={`mail-r-${m.mailbox}`}>
                  <td colSpan={6} className="mail-sub">
                    <RecipientList mailbox={m} />
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RecipientList({ mailbox }: { mailbox: MailboxWeekDto }) {
  const { t } = useLang();
  if (!mailbox.recipients.length) return <Empty title={t("mail.noRecipients")} />;
  return (
    <table className="tbl mail-rcpt" aria-label={t("mail.recipientsOf", { mailbox: mailbox.mailbox })}>
      <thead>
        <tr>
          <th scope="col">{t("mail.col.address")}</th>
          <th scope="col" className="num">
            {t("mail.col.messages")}
          </th>
          <th scope="col">{t("mail.col.last")}</th>
          <th scope="col">{t("mail.col.crm")}</th>
        </tr>
      </thead>
      <tbody>
        {mailbox.recipients.map((r) => (
          <tr key={r.address}>
            <td>
              <bdi>{r.address}</bdi>
            </td>
            <td className="num">{r.messages}</td>
            <td>{fmtDate(r.lastSentAt, true)}</td>
            <td>
              {r.leadId ? (
                <a className="log-lead" href={`#/lead/${encodeURIComponent(r.leadId)}`}>
                  <bdi>{r.leadName || t("logs.unnamedLead")}</bdi>
                </a>
              ) : r.internal ? (
                <StatusTag tone="info" icon="user">
                  {t("mail.internal")}
                </StatusTag>
              ) : (
                <span className="muted">{t("mail.notInCrm")}</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ScanFooter({ status }: { status: MailActivityStatusDto }) {
  const { t } = useLang();
  if (!status.enabled)
    return (
      <p className="muted" role="status">
        {t("mail.disabled")}
      </p>
    );
  return (
    <p className="muted" role="status">
      {status.running
        ? t("mail.running")
        : t("mail.lastRun", { at: fmtDate(status.lastRunAt, true), n: status.minutes })}
    </p>
  );
}
