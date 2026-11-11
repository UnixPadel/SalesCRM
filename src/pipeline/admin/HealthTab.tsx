import { useCallback, useState } from "react";
import { Button, Empty, Skeleton, StatusTag, fmtDate, type Tone } from "../../components/ui";
import { useLang } from "../../i18n";
import type {
  CountDto,
  InboxFailedDto,
  OutboxItemDto,
  ProviderHealthDto,
  RequestStatusDto,
} from "../../modules/integration-settings/api/dto";
import { useCrm } from "../../state/CrmContext";
import { useErrorText, useNow, useReference, useSince } from "../hooks";
import { adminApi } from "./adminApi";
import { ConfirmDialog, LoadError, SecretList, SectionHead, useLoad, useProviderName } from "./bits";

/**
 * Sağlık sekmesi (Faz 7a, 7c): bağlantılar ve acil durdurma, gelen kutusu ve giden kuyruk sayıları, gönderilemeyen
 * olaylar / işlenemeyen bildirimler (yeniden dene), son gönderilenler ve platformdaki akıbet. 60 sn'de bir yenilenir.
 */
const INBOX_ORDER = ["pending", "processing", "failed", "done"] as const;
const OUTBOX_ORDER = ["pending", "failed", "dead", "skipped", "sent"] as const;
const STATUS_TONE: Record<string, Tone> = {
  pending: "info",
  processing: "info",
  failed: "warn",
  dead: "bad",
  skipped: "neutral",
  sent: "ok",
  done: "ok",
};
const STATE_TONE: Record<string, Tone> = {
  processing: "info",
  success: "ok",
  partial: "warn",
  failure: "bad",
  unknown: "neutral",
};

const sumBy = (counts: readonly CountDto[], status: string) =>
  counts.filter((c) => c.status === status).reduce((s, c) => s + c.count, 0);

export function HealthTab() {
  const { t } = useLang();
  const { toast } = useCrm();
  const errText = useErrorText();
  const since = useSince();
  const now = useNow(30_000);
  const providerName = useProviderName();
  const { stageName } = useReference();

  const load = useCallback(
    () =>
      Promise.all([
        adminApi.health(),
        adminApi.outbox(["dead", "failed"]),
        adminApi.inboxFailed(),
        adminApi.outbox(["sent"]),
      ]).then(([health, failedOut, failedIn, sent]) => ({ health, failedOut, failedIn, sent: sent.slice(0, 20) })),
    [],
  );
  const { data, error, at, reload } = useLoad(load, 60_000);
  const [busy, setBusy] = useState<string | null>(null);
  const [stopping, setStopping] = useState<ProviderHealthDto | null>(null);
  const [statuses, setStatuses] = useState<Record<string, RequestStatusDto | "loading">>({});

  const run = async (key: string, fn: () => Promise<string>) => {
    setBusy(key);
    try {
      toast(await fn());
      await reload();
    } catch (e) {
      toast(errText(e), { bad: true });
    } finally {
      setBusy(null);
    }
  };

  const setOutbound = (p: ProviderHealthDto, enabled: boolean) =>
    run(`outbound:${p.provider}`, async () => {
      await adminApi.setOutbound(p.provider, enabled);
      setStopping(null);
      return t(enabled ? "health.resumed.toast" : "health.stopped.toast", { provider: providerName(p.provider) });
    });

  const requeueOut = (ids: string[], key: string) =>
    run(key, async () => t("health.requeued", { n: (await adminApi.requeueOutbox(ids)).requeued }));
  const requeueIn = (ids: string[], key: string) =>
    run(key, async () => t("health.requeued", { n: (await adminApi.requeueInbox(ids)).requeued }));

  const askStatus = async (row: OutboxItemDto) => {
    setStatuses((s) => ({ ...s, [row.id]: "loading" }));
    try {
      const status = await adminApi.outboxStatus(row.id);
      setStatuses((s) => ({ ...s, [row.id]: status }));
    } catch (e) {
      setStatuses((s) => {
        const { [row.id]: _drop, ...rest } = s;
        return rest;
      });
      toast(errText(e), { bad: true });
    }
  };

  if (!data) {
    return error ? (
      <LoadError message={errText(error)} onRetry={() => void reload()} />
    ) : (
      <div className="adm-stack" aria-busy="true">
        <Skeleton h={120} />
        <Skeleton h={96} />
        <Skeleton h={160} />
      </div>
    );
  }

  const { health, failedOut, failedIn, sent } = data;
  const statusProviders = new Set(health.providers.filter((p) => p.outbound?.statusQuery).map((p) => p.provider));
  const requeueableIn = failedIn.filter((r) => r.hasPayload);
  const mappingMissing = health.outbox.skipReasons.some((r) => r.reason === "mapping_missing");

  return (
    <div className="adm-stack">
      <SectionHead title={t("health.providers")}>
        <span className="muted">{at ? t("admin.updated", { ago: since(new Date(at).toISOString(), now) }) : ""}</span>
        <Button size="sm" icon="refresh" onClick={() => void reload()}>
          {t("admin.refresh")}
        </Button>
      </SectionHead>
      {error ? <LoadError message={errText(error)} onRetry={() => void reload()} /> : null}

      <div className="adm-table-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th scope="col">{t("admin.provider")}</th>
              <th scope="col">{t("health.inbound")}</th>
              <th scope="col">{t("health.outbound")}</th>
              <th scope="col">{t("health.secrets")}</th>
            </tr>
          </thead>
          <tbody>
            {health.providers.map((p) => (
              <tr key={p.provider}>
                <th scope="row" className="adm-rowhead">
                  {providerName(p.provider)}
                </th>
                <td>
                  {p.inbound === null ? (
                    <span className="muted">{t("admin.none")}</span>
                  ) : (
                    <StatusTag
                      tone={p.inbound.configured ? "ok" : "neutral"}
                      icon={p.inbound.configured ? "check" : "ban"}
                    >
                      {t(p.inbound.configured ? "health.configured" : "health.notConfigured")}
                    </StatusTag>
                  )}
                </td>
                <td>
                  {p.outbound === null ? (
                    <span className="muted">{t("admin.none")}</span>
                  ) : !p.outbound.configured ? (
                    <StatusTag tone="neutral" icon="ban">
                      {t("health.notConfigured")}
                    </StatusTag>
                  ) : (
                    <div className="adm-inline">
                      {!p.outbound.listed ? (
                        <StatusTag tone="neutral" icon="ban">
                          {t("health.notListed")}
                        </StatusTag>
                      ) : p.outbound.enabled ? (
                        <StatusTag tone="ok" icon="check">
                          {t("health.sending")}
                        </StatusTag>
                      ) : (
                        <StatusTag tone="bad" icon="ban">
                          {t("health.stopped")}
                        </StatusTag>
                      )}
                      {p.outbound.enabled ? (
                        <Button size="sm" variant="ghost" onClick={() => setStopping(p)}>
                          {t("health.stop")}
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          loading={busy === `outbound:${p.provider}`}
                          onClick={() => void setOutbound(p, true)}
                        >
                          {t("health.resume")}
                        </Button>
                      )}
                    </div>
                  )}
                </td>
                <td>
                  <SecretList secrets={p.secrets} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="adm-two">
        <section className="panel" aria-labelledby="adm-inbox-h">
          <h2 id="adm-inbox-h" className="sec-h">
            {t("health.inbox")}
          </h2>
          <StatusCounts order={INBOX_ORDER} counts={health.inbox.counts} />
          <ul className="adm-facts">
            <li>{t("health.receivedDay", { n: health.inbox.receivedLastDay })}</li>
            <li>
              {health.inbox.oldestPendingAt
                ? t("health.oldestPending", { ago: since(health.inbox.oldestPendingAt, now) })
                : t("health.noPending")}
            </li>
            <li>
              {health.inbox.lastPurgedAt
                ? t("health.purge", {
                    ago: since(health.inbox.lastPurgedAt, now),
                    days: health.inbox.retentionDays,
                    n: health.inbox.purgeBacklog,
                  })
                : t("health.purgeNever", { days: health.inbox.retentionDays, n: health.inbox.purgeBacklog })}
            </li>
          </ul>
        </section>
        <section className="panel" aria-labelledby="adm-outbox-h">
          <h2 id="adm-outbox-h" className="sec-h">
            {t("health.outbox")}
          </h2>
          <StatusCounts order={OUTBOX_ORDER} counts={health.outbox.counts} />
          <ul className="adm-facts">
            <li>
              {health.outbox.lastSentAt
                ? t("health.lastSent", { ago: since(health.outbox.lastSentAt, now) })
                : t("health.neverSent")}
            </li>
            <li>
              {health.outbox.oldestDueAt
                ? t("health.oldestPending", { ago: since(health.outbox.oldestDueAt, now) })
                : t("health.noPending")}
            </li>
          </ul>
          {health.outbox.skipReasons.length > 0 && (
            <>
              <h3 className="adm-sub">{t("health.skipReasons")}</h3>
              <ul className="adm-facts">
                {health.outbox.skipReasons.map((r) => (
                  <li key={`${r.provider}:${r.reason}`}>
                    {providerName(r.provider)} · {skipText(t, r.reason)}: <b>{r.count}</b>
                  </li>
                ))}
              </ul>
              {mappingMissing && <p className="muted">{t("health.mappingHint")}</p>}
            </>
          )}
        </section>
      </div>

      <SectionHead title={t("health.failedOutbox")}>
        {failedOut.length > 1 && (
          <Button
            size="sm"
            icon="refresh"
            loading={busy === "out:all"}
            onClick={() =>
              void requeueOut(
                failedOut.map((r) => r.id),
                "out:all",
              )
            }
          >
            {t("health.requeueAll", { n: failedOut.length })}
          </Button>
        )}
      </SectionHead>
      {failedOut.length === 0 ? (
        <Empty title={t("health.failedOutbox.empty")} tone="ok" />
      ) : (
        <div className="adm-table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th scope="col">{t("health.col.when")}</th>
                <th scope="col">{t("admin.provider")}</th>
                <th scope="col">{t("health.col.stage")}</th>
                <th scope="col">{t("health.col.status")}</th>
                <th scope="col" className="num">
                  {t("health.col.attempts")}
                </th>
                <th scope="col">{t("health.col.error")}</th>
                <th scope="col">
                  <span className="sr-only">{t("people.col.actions")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {failedOut.map((r) => (
                <tr key={r.id}>
                  <td>{fmtDate(r.finishedAt ?? r.createdAt, true)}</td>
                  <td>{providerName(r.provider)}</td>
                  <td>{r.stageCode ? stageName(r.stageCode) : t("admin.none")}</td>
                  <td>
                    <StatusTag tone={STATUS_TONE[r.status] ?? "neutral"} icon={r.status === "dead" ? "ban" : "warn"}>
                      {t(`health.status.${r.status}`)}
                    </StatusTag>
                  </td>
                  <td className="num">{r.attempts}</td>
                  <td className="adm-err">
                    {r.lastResponseCode ? <code>{r.lastResponseCode}</code> : null} {r.lastError ?? ""}
                  </td>
                  <td>
                    <div className="row-actions">
                      {r.leadId && (
                        <a className="btn btn-ghost btn-sm" href={`#/lead/${encodeURIComponent(r.leadId)}`}>
                          {t("health.openLead")}
                        </a>
                      )}
                      <Button
                        size="sm"
                        loading={busy === `out:${r.id}`}
                        onClick={() => void requeueOut([r.id], `out:${r.id}`)}
                      >
                        {t("health.requeue")}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <SectionHead title={t("health.failedInbox")}>
        {requeueableIn.length > 1 && (
          <Button
            size="sm"
            icon="refresh"
            loading={busy === "in:all"}
            onClick={() =>
              void requeueIn(
                requeueableIn.map((r) => r.id),
                "in:all",
              )
            }
          >
            {t("health.requeueAll", { n: requeueableIn.length })}
          </Button>
        )}
      </SectionHead>
      {failedIn.length === 0 ? (
        <Empty title={t("health.failedInbox.empty")} tone="ok" />
      ) : (
        <div className="adm-table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th scope="col">{t("health.col.when")}</th>
                <th scope="col">{t("admin.provider")}</th>
                <th scope="col">{t("health.col.kind")}</th>
                <th scope="col" className="num">
                  {t("health.col.attempts")}
                </th>
                <th scope="col">{t("health.col.error")}</th>
                <th scope="col">
                  <span className="sr-only">{t("people.col.actions")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {failedIn.map((r: InboxFailedDto) => (
                <tr key={r.id}>
                  <td>{fmtDate(r.receivedAt, true)}</td>
                  <td>{providerName(r.provider)}</td>
                  <td>{t(`health.kind.${r.kind}`)}</td>
                  <td className="num">{r.attempts}</td>
                  <td className="adm-err">
                    {r.lastErrorCode ? <code>{r.lastErrorCode}</code> : null} {r.lastError ?? ""}
                  </td>
                  <td>
                    <div className="row-actions">
                      {r.hasPayload ? (
                        <Button
                          size="sm"
                          loading={busy === `in:${r.id}`}
                          onClick={() => void requeueIn([r.id], `in:${r.id}`)}
                        >
                          {t("health.requeue")}
                        </Button>
                      ) : (
                        <span className="muted">{t("health.noPayload")}</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <SectionHead title={t("health.sentRecent")} />
      {sent.length === 0 ? (
        <Empty title={t("health.sentRecent.empty")} />
      ) : (
        <div className="adm-table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th scope="col">{t("health.col.when")}</th>
                <th scope="col">{t("admin.provider")}</th>
                <th scope="col">{t("health.col.stage")}</th>
                <th scope="col">{t("health.col.lead")}</th>
                <th scope="col">{t("health.col.status")}</th>
              </tr>
            </thead>
            <tbody>
              {sent.map((r) => {
                const st = statuses[r.id];
                const canAsk = statusProviders.has(r.provider) && r.hasRequestId;
                return (
                  <tr key={r.id}>
                    <td>{fmtDate(r.sentAt ?? r.createdAt, true)}</td>
                    <td>{providerName(r.provider)}</td>
                    <td>{r.stageCode ? stageName(r.stageCode) : t("admin.none")}</td>
                    <td>
                      {r.leadId ? (
                        <a className="link-btn" href={`#/lead/${encodeURIComponent(r.leadId)}`}>
                          {t("health.openLead")}
                        </a>
                      ) : (
                        t("admin.none")
                      )}
                    </td>
                    <td>
                      {st && st !== "loading" ? (
                        <div className="adm-inline">
                          <StatusTag
                            tone={STATE_TONE[st.state] ?? "neutral"}
                            icon={st.state === "success" ? "check" : st.state === "processing" ? "clock" : "warn"}
                          >
                            {t(`health.state.${st.state}`)}
                          </StatusTag>
                          {st.destinations[0] && (
                            <span className="muted">
                              {t("health.stateDetail", {
                                records: st.destinations.reduce((s, d) => s + d.recordCount, 0),
                                errors: st.destinations.reduce((s, d) => s + d.errorCount, 0),
                                warnings: st.destinations.reduce((s, d) => s + d.warningCount, 0),
                              })}
                            </span>
                          )}
                        </div>
                      ) : canAsk ? (
                        <Button size="sm" variant="ghost" loading={st === "loading"} onClick={() => void askStatus(r)}>
                          {t("health.checkStatus")}
                        </Button>
                      ) : (
                        <StatusTag tone="ok" icon="check">
                          {t("health.status.sent")}
                        </StatusTag>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {stopping && (
        <ConfirmDialog
          title={t("health.stop")}
          confirmLabel={t("health.stop")}
          danger
          busy={busy === `outbound:${stopping.provider}`}
          onConfirm={() => void setOutbound(stopping, false)}
          onClose={() => setStopping(null)}
        >
          {t("health.stopConfirm", { provider: providerName(stopping.provider) })}
        </ConfirmDialog>
      )}
    </div>
  );
}

function skipText(t: (k: string) => string, reason: string): string {
  const key = `health.skip.${reason}`;
  const text = t(key);
  return text === key ? reason : text;
}

/** Durum sayıları: her durum etiketi + sayı (renk tek başına anlam taşımaz; ad yazılıdır). */
function StatusCounts({ order, counts }: { order: readonly string[]; counts: readonly CountDto[] }) {
  const { t } = useLang();
  return (
    <dl className="adm-counts">
      {order.map((status) => (
        <div key={status} className={"adm-count tone-" + (STATUS_TONE[status] ?? "neutral")}>
          <dt>{t(`health.status.${status}`)}</dt>
          <dd>{sumBy(counts, status)}</dd>
        </div>
      ))}
    </dl>
  );
}
