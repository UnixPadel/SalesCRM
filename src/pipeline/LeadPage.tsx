import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Empty, Icon, Skeleton, StatusTag, fmtDate, money, relDays } from "../components/ui";
import type { Currency } from "../domain/types";
import { useLang } from "../i18n";
import type { ActivityDto, LeadDto, StageCodeDto, StageEventDto } from "../modules/sales-pipeline/api/dto";
import { navigate } from "../router";
import { useCrm } from "../state/CrmContext";
import { ACTIVITY_ICON, ActivityItem, AddActivityForm } from "./activityBits";
import { pipelineApi } from "./api";
import { Age, Country, SourceBadge, StageTag } from "./bits";
import { LeadContactForm } from "./LeadContactForm";
import { LeadFieldsForm } from "./LeadFieldsForm";
import { useErrorText, useLeadDetail, useNow, useReference, useTeamNames } from "./hooks";
import { useStageMove } from "./useStageMove";
import { ContactLinks } from "./contact/ContactQuickBar";
import {
  ContactSummaryPanel,
  CustomerStatusField,
  CustomerStatusTag,
  FormAnswersPanel,
  InlinePhoneWarnings,
  ProductsPanel,
  SourceDetail,
  WarningsPanel,
} from "./contact/LeadSections";
import { useLogContact } from "./contact/useLogContact";

/**
 * Lead detayı (Faz 7g, iş emri §5.2): tek birincil eylem "Temas kaydet"; aşama ikincil menüde. Solda iletişim, temas
 * özeti, müşteri durumu, ürünler, form cevapları; sağda planlı işler ve zaman çizelgesi (aşamalar + temaslar).
 */
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
      // Komut yanıtı yalın lead döner; aktivite özeti yeniden yüklemeye kadar eski değerle kalır.
      setDetail((d) => (d ? { ...d, lead: { ...d.lead, ...lead } } : d));
      reload();
    },
    [setDetail, reload],
  );
  // Kazanıldı penceresi son geçerli teklif tutarıyla açılır; satışçı yalnız onaylar ya da düzeltir.
  const lastValue = useCallback(
    () =>
      [...(detail?.events ?? [])].reverse().find((e) => e.stageCode === "PROPOSAL" && !e.undoneAt && e.value)?.value ??
      null,
    [detail],
  );
  const { move, dialog, saving } = useStageMove(ref, onChanged, { lastValue });
  const contact = useLogContact(reload);
  const [moreOpen, setMoreOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editingContact, setEditingContact] = useState(false);
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
        <Button icon="arrowL" onClick={() => navigate("list")}>
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

  const { lead, organization, events, activities, allowedTransitions, undo, contactLogs } = detail;
  const openActs = activities.filter((a) => a.doneAt === null);
  const doneActs = activities
    .filter((a) => a.doneAt !== null)
    .sort((a, b) => (b.doneAt ?? "").localeCompare(a.doneAt ?? ""));
  const toggleActivity = async (id: string, done: boolean) => {
    try {
      await pipelineApi.setActivityDone(id, done);
      toast(done ? t("activity.done") : t("activity.reopened"));
      reload();
    } catch (e) {
      toast(errText(e), { bad: true });
    }
  };
  const deleteActivity = async (id: string) => {
    try {
      await pipelineApi.deleteActivity(id);
      toast(t("activity.deleted"));
      reload();
    } catch (e) {
      toast(errText(e), { bad: true });
    }
  };
  const forward = allowedTransitions.filter((s) => s !== "LOST");
  const next = forward[0];
  const canAct = !isViewer && (isAdmin || !lead.assignedUserId || lead.assignedUserId === user?.id);
  // Müşteri bilgileri (kişi, kuruluş, fırsat alanları) yalnız yönetici (Faz 7e); satışçı notu değiştirir.
  const canEditCustomer = isAdmin;
  const undoLeft = undo.available && undo.untilIso ? Math.max(0, new Date(undo.untilIso).getTime() - now) : 0;
  const mmss = `${Math.floor(undoLeft / 60_000)}:${String(Math.floor((undoLeft % 60_000) / 1000)).padStart(2, "0")}`;

  const doUndo = async () => {
    // Son aşama değişikliği bir temas kaydından geldiyse ikisi birlikte geri alınır [U-I7].
    if (undo.contactLogId) return contact.undo(undo.contactLogId);
    try {
      const u = await pipelineApi.undo(lead.id);
      toast(t("stage.undone"));
      onChanged(u.lead);
    } catch (e) {
      toast(errText(e), { bad: true });
    }
  };
  const logFor = (type?: ActivityDto["type"], outcome?: ActivityDto["outcome"], activityId?: string | null) =>
    contact.openDialog({
      leadId: lead.id,
      leadName: lead.fullName,
      ...(type ? { type } : {}),
      ...(outcome ? { outcome } : {}),
      ...(activityId !== undefined ? { activityId } : {}),
    });
  const logById = new Map(contactLogs.map((c) => [c.activityId, c]));
  const deleteContact = async (id: string) => {
    if (!window.confirm(t("contact.deleteConfirm"))) return;
    await deleteActivity(id);
  };
  const excelOwner =
    typeof lead.extraAnswers["excel_owner"] === "string" ? String(lead.extraAnswers["excel_owner"]) : null;
  const canSetStatus = canAct;
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
            href="#/list"
            onClick={(e) => (e.preventDefault(), navigate("list"))}
            aria-label={t("common.back")}
          >
            <Icon name="arrowL" />
          </a>
          <div>
            <h1 id="lead-h">{lead.fullName}</h1>
            <div className="lead-meta">
              <StageTag code={lead.currentStage} />
              {lead.hot && (
                <StatusTag tone="warn" icon="flame">
                  {t("hot.label")}
                </StatusTag>
              )}
              {lead.customerStatus && <CustomerStatusTag status={lead.customerStatus} />}
              {!lead.assignedUserId && (
                <span className="tag tag-neutral">
                  {t("common.pool")}
                  {excelOwner ? ` · ${t("lead.excelOwner", { name: excelOwner })}` : ""}
                </span>
              )}
              <SourceBadge source={lead.source} lead={lead} />
              <Country code={lead.country} />
              <Age lead={lead} now={now} />
              {lead.isTest && <span className="tag tag-neutral">{t("lead.isTest")}</span>}
            </div>
          </div>
        </div>

        <div className="lead-actions">
          {undo.available && undoLeft > 0 && canAct && (
            <Button icon="reset" onClick={doUndo}>
              {undo.contactLogId ? t("contact.undoLog") : t("stage.undoUntil", { t: mmss })}
            </Button>
          )}
          {canAct && (
            <Button variant="pri" size="lg" icon="chat" onClick={() => logFor()}>
              {t("contact.log")}
            </Button>
          )}
          {canAct && allowedTransitions.length > 0 ? (
            <>
              <details
                className="menu-dd"
                ref={moreRef}
                open={moreOpen}
                onToggle={(e) => setMoreOpen((e.target as HTMLDetailsElement).open)}
              >
                <summary className="btn btn-sec btn-lg" aria-busy={saving || undefined}>
                  {t("stage.menu", { stage: stageName(lead.currentStage) })} <Icon name="chevron" size={14} />
                </summary>
                <div className="pop">
                  {[...(next ? [next] : []), ...allowedTransitions.filter((x) => x !== next)].map((s: StageCodeDto) => (
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

      {isAdmin && <WarningsPanel lead={lead} onChanged={onChanged} />}
      <div className="lead-grid">
        <div className="lead-left">
          <div className="panel">
            <h2 className="sec-h">
              {t("lead.contact")}
              {canEditCustomer && !editingContact && (
                <span className="end">
                  <Button size="sm" icon="edit" onClick={() => setEditingContact(true)}>
                    {t("lead.edit")}
                  </Button>
                </span>
              )}
            </h2>
            {editingContact ? (
              <LeadContactForm
                lead={lead}
                onCancel={() => setEditingContact(false)}
                onSaved={(l) => {
                  setEditingContact(false);
                  onChanged(l);
                }}
              />
            ) : (
              <dl className="facts-dl">
                <div className="fact-row wide">
                  <dd>
                    <ContactLinks
                      phone={lead.phoneE164}
                      email={lead.email}
                      canLog={canAct}
                      onQuick={(type, outcome) => contact.quick(lead.id, type, outcome)}
                      onDetails={(type, outcome) => logFor(type, outcome)}
                    />
                    {!isAdmin && <InlinePhoneWarnings lead={lead} />}
                  </dd>
                </div>
                <Fact label={t("lead.organization")}>
                  {organization ? (
                    <>
                      <a
                        href={`#/contacts?q=${encodeURIComponent(organization.name)}`}
                        onClick={(e) => (e.preventDefault(), navigate("contacts", organization.name))}
                      >
                        {organization.name}
                      </a>
                      {organization.archivedAt && <span className="tag tag-neutral">{t("org.archived")}</span>}
                    </>
                  ) : (
                    "—"
                  )}
                </Fact>
                <Fact label={t("lead.company")}>{lead.company || "—"}</Fact>
                <Fact label={t("lead.city")}>{lead.city || "—"}</Fact>
              </dl>
            )}
          </div>
          <ContactSummaryPanel lead={lead} isAdmin={isAdmin} />
          <CustomerStatusField lead={lead} canSet={canSetStatus} onSaved={onChanged} />
          <ProductsPanel
            lead={lead}
            canEdit={isAdmin || (!isViewer && !!ref.permissions?.repsEditProducts && lead.assignedUserId === user?.id)}
            ownerMayEdit={!!ref.permissions?.repsEditProducts}
            onSaved={onChanged}
          />
          <FormAnswersPanel lead={lead} canEdit={isAdmin} onSaved={onChanged} />
          <div className="panel">
            <h2 className="sec-h">
              {t("lead.project")}
              {canAct && !editing && (
                <span className="end">
                  <Button size="sm" icon="edit" onClick={() => setEditing(true)}>
                    {canEditCustomer ? t("lead.edit") : t("lead.editNotes")}
                  </Button>
                </span>
              )}
            </h2>
            {editing ? (
              <LeadFieldsForm
                lead={lead}
                notesOnly={!canEditCustomer}
                onCancel={() => setEditing(false)}
                onSaved={(l) => {
                  setEditing(false);
                  onChanged(l);
                }}
              />
            ) : (
              <dl className="facts-dl">
                <Fact label={t("lead.expectedClose")}>
                  {lead.expectedCloseDate
                    ? `${fmtDate(lead.expectedCloseDate)} · ${relDays(lead.expectedCloseDate)}`
                    : "—"}
                </Fact>
                <Fact label={t("lead.value")}>
                  {lead.value ? money(lead.value.amount, lead.value.currency as Currency) : "—"}
                </Fact>
                <Fact label={t("lead.inStage")}>
                  {t("board.inStage", {
                    n: Math.max(0, Math.floor((now - new Date(lead.stageEnteredAt).getTime()) / 86_400_000)),
                  })}
                  <span className="muted"> · {fmtDate(lead.stageEnteredAt, true)}</span>
                </Fact>
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
            )}
          </div>
          <div className="panel" aria-labelledby="act-h">
            <h2 className="sec-h" id="act-h">
              {t("activity.title")} <span className="count">{openActs.length}</span>
              {lead.rotting && (
                <span className="end">
                  <StatusTag tone="bad" icon="flame">
                    {t("activity.rotting")}
                  </StatusTag>
                </span>
              )}
            </h2>
            {lead.rotting && <p className="muted">{t("activity.rottingHint")}</p>}
            {openActs.length > 0 && (
              <div className="alist">
                {openActs.map((a) => (
                  <ActivityItem
                    key={a.id}
                    a={a}
                    canEdit={canAct}
                    onToggle={(done) => toggleActivity(a.id, done)}
                    onDelete={() => deleteActivity(a.id)}
                    onComplete={() => logFor(a.type, undefined, a.id)}
                    now={now}
                  />
                ))}
              </div>
            )}
            {openActs.length === 0 && !lead.rotting && <p className="muted">{t("activity.none")}</p>}
            {canAct && <AddActivityForm leadId={lead.id} onAdded={() => reload()} />}
          </div>
          <SourceDetail lead={lead} />
        </div>

        <div className="lead-right panel">
          <h2 className="sec-h">{t("lead.timeline")}</h2>
          <ol className="tl">
            {[
              ...events.map((e) => ({ at: e.occurredAt, k: "e" as const, e })),
              ...doneActs.map((a) => ({ at: a.doneAt ?? a.dueAt, k: "a" as const, a })),
            ]
              .sort((x, y) => y.at.localeCompare(x.at))
              .map((x) =>
                x.k === "e" ? (
                  <TimelineItem key={x.e.id} e={x.e} stageName={stageName} reasonName={reasonName} who={nameOf} />
                ) : (
                  <ContactItem
                    key={x.a.id}
                    a={x.a}
                    who={nameOf}
                    now={now}
                    log={logById.get(x.a.id)}
                    onUndo={(id) => contact.undo(id)}
                    onDelete={isAdmin ? () => deleteContact(x.a.id) : undefined}
                  />
                ),
              )}
          </ol>
        </div>
      </div>
      {dialog}
      {contact.dialog}
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

/** Zaman çizelgesinde temas satırı: kanal, sonuç, not, kaydeden; pencere içindeyse "Geri al (9:58)". */
function ContactItem({
  a,
  who,
  now,
  log,
  onUndo,
  onDelete,
}: {
  a: ActivityDto;
  who: (id: string | null) => string;
  now: number;
  log: { id: string; undoUntil: string; canUndo: boolean } | undefined;
  onUndo: (logId: string) => void;
  onDelete: (() => void) | undefined;
}) {
  const { t } = useLang();
  const left = log ? new Date(log.undoUntil).getTime() - now : 0;
  const mins = Math.max(0, Math.ceil(left / 60_000));
  const mmss = `${Math.floor(Math.max(0, left) / 60_000)}:${String(Math.floor((Math.max(0, left) % 60_000) / 1000)).padStart(2, "0")}`;
  return (
    <li className="tl-i tl-contact">
      <span className="tl-dot">
        <Icon name={ACTIVITY_ICON[a.type]} size={14} />
      </span>
      <div>
        <div className="tl-stage">
          <b>{t(`activity.type.${a.type}`)}</b>
          {a.outcome && <span> · {t(`activity.outcome.${a.outcome}`)}</span>}
          {a.customerReplied && <span className="tag tag-neutral">{t("contact.replied")}</span>}
        </div>
        {a.resultNote && <p className="tl-note">{a.resultNote}</p>}
        <small className="muted">
          {a.dateEstimated ? "≈ " : ""}
          {fmtDate(a.doneAt ?? a.dueAt, !a.dateEstimated)}
          {(a.doneByUserId ?? a.createdByUserId) &&
            ` · ${t("contact.by", { who: who(a.doneByUserId ?? a.createdByUserId) })}`}
        </small>
        <div className="tl-acts">
          {log?.canUndo && left > 0 && (
            <button
              type="button"
              className="link-btn"
              onClick={() => onUndo(log.id)}
              aria-label={t("contact.undoLeft", { n: mins })}
            >
              {t("contact.undo")} <span aria-hidden="true">({mmss})</span>
            </button>
          )}
          {onDelete && (
            <button type="button" className="link-btn danger" onClick={onDelete}>
              {t("activity.delete")}
            </button>
          )}
        </div>
      </div>
    </li>
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
