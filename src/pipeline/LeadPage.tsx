import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Empty, Icon, Skeleton, fmtDate, money } from "../components/ui";
import type { Currency } from "../domain/types";
import { useLang } from "../i18n";
import type { LeadDto, StageCodeDto, StageEventDto } from "../modules/sales-pipeline/api/dto";
import { navigate } from "../router";
import { useCrm } from "../state/CrmContext";
import { pipelineApi } from "./api";
import { Age, Country, SourceBadge, StageTag } from "./bits";
import { useErrorText, useLeadDetail, useNow, useReference, useTeamNames } from "./hooks";
import { useStageMove } from "./useStageMove";

/** Lead detayı: solda kişi ve proje, sağda zaman çizelgesi; üstte büyük "Sonraki aşama" (Genel plan). */
export function LeadPage({ id }: { id: string }) {
  const { t } = useLang();
  const { toast, user, isAdmin, isViewer } = useCrm();
  const { ref, stageName, reasonName } = useReference();
  const { detail, setDetail, error, loading, reload } = useLeadDetail(id);
  const { team, nameOf } = useTeamNames();
  const errText = useErrorText();
  const now = useNow(1000);

  const onChanged = useCallback(
    (lead: LeadDto) => {
      setDetail((d) => (d ? { ...d, lead } : d));
      reload();
    },
    [setDetail, reload],
  );
  const { move, dialog, saving } = useStageMove(ref, onChanged);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, []);

  if (error) {
    return (
      <Empty title={t("lead.notFound")}>
        <Button icon="arrowL" onClick={() => navigate("inbox")}>
          {t("common.back")}
        </Button>
      </Empty>
    );
  }
  if (!detail || !ref) {
    return (
      <div className="pl-page lead-page" aria-busy="true">
        <Skeleton h={40} w={320} />
        <Skeleton h={200} />
      </div>
    );
  }

  const { lead, events, allowedTransitions, undo } = detail;
  const forward = allowedTransitions.filter((s) => s !== "LOST");
  const next = forward[0];
  const canAct = !isViewer && (isAdmin || !lead.assignedUserId || lead.assignedUserId === user?.id);
  const undoLeft = undo.available && undo.untilIso ? Math.max(0, new Date(undo.untilIso).getTime() - now) : 0;
  const mmss = `${Math.floor(undoLeft / 60_000)}:${String(Math.floor((undoLeft % 60_000) / 1000)).padStart(2, "0")}`;

  const doUndo = async () => {
    try {
      const u = await pipelineApi.undo(lead.id);
      toast(t("stage.undone"));
      onChanged(u.lead);
    } catch (e) {
      toast(errText(e), { bad: true });
    }
  };
  const assign = async (toUserId: string | null, msg: string) => {
    try {
      const l = await pipelineApi.assign(lead.id, { toUserId });
      toast(msg);
      onChanged(l);
    } catch (e) {
      toast(errText(e), { bad: true });
    }
  };

  return (
    <section className="pl-page lead-page" aria-labelledby="lead-h" aria-busy={loading || undefined}>
      <div className="lead-top">
        <div className="lead-id">
          <a
            className="back"
            href="#/inbox"
            onClick={(e) => (e.preventDefault(), navigate("inbox"))}
            aria-label={t("common.back")}
          >
            <Icon name="arrowL" />
          </a>
          <div>
            <h1 id="lead-h">{lead.fullName}</h1>
            <div className="lead-meta">
              <StageTag code={lead.currentStage} />
              <SourceBadge source={lead.source} />
              <Country code={lead.country} />
              <Age lead={lead} now={now} />
              {lead.isTest && <span className="tag tag-neutral">{t("lead.isTest")}</span>}
            </div>
          </div>
        </div>

        <div className="lead-actions">
          {undo.available && undoLeft > 0 && canAct && (
            <Button icon="reset" onClick={doUndo}>
              {t("stage.undoUntil", { t: mmss })}
            </Button>
          )}
          {canAct && allowedTransitions.length > 0 ? (
            <>
              {next && (
                <Button variant="pri" size="lg" icon="arrow" loading={saving} onClick={() => move(lead, next)}>
                  {t("stage.next")}: {stageName(next)}
                </Button>
              )}
              <details
                className="menu-dd"
                ref={moreRef}
                open={moreOpen}
                onToggle={(e) => setMoreOpen((e.target as HTMLDetailsElement).open)}
              >
                <summary className="btn btn-sec btn-lg">
                  {t("stage.other")} <Icon name="chevron" size={14} />
                </summary>
                <div className="pop">
                  {allowedTransitions.map((s: StageCodeDto) => (
                    <button
                      key={s}
                      className={"menu-item" + (s === "LOST" ? " danger" : "")}
                      onClick={() => {
                        setMoreOpen(false);
                        move(lead, s);
                      }}
                    >
                      {stageName(s)}
                    </button>
                  ))}
                </div>
              </details>
            </>
          ) : allowedTransitions.length === 0 ? (
            <p className="muted">{t("stage.terminalHint")}</p>
          ) : null}
        </div>
      </div>

      <div className="lead-grid">
        <div className="lead-left">
          <div className="panel">
            <h2 className="sec-h">{t("lead.contact")}</h2>
            <dl className="facts-dl">
              <Fact label={t("new.email")}>{lead.email ? <a href={`mailto:${lead.email}`}>{lead.email}</a> : "—"}</Fact>
              <Fact label={t("new.phone")}>
                {lead.phoneE164 ? (
                  <span className="pl-tel">
                    <a href={`tel:${lead.phoneE164}`}>{lead.phoneE164}</a>
                    <a
                      className="btn btn-ghost btn-sm"
                      href={`https://wa.me/${lead.phoneE164.replace(/\D/g, "")}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      WhatsApp
                    </a>
                  </span>
                ) : (
                  "—"
                )}
              </Fact>
              <Fact label={t("lead.company")}>{lead.company || "—"}</Fact>
              <Fact label={t("lead.city")}>{lead.city || "—"}</Fact>
            </dl>
          </div>
          <div className="panel">
            <h2 className="sec-h">{t("lead.project")}</h2>
            <dl className="facts-dl">
              <Fact label={t("lead.product")}>{lead.productInterest || "—"}</Fact>
              <Fact label={t("lead.created")}>{fmtDate(lead.createdAt, true)}</Fact>
              <Fact label={t("lead.owner")}>
                <span className="pl-owner-ctl">
                  <b>{nameOf(lead.assignedUserId)}</b>
                  {!isViewer && !lead.assignedUserId && user && (
                    <Button size="sm" icon="hand" onClick={() => assign(user.id, t("lead.taken"))}>
                      {t("lead.take")}
                    </Button>
                  )}
                  {!isViewer && !isAdmin && lead.assignedUserId === user?.id && (
                    <Button size="sm" onClick={() => assign(null, t("lead.released"))}>
                      {t("lead.release")}
                    </Button>
                  )}
                  {isAdmin && (
                    <select
                      aria-label={t("lead.assignTo")}
                      value={lead.assignedUserId ?? ""}
                      onChange={(e) => assign(e.target.value || null, t("lead.assigned"))}
                    >
                      <option value="">{t("common.pool")}</option>
                      {team.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  )}
                </span>
              </Fact>
              {lead.notes && <Fact label={t("lead.notes")}>{lead.notes}</Fact>}
            </dl>
          </div>
          {(lead.platformLeadId || lead.campaign.campaignName || Object.keys(lead.extraAnswers).length > 0) && (
            <details className="panel">
              <summary className="sec-h">{t("lead.sourceDetail")}</summary>
              <dl className="facts-dl">
                {lead.platformLeadId && (
                  <Fact label={t("lead.platformId")}>
                    <code>{lead.platformLeadId}</code>
                  </Fact>
                )}
                {lead.campaign.campaignName && <Fact label={t("lead.campaign")}>{lead.campaign.campaignName}</Fact>}
                {lead.campaign.adsetName && <Fact label={t("lead.adset")}>{lead.campaign.adsetName}</Fact>}
                {lead.campaign.adName && <Fact label={t("lead.ad")}>{lead.campaign.adName}</Fact>}
                {Object.entries(lead.extraAnswers).map(([k, v]) => (
                  <Fact key={k} label={k}>
                    {String(v)}
                  </Fact>
                ))}
              </dl>
            </details>
          )}
        </div>

        <div className="lead-right panel">
          <h2 className="sec-h">{t("lead.timeline")}</h2>
          <ol className="tl">
            {[...events].reverse().map((e) => (
              <TimelineItem key={e.id} e={e} stageName={stageName} reasonName={reasonName} who={nameOf} />
            ))}
          </ol>
        </div>
      </div>
      {dialog}
    </section>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="fact-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function TimelineItem({
  e,
  stageName,
  reasonName,
  who,
}: {
  e: StageEventDto;
  stageName: (c: StageCodeDto) => string;
  reasonName: (c: string | null) => string;
  who: (id: string | null) => string;
}) {
  const { t } = useLang();
  return (
    <li className={"tl-i" + (e.undoneAt ? " undone" : "") + (e.origin === "auto_fill" ? " auto" : "")}>
      <span className="tl-dot">
        <Icon
          name={
            e.stageCode === "WON"
              ? "trophy"
              : e.stageCode === "LOST"
                ? "ban"
                : e.origin === "system"
                  ? "inbox"
                  : "arrow"
          }
          size={14}
        />
      </span>
      <div>
        <div className="tl-stage">
          <b>{stageName(e.stageCode)}</b>
          {e.origin === "auto_fill" && <span className="tag tag-neutral">{t("stage.autoFill")}</span>}
          {e.undoneAt && <span className="tag tag-neutral">{t("stage.undoneTag")}</span>}
        </div>
        <small className="muted">
          {fmtDate(e.occurredAt, true)}
          {e.actorUserId && ` · ${t("stage.by", { who: who(e.actorUserId) })}`}
          {e.value && ` · ${money(e.value.amount, e.value.currency as Currency)}`}
          {e.lostReasonCode && ` · ${reasonName(e.lostReasonCode)}`}
        </small>
      </div>
    </li>
  );
}
