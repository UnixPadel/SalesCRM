import { useState } from "react";
import { Button, Empty, Icon, Skeleton } from "../components/ui";
import { useLang } from "../i18n";
import type { ActivityTypeDto, TodayDto, TodayItemDto } from "../modules/sales-pipeline/api/dto";
import { useCrm } from "../state/CrmContext";
import { ACTIVITY_ICON, ACTIVITY_TYPES, ActivityItem } from "./activityBits";
import { pipelineApi } from "./api";
import { useErrorText, useNow, useTeamNames, useToday } from "./hooks";

const GROUPS = ["overdue", "today", "upcoming"] as const satisfies readonly (keyof TodayDto)[];

/**
 * "Bugün" (Faz 6a): görünür lead'lerin açık aktiviteleri üç kümede. Satışçı kendi ve havuzdakileri, admin
 * hepsini görür (sunucu karar verir). Tek tıkla tamamla; lead adına tıklayınca detaya gider.
 */
export function ActivitiesPage() {
  const { t } = useLang();
  const { toast, isViewer, isAdmin } = useCrm();
  const { data, error, reload } = useToday();
  const { nameOf } = useTeamNames();
  const errText = useErrorText();
  const now = useNow(30_000);
  const [types, setTypes] = useState<Partial<Record<ActivityTypeDto, boolean>>>({});
  const typeOn = Object.values(types).some(Boolean);

  if (error) {
    return (
      <Empty title={errText(error)}>
        <Button onClick={reload} icon="refresh">
          {t("common.retry")}
        </Button>
      </Empty>
    );
  }
  if (!data) {
    return (
      <div className="pl-page today-page" aria-busy="true">
        <Skeleton h={40} w={320} />
        <Skeleton h={120} />
        <Skeleton h={120} />
      </div>
    );
  }

  const visible = (items: TodayItemDto[]) => (typeOn ? items.filter((x) => types[x.activity.type]) : items);
  const toggle = async (x: TodayItemDto, done: boolean) => {
    try {
      await pipelineApi.setActivityDone(x.activity.id, done);
      toast(done ? t("activity.done") : t("activity.reopened"));
      reload();
    } catch (e) {
      toast(errText(e), { bad: true });
    }
  };

  return (
    <section className="pl-page today-page" aria-labelledby="today-h">
      <div className="today-bar">
        <div>
          <h1 id="today-h">{t("today.title")}</h1>
          <p className="muted">
            {t("today.summary", {
              overdue: data.overdue.length,
              today: data.today.length,
              upcoming: data.upcoming.length,
            })}
          </p>
        </div>
        <div className="filters" role="group" aria-label={t("activity.type")}>
          {ACTIVITY_TYPES.map((k) => (
            <button
              key={k}
              type="button"
              className="chip"
              aria-pressed={!!types[k]}
              onClick={() => setTypes({ ...types, [k]: !types[k] })}
            >
              <Icon name={ACTIVITY_ICON[k]} size={14} /> {t(`activity.type.${k}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="agroups">
        {GROUPS.map((g) => {
          const items = visible(data[g]);
          return (
            <section key={g} className={"agroup " + g} aria-labelledby={`ag-${g}`}>
              <h2 id={`ag-${g}`}>
                {t(`activity.${g}`)} <span className="count">{items.length}</span>
              </h2>
              {items.length ? (
                <div className="alist">
                  {items.map((x) => (
                    <ActivityItem
                      key={x.activity.id}
                      a={x.activity}
                      lead={{
                        ...x.lead,
                        company: isAdmin && x.lead.assignedUserId ? nameOf(x.lead.assignedUserId) : x.lead.company,
                      }}
                      canEdit={!isViewer}
                      onToggle={(done) => toggle(x, done)}
                      now={now}
                    />
                  ))}
                </div>
              ) : g === "overdue" ? (
                <Empty title={t("today.emptyOverdue")} tone="ok" />
              ) : (
                <p className="tl-empty">{t(g === "today" ? "today.emptyToday" : "today.emptyUpcoming")}</p>
              )}
            </section>
          );
        })}
      </div>
    </section>
  );
}
