import { useState } from "react";
import { ActivityRow, requestCompose } from "../components/DealPanel";
import { Avatar, Button, Empty, Icon } from "../components/ui";
import { ACTIVITY_TYPES } from "../domain/constants";
import { activityBucket, isOpenDeal } from "../domain/rules";
import type { Activity, ActivityType } from "../domain/types";
import { setActivityDone } from "../services/crmService";
import { useCrm } from "../state/CrmContext";

const GROUPS = [
  { key: "overdue", label: "Gecikmiş", empty: "Gecikmiş aktivite yok, harika." },
  { key: "today", label: "Bugün", empty: "Bugün için planlı aktivite yok." },
  { key: "planned", label: "Yaklaşan", empty: "Yaklaşan aktivite yok." },
] as const;
type GroupKey = (typeof GROUPS)[number]["key"];

export function ActivitiesPage() {
  const { data, orgById, me, run, openDeal } = useCrm();
  const [all, setAll] = useState(false);
  const [types, setTypes] = useState<Partial<Record<ActivityType, boolean>>>({});
  const [showDone, setShowDone] = useState(false);
  const [needsNext, setNeedsNext] = useState<string[]>([]);
  const dealById = new Map(data.deals.map((d) => [d.id, d]));
  const typeOn = Object.values(types).some(Boolean);

  const list = data.activities
    .filter((a) => {
      const d = dealById.get(a.deal_id);
      return d && (all || d.owner === me) && (!typeOn || types[a.type]);
    })
    .sort((a, b) => a.due_at.localeCompare(b.due_at));
  const grouped: Record<GroupKey, Activity[]> = { overdue: [], today: [], planned: [] };
  list.filter((a) => !a.done).forEach((a) => grouped[activityBucket(a)].push(a));
  const done = list.filter((a) => a.done).sort((a, b) => (b.done_at || "").localeCompare(a.done_at || "")).slice(0, 30);

  const toggle = async (a: Activity) => {
    const deal = dealById.get(a.deal_id);
    const lastOpen =
      !a.done && deal && isOpenDeal(deal) && data.activities.filter((x) => x.deal_id === a.deal_id && !x.done).length === 1;
    await run((repo) => setActivityDone(repo, a.id, !a.done), a.done ? "Aktivite yeniden açıldı" : "Aktivite tamamlandı");
    if (lastOpen) setNeedsNext((n) => (n.includes(a.deal_id) ? n : [...n, a.deal_id]));
  };
  const planNext = (dealId: string) => {
    setNeedsNext((n) => n.filter((x) => x !== dealId));
    requestCompose(dealId);
    openDeal(dealId);
  };

  const row = (a: Activity) => {
    const d = dealById.get(a.deal_id)!;
    const org = d.organization_id ? orgById.get(d.organization_id)?.name : "";
    return (
      <ActivityRow
        key={a.id}
        a={a}
        onToggle={() => toggle(a)}
        extra={
          <button className="dealref" onClick={() => openDeal(d.id)}>
            <Icon name="pipeline" size={14} /> {d.title}
            {org && <span className="muted"> · {org}</span>}
            {all && d.owner && <Avatar name={d.owner} size={20} />}
          </button>
        }
      />
    );
  };

  return (
    <div className="activities">
      <div className="toolbar">
        <div className="metrics">
          <div className="metric">
            <span>{all ? "Tüm ekip" : `${me} için bugün`}</span>
            <b>
              {grouped.overdue.length} gecikmiş · {grouped.today.length} bugün
            </b>
          </div>
        </div>
        <div className="filters">
          <label className="check">
            <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Tüm ekibin adımlarını göster
          </label>
          <div className="filters" role="group" aria-label="Aktivite tipi">
            {ACTIVITY_TYPES.map((t) => (
              <button key={t.key} className="chip" aria-pressed={!!types[t.key]} onClick={() => setTypes({ ...types, [t.key]: !types[t.key] })}>
                <Icon name={t.icon} size={14} /> {t.label}
              </button>
            ))}
          </div>
          <label className="check">
            <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Tamamlananları göster
          </label>
        </div>
      </div>

      <div className="agroups">
        {needsNext.map((id) => {
          const d = dealById.get(id);
          if (!d || data.activities.some((a) => a.deal_id === id && !a.done)) return null;
          return (
            <div key={id} className="nextprompt" role="status">
              <Icon name="flame" />
              <span>
                <b>{d.title}</b> için planlı adım kalmadı; planlanmazsa müşteri takipsiz kalır.
              </span>
              <Button size="sm" variant="pri" onClick={() => planNext(id)}>
                Sıradaki adımı planla
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setNeedsNext((n) => n.filter((x) => x !== id))}>
                Şimdi değil
              </Button>
            </div>
          );
        })}

        {GROUPS.map((g) => (
          <section key={g.key} className={"agroup " + g.key} aria-labelledby={`ag-${g.key}`}>
            <h2 id={`ag-${g.key}`}>
              {g.label} <span className="count">{grouped[g.key].length}</span>
            </h2>
            {grouped[g.key].length ? (
              <div className="alist">{grouped[g.key].map(row)}</div>
            ) : g.key === "overdue" ? (
              <Empty title={g.empty} tone="ok" />
            ) : (
              <p className="tl-empty">{g.empty}</p>
            )}
          </section>
        ))}
        {showDone && (
          <section className="agroup" aria-labelledby="ag-done">
            <h2 id="ag-done">
              Son tamamlananlar <span className="count">{done.length}</span>
            </h2>
            {done.length ? <div className="alist">{done.map(row)}</div> : <p className="tl-empty">Tamamlanan aktivite yok.</p>}
          </section>
        )}
      </div>
    </div>
  );
}
