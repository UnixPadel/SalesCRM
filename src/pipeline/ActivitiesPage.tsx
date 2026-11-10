import { useState } from "react";
import { Button, Empty, Icon, Skeleton } from "../components/ui";
import { useLang } from "../i18n";
import type { ActivityTypeDto, TodayDto, TodayItemDto } from "../modules/sales-pipeline/api/dto";
import { useCrm } from "../state/CrmContext";
import { ACTIVITY_ICON, ACTIVITY_TYPES, ActivityItem } from "./activityBits";
import { pipelineApi } from "./api";
import { useErrorText, useNow, useTeamNames, useToday } from "./hooks";
import { ContactHistory } from "./contact/ContactHistory";
import { useLogContact } from "./contact/useLogContact";
import { setHashParams } from "../router";

const GROUPS = ["overdue", "today", "upcoming"] as const satisfies readonly (keyof TodayDto)[];

/**
 * "Bugün" (Faz 6a, 7g): iki sekme. Yapılacaklar: görünür lead'lerin açık işleri üç kümede; "Tamamla…" Temas kaydet
 * diyaloğunu tamamlama modunda açar; hiç ulaşılmamış sıcak lead varsa şerit. Temas geçmişi: Excel TEMAS GEÇMİŞİ.
 */
export function ActivitiesPage({ params }: { params: URLSearchParams }) {
  const tab = params.get("tab") === "history" ? "history" : "todo";
  const { t } = useLang();
  return (
    <section className="pl-page today-page" aria-labelledby="today-h">
      <div className="today-bar">
        <h1 id="today-h">{t("today.title")}</h1>
        <div className="tabs" role="tablist" aria-label={t("today.title")}>
          {(["todo", "history"] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={tab === k}
              className={"tab" + (tab === k ? " on" : "")}
              onClick={() =>
                setHashParams("activities", new URLSearchParams(k === "history" ? "tab=history" : ""), true)
              }
            >
              {t(`today.tab.${k}`)}
            </button>
          ))}
        </div>
      </div>
      {tab === "history" ? <ContactHistory /> : <TodoList />}
    </section>
  );
}

function TodoList() {
  const { t } = useLang();
  const { toast, isViewer, isAdmin } = useCrm();
  const { data, error, reload } = useToday();
  const contact = useLogContact(reload);
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
  const all = [...data.overdue, ...data.today, ...data.upcoming];
  // Teklif hazırlama ve Saha ziyareti çipleri sayıları 0 iken gizli [U-M10].
  const chipTypes = ACTIVITY_TYPES.filter(
    (k) => (k !== "proposal_sent" && k !== "site_visit") || all.some((x) => x.activity.type === k),
  );
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
    <>
      {data.hotUncontacted > 0 && (
        <div className="hot-banner" role="note">
          <Icon name="flame" size={18} />
          <span>{t("today.hot", { n: data.hotUncontacted })}</span>
          <a
            className="btn btn-sec btn-md"
            href="#/list?from=today&hot=1&contact=never"
            onClick={(e) => {
              e.preventDefault();
              setHashParams("list", new URLSearchParams("from=today&hot=1&contact=never"));
            }}
          >
            {t("today.openList")}
          </a>
        </div>
      )}
      <div className="today-bar">
        <p className="muted">
          {t("today.summary", {
            overdue: data.overdue.length,
            today: data.today.length,
            upcoming: data.upcoming.length,
          })}
        </p>
        <div className="filters" role="group" aria-label={t("activity.type")}>
          {chipTypes.map((k) => (
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
                      onComplete={() =>
                        contact.openDialog({
                          leadId: x.lead.id,
                          leadName: x.lead.fullName,
                          type: x.activity.type,
                          activityId: x.activity.id,
                        })
                      }
                      lastLabel={
                        x.lead.lastOutcome
                          ? t("today.last", { outcome: t(`activity.outcome.${x.lead.lastOutcome}`) })
                          : undefined
                      }
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
      {contact.dialog}
    </>
  );
}
