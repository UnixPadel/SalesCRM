import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Empty, Icon, Skeleton, StatusTag, eur, money, relDays } from "../components/ui";
import { COUNTRY_NAME } from "../domain/constants";
import type { Currency } from "../domain/types";
import { useLang } from "../i18n";
import type { ColumnStatsDto, LeadListDto, StageCodeDto } from "../modules/sales-pipeline/api/dto";
import { navigate, setHashParams } from "../router";
import { useCrm } from "../state/CrmContext";
import { ACTIVITY_ICON, dueState } from "./activityBits";
import { Age, Country, SourceBadge, STAGE_TONE } from "./bits";
import {
  EMPTY_FILTER,
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
  const { toast, isViewer } = useCrm();
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
    rotting: filter.rotting,
  });
  const [dragging, setDragging] = useState<LeadListDto | null>(null);
  const [over, setOver] = useState<StageCodeDto | null>(null);

  const onChanged = useCallback(() => reload(), [reload]);
  const { move, dialog } = useStageMove(ref, onChanged);

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
    move(lead, target);
  };

  const statsOf = (code: StageCodeDto): ColumnStatsDto | undefined => board?.columns.find((c) => c.stage === code);
  const active = !isEmptyFilter(filter);

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
            className="chip chip-bad"
            aria-pressed={filter.rotting}
            onClick={() => setFilter({ rotting: !filter.rotting })}
            title={t("activity.rottingHint")}
          >
            <Icon name="flame" size={14} /> {t("activity.rotting")}
          </button>
          {active && (
            <Button size="sm" icon="x" onClick={() => setFilter(EMPTY_FILTER)}>
              {t("board.filter.clear")}
            </Button>
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
                      <div className="card-name">{l.fullName}</div>
                      <div className="card-sub">
                        {[l.company, l.productInterest || l.courtModel].filter(Boolean).join(" · ") ||
                          l.email ||
                          l.phoneE164}
                      </div>
                      <div className="kb-facts">
                        <SourceBadge source={l.source} />
                        <Country code={l.country} />
                        <Age lead={l} now={now} />
                      </div>
                      <OpportunityChips lead={l} terminal={s.isTerminal} now={now} />
                      <div className="kb-foot">
                        {l.rotting ? (
                          <StatusTag tone="bad" icon="flame" title={t("activity.rottingHint")}>
                            {t("activity.rotting")}
                          </StatusTag>
                        ) : l.nextActivity ? (
                          <span
                            className={"kb-next is-" + dueState(l.nextActivity.dueAt, now)}
                            title={`${l.nextActivity.subject} · ${l.nextActivity.dueAt.slice(0, 16).replace("T", " ")}`}
                          >
                            <Icon name={ACTIVITY_ICON[l.nextActivity.type]} size={13} />
                            {relDays(l.nextActivity.dueAt)}
                          </span>
                        ) : (
                          <span />
                        )}
                        <span className="kb-owner">{nameOf(l.assignedUserId)}</span>
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
    </section>
  );
}

/** Kartta fırsat çipleri: kort sayısı, son tutar, beklenen kapanış (geçmişse turuncu), aşamada geçen gün. */
function OpportunityChips({ lead, terminal, now }: { lead: LeadListDto; terminal: boolean; now: number }) {
  const { t } = useLang();
  const days = Math.max(0, Math.floor((now - new Date(lead.stageEnteredAt).getTime()) / 86_400_000));
  const closeLate =
    !terminal && lead.expectedCloseDate !== null && new Date(lead.expectedCloseDate + "T23:59:59").getTime() < now;
  if (lead.courtCount === null && !lead.value && !lead.expectedCloseDate && days < 1) return null;
  return (
    <div className="kb-opp">
      {lead.courtCount !== null && (
        <span className="kb-chip" title={t("lead.courtCount")}>
          <Icon name="court" size={13} /> {t("board.courts", { n: lead.courtCount })}
        </span>
      )}
      {lead.value && (
        <span className="kb-chip kb-chip-money" title={t("lead.value")}>
          <Icon name="money" size={13} /> {money(lead.value.amount, lead.value.currency as Currency, true)}
        </span>
      )}
      {lead.expectedCloseDate && (
        <span className={"kb-chip" + (closeLate ? " is-late" : "")} title={t("lead.expectedClose")}>
          <Icon name="calendar" size={13} /> {relDays(lead.expectedCloseDate)}
        </span>
      )}
      {days >= 1 && (
        <span className="kb-chip kb-chip-days" title={t("lead.inStageHint")}>
          <Icon name="clock" size={13} /> {t("board.inStage", { n: days })}
        </span>
      )}
    </div>
  );
}
