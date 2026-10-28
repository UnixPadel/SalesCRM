import { useCallback, useState } from "react";
import { Button, Empty, Skeleton } from "../components/ui";
import { useLang } from "../i18n";
import type { LeadDto, StageCodeDto } from "../modules/sales-pipeline/api/dto";
import { navigate } from "../router";
import { useCrm } from "../state/CrmContext";
import { Age, Country, SourceBadge, STAGE_TONE } from "./bits";
import { useErrorText, useLeads, useNow, useReference, useTeamNames } from "./hooks";
import { useStageMove } from "./useStageMove";

/**
 * Kanban: sütunlar aşamalardır. Sürükle-bırak aynı komutu çağırır ve aynı pencereleri açar;
 * geriye sürükleme engellenir ve nedeni tek satırla söylenir (Genel plan, satışçı arayüzü 5).
 * İzinli hedefler sunucudan değil, sabit sıradan türetilir: ileri yönlü, terminalden çıkış yok.
 */
export function KanbanPage() {
  const { t, lang } = useLang();
  const { toast, isViewer } = useCrm();
  const { ref } = useReference();
  const { leads, error, reload } = useLeads({});
  const { nameOf } = useTeamNames();
  const now = useNow(30_000);
  const errText = useErrorText();
  const [dragging, setDragging] = useState<LeadDto | null>(null);
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
  if (!ref || !leads) {
    return (
      <div className="kanban" aria-busy="true">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} h={240} />
        ))}
      </div>
    );
  }

  const order = ref.stages.map((s) => s.code);
  const idx = (c: StageCodeDto) => order.indexOf(c);
  const allowed = (from: StageCodeDto, to: StageCodeDto) => {
    const f = ref.stages.find((s) => s.code === from);
    return !!f && !f.isTerminal && idx(to) > idx(from);
  };

  const drop = (target: StageCodeDto) => {
    const lead = dragging;
    setDragging(null);
    setOver(null);
    if (!lead || lead.currentStage === target) return;
    if (!allowed(lead.currentStage, target)) {
      toast(t("stage.backwardBlocked", { n: ref.undoWindowMinutes }), { bad: true });
      return;
    }
    move(lead, target);
  };

  return (
    <section className="kanban-wrap" aria-label={t("board.title")}>
      <div className="kanban">
        {ref.stages.map((s, stageIdx) => {
          const cards = leads.filter((l) => l.currentStage === s.code);
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
                      {[l.company, l.productInterest].filter(Boolean).join(" · ") || l.email || l.phoneE164}
                    </div>
                    <div className="kb-facts">
                      <SourceBadge source={l.source} />
                      <Country code={l.country} />
                      <Age lead={l} now={now} />
                    </div>
                    <div className="kb-owner">{nameOf(l.assignedUserId)}</div>
                  </article>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      {dialog}
    </section>
  );
}
