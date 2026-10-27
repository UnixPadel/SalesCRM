import { useEffect, useMemo, useRef, useState } from "react";
import { MoveMenu } from "../components/MoveMenu";
import { useStageMover } from "../components/useStageMover";
import { Avatar, eur, Icon, IconButton, money, StatusTag } from "../components/ui";
import { STAGE, STAGES, countryName, flagOf } from "../domain/constants";
import { activityBucket, daysSince, isOpenDeal, isRotting, isWon, stageStats, toEUR } from "../domain/rules";
import type { Activity, Deal, StageKey } from "../domain/types";
import { assignDeal } from "../services/crmService";
import { useCrm, type View } from "../state/CrmContext";
import { dealStatus } from "./dealStatus";
import { MapView } from "./MapView";

const FILTER_KEY = "unixcrm.v2.boardFilter";
type Filter = { country: string; rotting: boolean; owner: string };
function loadFilter(): Filter {
  try {
    return { country: "", rotting: false, owner: "", ...JSON.parse(localStorage.getItem(FILTER_KEY) || "{}") };
  } catch {
    return { country: "", rotting: false, owner: "" };
  }
}
const MODE_KEY = "unixcrm.v2.boardMode";
type Mode = "map" | "columns";
function loadMode(): Mode {
  try {
    return localStorage.getItem(MODE_KEY) === "columns" ? "columns" : "map";
  } catch {
    return "map";
  }
}
const ORDER = STAGES.map((s) => s.key);
/** A keyboard move remounts the card in another column; this hands focus back to it. */
let refocusId: string | null = null;

const VIEWS: { key: View; label: string; icon: string }[] = [
  { key: "mine", label: "Müşterilerim", icon: "user" },
  { key: "pool", label: "Ortak havuz", icon: "users" },
  { key: "all", label: "Tüm ekip", icon: "globe" },
];

export function PipelinePage() {
  const { data, me, isAdmin, canEdit, owners, view, setView, inView, orgById, contactById, countryOfDeal, openDeal, run } = useCrm();
  const { move, dialog } = useStageMover();
  const [f, setF] = useState<Filter>(loadFilter);
  const [mode, setModeState] = useState<Mode>(loadMode);
  const setMode = (m: Mode) => {
    setModeState(m);
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {
      /* per-viewer convenience */
    }
  };
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<StageKey | null>(null);

  const setFilter = (patch: Partial<Filter>) => {
    const next = { ...f, ...patch };
    setF(next);
    try {
      localStorage.setItem(FILTER_KEY, JSON.stringify(next));
    } catch {
      /* per-viewer convenience */
    }
  };

  const countries = useMemo(() => {
    const m = new Map<string, number>();
    data.deals.forEach((d) => m.set(countryOfDeal(d), (m.get(countryOfDeal(d)) || 0) + 1));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [data.deals, countryOfDeal]);

  const viewCounts = {
    mine: data.deals.filter((d) => d.owner === me).length,
    pool: data.deals.filter((d) => !d.owner).length,
    all: data.deals.length,
  };
  const ownerFilter = isAdmin && view === "all" ? f.owner : "";
  const deals = data.deals.filter(
    (d) =>
      inView(d.owner) &&
      (!ownerFilter || d.owner === ownerFilter) &&
      (!f.country || countryOfDeal(d) === f.country) &&
      (!f.rotting || isRotting(d, data.activities)),
  );
  const stats = stageStats(deals);
  const rotting = deals.filter((d) => isRotting(d, data.activities)).length;
  const ids = new Set(deals.map((d) => d.id));
  const overdue = data.activities.filter((a) => !a.done && ids.has(a.deal_id) && activityBucket(a) === "overdue").length;

  const take = (d: Deal) =>
    run((repo) => assignDeal(repo, d.id, me), () => ({
      msg: `${d.title} artık sizin müşteriniz`,
      action: { label: "Geri al", run: () => run((repo) => assignDeal(repo, d.id, ""), "Havuza geri bırakıldı") },
    }));

  const dropProps = (stage: StageKey) => ({
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (over !== stage) setOver(stage);
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver((o) => (o === stage ? null : o));
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      if (dragId) move(dragId, stage);
      setDragId(null);
      setOver(null);
    },
  });

  return (
    <div className="pipeline">
      <div className="boardbar">
        <div className="seg seg-lg" role="radiogroup" aria-label="Görünüm">
          <button role="radio" aria-checked={mode === "map"} onClick={() => setMode("map")} title="Hat haritası: satışçı hatları ve duraklar">
            <Icon name="route" size={16} /> Hat haritası
          </button>
          <button role="radio" aria-checked={mode === "columns"} onClick={() => setMode("columns")} title="Klasik kolonlu pano">
            <Icon name="columns" size={16} /> Kolonlar
          </button>
        </div>
        <div className="seg seg-lg" role="radiogroup" aria-label="Kimin müşterileri">
          {VIEWS.map((v) => (
            <button key={v.key} role="radio" aria-checked={view === v.key} onClick={() => setView(v.key)}>
              <Icon name={v.icon} size={16} /> {v.label} <span className="count">{viewCounts[v.key]}</span>
            </button>
          ))}
        </div>
        {isAdmin && view === "all" && (
          <select value={f.owner} onChange={(e) => setFilter({ owner: e.target.value })} aria-label="Satışçıya göre filtrele">
            <option value="">Tüm satışçılar</option>
            {owners.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        )}
        <select value={f.country} onChange={(e) => setFilter({ country: e.target.value })} aria-label="Ülkeye göre filtrele">
          <option value="">Tüm ülkeler</option>
          {countries.map(([c, n]) => (
            <option key={c} value={c}>
              {countryName(c)} ({n})
            </option>
          ))}
        </select>
        <button className="chip chip-bad" aria-pressed={f.rotting} onClick={() => setFilter({ rotting: !f.rotting })}>
          <Icon name="flame" size={14} /> Takipsiz olanlar
        </button>
        {(f.country || f.rotting || ownerFilter) && (
          <button className="btn btn-ghost btn-sm" onClick={() => setFilter({ country: "", rotting: false, owner: "" })}>
            Filtreleri temizle
          </button>
        )}
        <span className="spacer" />
        <span className="summary" aria-live="polite">
          <b>{deals.length}</b> müşteri · <b>{rotting}</b> takipsiz · <b>{overdue}</b> gecikmiş adım
        </span>
      </div>

      <p id="card-help" className="sr-only">
        Açmak için Enter. Alt + sağ/sol ok ile sonraki ya da önceki durağa (kolona) taşıyın, ya da Taşı menüsünü kullanın.
      </p>

      {mode === "map" ? (
        <MapView deals={deals} ownerFilter={ownerFilter} filtered={!!(f.country || f.rotting || ownerFilter)} move={move} />
      ) : (
      <div className="board">
        {STAGES.map((s) => {
          const st = stats[s.key];
          const cards = deals
            .filter((d) => d.stage === s.key)
            .sort((a, b) =>
              s.open ? a.stage_entered_at.localeCompare(b.stage_entered_at) : b.stage_entered_at.localeCompare(a.stage_entered_at),
            );
          const headId = `col-${s.key}`;
          return (
            <section
              key={s.key}
              aria-labelledby={headId}
              className={"col" + (over === s.key ? " is-over" : "")}
              data-tone={s.tone}
              {...dropProps(s.key)}
            >
              <header className="col-head">
                <span className="col-no" aria-hidden="true">
                  {s.no}
                </span>
                <h2 id={headId}>{s.label}</h2>
                <span className="col-count" aria-label={`${st.count} müşteri`}>
                  {st.count}
                </span>
                <span className="col-hint">{s.hint}</span>
              </header>
              <div className="col-sum">
                {st.totalEUR > 0 && (
                  <span>
                    <b>{eur(st.totalEUR, true)}</b> toplam
                  </span>
                )}
                {st.count > 0 && <span title="Bu kolondaki müşterilerin ortalama bekleme süresi">ort. {st.avgDays} gün</span>}
              </div>
              <div className="col-body">
                {cards.map((d) => (
                  <DealCard
                    key={d.id}
                    deal={d}
                    org={d.organization_id ? orgById.get(d.organization_id)?.name : undefined}
                    person={d.contact_id ? contactById.get(d.contact_id)?.name : undefined}
                    country={countryOfDeal(d)}
                    activities={data.activities}
                    dragging={dragId === d.id}
                    editable={canEdit(d.owner)}
                    onOpen={() => openDeal(d.id)}
                    onMove={(to) => move(d.id, to)}
                    onTake={() => take(d)}
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/plain", d.id);
                      e.dataTransfer.effectAllowed = "move";
                      setDragId(d.id);
                    }}
                    onDragEnd={() => {
                      setDragId(null);
                      setOver(null);
                    }}
                  />
                ))}
                {!cards.length && (
                  <div className="col-empty">
                    {f.country || f.rotting || ownerFilter ? "Filtreye uyan müşteri yok" : view === "pool" ? "Havuzda müşteri yok" : "Bu kolon boş"}
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </div>
      )}
      {dialog}
    </div>
  );
}

function DealCard({
  deal,
  org,
  person,
  country,
  activities,
  dragging,
  editable,
  onOpen,
  onMove,
  onTake,
  onDragStart,
  onDragEnd,
}: {
  deal: Deal;
  org?: string;
  person?: string;
  country: string;
  activities: Activity[];
  dragging: boolean;
  editable: boolean;
  onOpen: () => void;
  onMove: (to: StageKey) => void;
  onTake: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const self = useRef<HTMLElement>(null);
  useEffect(() => {
    if (refocusId === deal.id) {
      refocusId = null;
      self.current?.focus();
    }
  });
  const rotting = isRotting(deal, activities);
  const status = dealStatus(deal, activities);
  const idx = ORDER.indexOf(deal.stage);
  const sub = [org && org !== deal.title ? org : null, person, country ? `${flagOf(country)} ${countryName(country)}` : null]
    .filter(Boolean)
    .join(" · ");

  const onKey = (e: React.KeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter") onOpen();
    if (editable && e.altKey && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
      e.preventDefault();
      const to = ORDER[idx + (e.key === "ArrowRight" ? 1 : -1)];
      if (to) {
        refocusId = deal.id;
        onMove(to);
      }
    }
  };

  return (
    <article
      ref={self}
      className={
        "card" +
        (rotting ? " is-rotting" : "") +
        (isWon(deal) ? " is-won" : "") +
        (!deal.owner ? " is-pool" : "") +
        (dragging ? " is-dragging" : "")
      }
      draggable={editable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={(e) => !(e.target as HTMLElement).closest(".card-move, .menu, .card-take") && onOpen()}
      onKeyDown={onKey}
      tabIndex={0}
      aria-label={`${deal.title}, ${STAGE[deal.stage].no}. ${STAGE[deal.stage].label}${deal.owner ? ", " + deal.owner : ", ortak havuz"}${
        status ? ", " + status.text : ""
      }`}
      aria-describedby="card-help"
    >
      <h3 className="card-name">{deal.title}</h3>
      {sub && <div className="card-sub">{sub}</div>}
      <div className="card-facts">
        {deal.court_count > 0 && (
          <span>
            <Icon name="court" size={14} /> <b>{deal.court_count}</b> kort
          </span>
        )}
        {deal.value > 0 && (
          <span>
            <b>{money(deal.value, deal.currency, true)}</b>
          </span>
        )}
        <span title="Bu kolonda geçen gün">
          <Icon name="clock" size={14} /> {daysSince(deal.stage_entered_at)} gün
        </span>
      </div>
      {deal.stage === "lost" && (
        <div className="card-reason">
          <Icon name="ban" size={14} /> <span>{deal.lost_reason || "Neden belirtilmemiş"}</span>
        </div>
      )}
      <div className="card-foot">
        {status && (
          <StatusTag tone={status.tone} icon={status.icon} title={status.text}>
            {status.text}
          </StatusTag>
        )}
        {deal.owner ? (
          <Avatar name={deal.owner} size={24} />
        ) : isOpenDeal(deal) ? (
          <button className="card-take" onClick={onTake} title="Bu müşteriyi havuzdan kendinize alın">
            <Icon name="hand" size={14} /> Üstlen
          </button>
        ) : (
          <span className="tag tag-neutral">Havuz</span>
        )}
      </div>
      {editable && (
        <IconButton
          icon="move"
          label="Kolona taşı"
          size="sm"
          className="card-move"
          aria-haspopup="menu"
          aria-expanded={menu}
          onClick={() => setMenu((m) => !m)}
        />
      )}
      {menu && (
        <MoveMenu
          current={deal.stage}
          onPick={(to) => {
            setMenu(false);
            refocusId = deal.id;
            onMove(to);
          }}
          onClose={() => setMenu(false)}
        />
      )}
    </article>
  );
}

export const totalEUR = (deals: Deal[]) => deals.reduce((s, d) => s + toEUR(d), 0);
