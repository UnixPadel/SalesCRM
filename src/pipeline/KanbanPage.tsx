import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Empty, Icon, Skeleton, StatusTag, eur, money, relDays } from "../components/ui";
import { COUNTRY_NAME } from "../domain/constants";
import type { Currency } from "../domain/types";
import { useLang } from "../i18n";
import type { ColumnStatsDto, LeadListDto, StageCodeDto } from "../modules/sales-pipeline/api/dto";
import { navigate, setHashParams } from "../router";
import { useCrm } from "../state/CrmContext";
import { ACTIVITY_ICON, dueState } from "./activityBits";
import { STAGE_TONE } from "./bits";
import { pipelineApi } from "./api";
import { courtLine, daysAgo, openWarnings, productLine } from "./contact/trackingView";
import { useLogContact } from "./contact/useLogContact";
import {
  EMPTY_FILTER,
  filterCount,
  filterFromParams,
  filterToParams,
  hasFilterParams,
  isEmptyFilter,
  recallFilter,
  rememberFilter,
  type BoardFilter,
  SOURCES,
} from "./boardFilter";
import { useBoard, useErrorText, useNow, useReference, useTeamNames } from "./hooks";
import { useStageMove } from "./useStageMove";

const COUNTRIES = Object.entries(COUNTRY_NAME).sort((a, b) => a[1].localeCompare(b[1], "tr"));

/**
 * Kanban: sütunlar aşamalardır. Sürükle-bırak aynı komutu çağırır ve aynı pencereleri açar;
 * geriye sürükleme engellenir ve nedeni tek satırla söylenir (Genel plan, satışçı arayüzü 5).
 * İzinli hedefler sunucudan değil, sabit sıradan türetilir: ileri yönlü, terminalden çıkış yok.
 *
 * Faz 6b: filtreler (sorumlu · ülke · takipsiz) URL'de taşınır ve tarayıcıda hatırlanır; kolon başlığındaki
 * adet / toplam EUR / ortalama gün aynı filtrelenmiş kümeden, sunucuda hesaplanır (kural 4).
 */
export function KanbanPage({ params }: { params: URLSearchParams }) {
  const { t, lang } = useLang();
  const { toast, isViewer, isAdmin, user } = useCrm();
  const { ref } = useReference();
  const { team, nameOf } = useTeamNames();
  const now = useNow(30_000);
  const errText = useErrorText();

  // URL gerçek kaynak; parametresiz girişte hatırlanan filtre URL'ye yazılır (geçmişe kayıt eklemeden).
  const filter: BoardFilter = useMemo(() => filterFromParams(params), [params]);
  useEffect(() => {
    if (hasFilterParams(params)) return;
    const recalled = recallFilter();
    if (!isEmptyFilter(recalled)) setHashParams("pipeline", filterToParams(recalled), true);
  }, [params]);
  const setFilter = (patch: Partial<BoardFilter>) => {
    const next = { ...filter, ...patch };
    rememberFilter(next);
    setHashParams("pipeline", filterToParams(next), true);
  };

  const { board, error, reload } = useBoard({
    owner: filter.owner || undefined,
    country: filter.country || undefined,
    source: filter.source || undefined,
    rotting: filter.rotting,
    never: filter.never,
    hot: filter.hot,
    warning: filter.warning && isAdmin,
  });
  const [dragging, setDragging] = useState<LeadListDto | null>(null);
  const [over, setOver] = useState<StageCodeDto | null>(null);

  const onChanged = useCallback(() => reload(), [reload]);
  const { move, dialog } = useStageMove(ref, onChanged);
  const contact = useLogContact(onChanged);
  const take = async (l: LeadListDto) => {
    try {
      await pipelineApi.assign(l.id, { toUserId: user!.id });
      toast(t("lead.taken"));
      reload();
    } catch (e) {
      toast(errText(e), { bad: true });
    }
  };

  if (error) {
    return (
      <Empty title={errText(error)}>
        <Button onClick={reload} icon="refresh">
          {t("common.retry")}
        </Button>
      </Empty>
    );
  }

  const order = ref?.stages.map((s) => s.code) ?? [];
  const idx = (c: StageCodeDto) => order.indexOf(c);
  const allowed = (from: StageCodeDto, to: StageCodeDto) => {
    const f = ref?.stages.find((s) => s.code === from);
    return !!f && !f.isTerminal && idx(to) > idx(from);
  };

  const drop = (target: StageCodeDto) => {
    const lead = dragging;
    setDragging(null);
    setOver(null);
    if (!lead || lead.currentStage === target || !ref) return;
    if (!allowed(lead.currentStage, target)) {
      toast(t("stage.backwardBlocked", { n: ref.undoWindowMinutes }), { bad: true });
      return;
    }
    // Faz 7g (§5.1): temas kaydı olmayan lead NEW → CONTACTED bırakılınca "Temas kaydet" açılır (aşama satırı
    // önerili); "Yalnız aşamayı taşı" eski akıştır.
    if (lead.currentStage === "NEW" && target === "CONTACTED" && lead.contact.state !== "contacted") {
      contact.openDialog({
        leadId: lead.id,
        leadName: lead.fullName,
        outcome: "reply_received",
        alt: { label: t("board.logOnDrop"), run: () => move(lead, target) },
      });
      return;
    }
    move(lead, target);
  };

  const statsOf = (code: StageCodeDto): ColumnStatsDto | undefined => board?.columns.find((c) => c.stage === code);
  const active = !isEmptyFilter(filter);
  const nActive = filterCount(filter);

  return (
    <section className="kanban-wrap" aria-label={t("board.title")}>
      <div className="toolbar board-bar">
        <h1 className="pl-title">
          {t("board.title")}
          {board && <span className="muted"> · {t("board.count", { n: board.leads.length })}</span>}
        </h1>
        <div className="filters" role="group" aria-label={t("board.filters")}>
          <select
            aria-label={t("board.filter.owner")}
            value={filter.owner}
            onChange={(e) => setFilter({ owner: e.target.value })}
          >
            <option value="">{t("board.filter.allOwners")}</option>
            <option value="me">{t("common.me")}</option>
            <option value="pool">{t("common.pool")}</option>
            {team.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <select
            aria-label={t("board.filter.country")}
            value={filter.country}
            onChange={(e) => setFilter({ country: e.target.value })}
          >
            <option value="">{t("board.filter.allCountries")}</option>
            {COUNTRIES.map(([code, name]) => (
              <option key={code} value={code}>
                {name} ({code})
              </option>
            ))}
          </select>
          <select
            aria-label={t("board.filter.source")}
            value={filter.source}
            onChange={(e) => setFilter({ source: e.target.value })}
          >
            <option value="">{t("board.filter.allSources")}</option>
            {SOURCES.map((s) => (
              <option key={s} value={s}>
                {t(`source.${s}`)}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="chip chip-bad hit"
            aria-pressed={filter.rotting}
            onClick={() => setFilter({ rotting: !filter.rotting })}
            title={t("activity.rottingHint")}
          >
            <Icon name="clock" size={14} /> {t("activity.rotting")}
          </button>
          <button
            type="button"
            className="chip chip-bad hit"
            aria-pressed={filter.never}
            onClick={() => setFilter({ never: !filter.never })}
          >
            <Icon name="warn" size={14} /> {t("board.quick.never")}
          </button>
          <button
            type="button"
            className="chip hit"
            aria-pressed={filter.hot}
            onClick={() => setFilter({ hot: !filter.hot })}
          >
            <Icon name="flame" size={14} /> {t("board.quick.hot")}
          </button>
          {isAdmin && (
            <button
              type="button"
              className="chip hit"
              aria-pressed={filter.warning}
              onClick={() => setFilter({ warning: !filter.warning })}
            >
              <Icon name="warn" size={14} /> {t("board.quick.warning")}
            </button>
          )}
          {active && (
            <span className="ll-active">
              {t("board.filtersActive", { n: nActive })} ·{" "}
              <button type="button" className="link-btn" onClick={() => setFilter(EMPTY_FILTER)}>
                {t("board.filter.clear")}
              </button>
            </span>
          )}
        </div>
      </div>

      {!ref || !board ? (
        <div className="kanban" aria-busy="true">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} h={240} />
          ))}
        </div>
      ) : (
        <div className="kanban">
          {ref.stages.map((s, stageIdx) => {
            const cards = board.leads.filter((l) => l.currentStage === s.code);
            const st = statsOf(s.code);
            const canDrop = dragging ? allowed(dragging.currentStage, s.code) : false;
            const blocked = dragging ? !canDrop && dragging.currentStage !== s.code : false;
            return (
              <div
                key={s.code}
                className={
                  "col kb-col" +
                  (over === s.code ? (canDrop ? " over-ok" : " over-no") : "") +
                  (blocked ? " blocked" : "")
                }
                style={{ ["--tone" as string]: `var(--col-${STAGE_TONE[s.code]})` }}
                onDragOver={(e) => {
                  if (!dragging) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = canDrop ? "move" : "none";
                  if (over !== s.code) setOver(s.code);
                }}
                onDragLeave={() => over === s.code && setOver(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  drop(s.code);
                }}
              >
                <div className="col-head">
                  <span className="col-no">{stageIdx + 1}</span>
                  <span>
                    <b className="col-name">{lang === "tr" ? s.nameTr : s.nameEn}</b>
                  </span>
                  <span className="col-count">{cards.length}</span>
                  {st && cards.length > 0 && (
                    <span className="col-stats" title={t("board.stats.hint")}>
                      {st.totalEur > 0 && <b>{eur(st.totalEur, true)}</b>}
                      {st.unconverted > 0 && <span title={t("board.stats.unconverted", { n: st.unconverted })}>*</span>}
                      <span>{t("board.stats.avgDays", { n: st.avgDays })}</span>
                    </span>
                  )}
                </div>
                <div className="col-body">
                  {cards.length === 0 && (
                    <div className="col-empty">{dragging && canDrop ? t("board.dropHere") : t("board.empty")}</div>
                  )}
                  {cards.map((l) => (
                    <article
                      key={l.id}
                      className={"card kb-card" + (dragging?.id === l.id ? " dragging" : "")}
                      draggable={!isViewer && !s.isTerminal}
                      tabIndex={0}
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", l.id);
                        setDragging(l);
                      }}
                      onDragEnd={() => {
                        setDragging(null);
                        setOver(null);
                      }}
                      onClick={() => navigate("lead", undefined, l.id)}
                      onKeyDown={(e) => e.key === "Enter" && navigate("lead", undefined, l.id)}
                      aria-label={`${l.fullName}, ${t("board.open")}`}
                    >
                      {/* Kart 4 satır (Faz 7g, §5.1): ad · ürün · tek durum çipi · sorumlu ve son temas. */}
                      <div className="card-name">{l.fullName}</div>
                      {(() => {
                        const sub =
                          productLine(l.products, t, lang, true) ||
                          [courtLine(l, t), l.productInterest].filter(Boolean).join(" · ") ||
                          l.courtModel;
                        return sub ? <div className="card-sub">{sub}</div> : null;
                      })()}
                      <div className="kb-foot kb-state">
                        {!s.isTerminal && l.contact.state === "never" ? (
                          <StatusTag tone="bad" icon="warn">
                            {t("summary.never")}
                          </StatusTag>
                        ) : l.rotting ? (
                          <StatusTag tone="bad" icon="clock" title={t("activity.rottingHint")}>
                            {t("activity.rotting")}
                          </StatusTag>
                        ) : l.nextActivity ? (
                          <span
                            className={"kb-next is-" + dueState(l.nextActivity.dueAt, now)}
                            title={`${l.nextActivity.subject} · ${l.nextActivity.dueAt.slice(0, 16).replace("T", " ")}`}
                          >
                            <Icon name={ACTIVITY_ICON[l.nextActivity.type]} size={13} />
                            {t("board.nextAt", { d: relDays(l.nextActivity.dueAt) })}
                          </span>
                        ) : null}
                        {l.hot && (
                          <StatusTag tone="warn" icon="flame">
                            {t("hot.label")}
                          </StatusTag>
                        )}
                        {(s.code === "PROPOSAL" || s.code === "WON") && l.value && (
                          <span className="kb-chip kb-chip-money" title={t("lead.value")}>
                            <Icon name="money" size={13} /> {money(l.value.amount, l.value.currency as Currency, true)}
                          </span>
                        )}
                      </div>
                      <div className="kb-foot">
                        <span className="kb-owner">
                          {l.assignedUserId ? (
                            nameOf(l.assignedUserId)
                          ) : (
                            <>
                              {t("common.pool")}
                              {!isViewer && !isAdmin && (
                                <Button
                                  size="sm"
                                  className="hit"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    take(l);
                                  }}
                                >
                                  {t("lead.take")}
                                </Button>
                              )}
                            </>
                          )}
                        </span>
                        <span className="muted">
                          {l.contact.lastAt
                            ? t("board.lastContact", { d: daysAgo(l.contact.lastAt, now, lang) })
                            : l.contact.state === "legacy"
                              ? t("summary.legacyShort")
                              : ""}
                        </span>
                        {isAdmin && openWarnings(l.warnings).length > 0 && (
                          <span
                            className="inline-warn"
                            aria-label={t("warning.count", { n: openWarnings(l.warnings).length })}
                          >
                            <Icon name="warn" size={13} /> {openWarnings(l.warnings).length}
                          </span>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {dialog}
      {contact.dialog}
    </section>
  );
}
