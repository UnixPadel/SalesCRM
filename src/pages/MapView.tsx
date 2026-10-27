import { useEffect, useRef, useState } from "react";
import { MoveMenu } from "../components/MoveMenu";
import { Avatar, Empty, eur, hueOf, Icon, IconButton, money } from "../components/ui";
import { STAGE, STAGES, countryName, flagOf } from "../domain/constants";
import { daysSince, isOpenDeal, isRotting, isWon, stageStats, toEUR } from "../domain/rules";
import type { Activity, Deal, StageKey } from "../domain/types";
import { assignDeal } from "../services/crmService";
import { useCrm } from "../state/CrmContext";
import { dealStatus } from "./dealStatus";
import { JourneyView } from "./JourneyView";

const ORDER = STAGES.map((s) => s.key);
const OPEN = STAGES.filter((s) => s.open);
const RED = STAGE.lost;
/** A keyboard move remounts the bead in another cell; this hands focus back to it. */
let refocusId: string | null = null;

/**
 * Line map: every sales rep is a line, the four open columns are its stations, customers are
 * beads parked at the station they are in. The red line is the terminal every line can branch
 * into. Rows = reps (plus the shared pool), columns = stations, so it is a real <table>.
 */
export function MapView({
  deals,
  ownerFilter,
  filtered,
  move,
}: {
  deals: Deal[];
  ownerFilter: string;
  filtered: boolean;
  move: (dealId: string, to: StageKey, opts?: { owner?: string }) => void;
}) {
  const { data, me, isAdmin, canEdit, owners, view, orgById, contactById, countryOfDeal, openDeal, run, toast } = useCrm();
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null); // `${owner}|${stage}`
  const stats = stageStats(deals);

  // Lanes: me first, then the rest of the team, the shared pool last. Reps outside the team
  // (old owner names) only get a lane while they still have customers.
  const owned = new Set(deals.map((d) => d.owner));
  let lanes: string[];
  if (view === "mine") lanes = [me];
  else if (view === "pool") lanes = [""];
  else if (ownerFilter) lanes = [ownerFilter];
  else {
    const names = [...new Set([me, ...owners, ...owned])].filter((n) => n && (owners.includes(n) || owned.has(n)));
    lanes = [...names, ""];
  }

  const canDropInLane = (deal: Deal, owner: string) =>
    owner === deal.owner || isAdmin || owner === me || owner === "";

  const reassign = (deal: Deal, owner: string) =>
    run((repo) => assignDeal(repo, deal.id, owner), () => ({
      msg: owner ? `${deal.title} → sorumlu: ${owner === me ? "siz" : owner}` : `${deal.title} ortak havuza bırakıldı`,
      action: { label: "Geri al", run: () => run((repo) => assignDeal(repo, deal.id, deal.owner), "Sorumlu geri alındı") },
    }));

  const drop = async (dealId: string, owner: string, stage: StageKey) => {
    const deal = deals.find((d) => d.id === dealId);
    if (!deal) return;
    const handover = owner !== deal.owner;
    if (handover && !canDropInLane(deal, owner)) {
      toast("Başka bir satışçının hattına yalnız yönetici taşıyabilir.", { bad: true });
      return;
    }
    if (stage === deal.stage) {
      if (handover) await reassign(deal, owner);
      return;
    }
    // Station (and maybe lane) change: one step, one toast, one undo.
    move(deal.id, stage, handover ? { owner } : undefined);
  };

  const cellProps = (owner: string, stage: StageKey) => {
    const key = `${owner}|${stage}`;
    return {
      onDragOver: (e: React.DragEvent) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (over !== key) setOver(key);
      },
      onDragLeave: (e: React.DragEvent) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver((o) => (o === key ? null : o));
      },
      onDrop: (e: React.DragEvent) => {
        e.preventDefault();
        if (dragId) drop(dragId, owner, stage);
        setDragId(null);
        setOver(null);
      },
    };
  };

  // One line only (my customers, the pool, or one rep): the personal journey reads better than a grid.
  if (lanes.length === 1) return <JourneyView deals={deals} owner={lanes[0]} filtered={filtered} move={move} />;

  if (!deals.length) {
    return (
      <Empty title={filtered ? "Filtreye uyan müşteri yok" : view === "pool" ? "Havuzda müşteri yok" : "Henüz müşteri yok"}>
        {filtered ? "Filtreleri temizleyin ya da başka bir görünüm seçin." : "Sağ üstteki “Müşteri” düğmesiyle ilk müşteriyi ekleyin."}
      </Empty>
    );
  }

  return (
    <div className="mapwrap">
      <table className="map">
        <caption className="sr-only">
          Hat haritası: satırlar satışçı hatları, sütunlar duraklar (kolonlar). Her hücrede o duraktaki müşteriler listelenir.
        </caption>
        <thead>
          <tr>
            <th scope="col" className="map-corner">
              <span className="sr-only">Hat</span>
            </th>
            {OPEN.map((s) => (
              <th scope="col" key={s.key} data-tone={s.tone}>
                <div className="station">
                  <span className="no" aria-hidden="true">
                    {s.no}
                  </span>
                  <h2>{s.label}</h2>
                  <span className="count" aria-label={`${stats[s.key].count} müşteri`}>
                    {stats[s.key].count}
                  </span>
                  <span className="hint">{s.hint}</span>
                  <span className="sum">
                    {stats[s.key].totalEUR > 0 && <b>{eur(stats[s.key].totalEUR, true)}</b>}
                    {stats[s.key].count > 0 && <span> · ort. {stats[s.key].avgDays} gün</span>}
                  </span>
                </div>
              </th>
            ))}
            <th scope="col" data-tone={RED.tone} className="map-red">
              <div className="station">
                <span className="no" aria-hidden="true">
                  <Icon name="ban" size={16} />
                </span>
                <h2>{RED.label}</h2>
                <span className="count" aria-label={`${stats.lost.count} müşteri`}>
                  {stats.lost.count}
                </span>
                <span className="hint">{RED.hint}</span>
              </div>
            </th>
          </tr>
        </thead>
        <tbody>
          {lanes.map((owner) => {
            const laneDeals = deals.filter((d) => d.owner === owner);
            const open = laneDeals.filter(isOpenDeal);
            const laneTotal = open.reduce((s, d) => s + toEUR(d), 0);
            const label = owner ? owner : "Ortak havuz";
            return (
              <tr
                key={owner || "__pool"}
                className={"lane" + (owner ? "" : " is-pool")}
                style={owner ? ({ "--lane-h": hueOf(owner) } as React.CSSProperties) : undefined}
              >
                <th scope="row">
                  <div className="lane-h">
                    {owner ? <Avatar name={owner} size={36} label={false} /> : <span className="pool-ic" aria-hidden="true"><Icon name="users" size={18} /></span>}
                    <div>
                      <b>
                        {label}
                        {owner && owner === me && <span className="muted"> (siz)</span>}
                      </b>
                      <small>
                        {laneDeals.length} müşteri{laneTotal > 0 && ` · ${eur(laneTotal, true)}`}
                        {!owner && !laneDeals.length && "sahipsiz kartlar burada"}
                      </small>
                    </div>
                  </div>
                </th>
                {ORDER.map((stage) => {
                  const here = laneDeals
                    .filter((d) => d.stage === stage)
                    .sort((a, b) => a.stage_entered_at.localeCompare(b.stage_entered_at));
                  const key = `${owner}|${stage}`;
                  const isRed = stage === "lost";
                  return (
                    <td
                      key={stage}
                      className={"cell" + (isRed ? " cell-red" : "") + (over === key ? " is-over" : "")}
                      {...cellProps(owner, stage)}
                    >
                      <span className={"node" + (here.length ? " is-filled" : "")} aria-hidden="true">
                        {isRed && <Icon name="x" size={10} />}
                      </span>
                      {here.length > 0 && (
                        <ul className="beads">
                          {here.map((d) => (
                            <li key={d.id}>
                              <Bead
                                deal={d}
                                country={countryOfDeal(d)}
                                org={d.organization_id ? orgById.get(d.organization_id)?.name : undefined}
                                person={d.contact_id ? contactById.get(d.contact_id)?.name : undefined}
                                activities={data.activities}
                                editable={canEdit(d.owner)}
                                dragging={dragId === d.id}
                                onOpen={() => openDeal(d.id)}
                                onMove={(to) => move(d.id, to)}
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
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      <ul className="legend" aria-label="İşaretler">
        <li>
          <span className="node is-filled lg" aria-hidden="true" /> Dolu durak: müşteri var
        </li>
        <li>
          <Icon name="flame" size={14} className="t-bad" /> Takipsiz: planlı adım yok
        </li>
        <li>
          <Icon name="alarm" size={14} className="t-bad" /> Gecikmiş adım
        </li>
        <li>
          <Icon name="clock" size={14} className="t-ok" /> Bugün yapılacak
        </li>
        <li>
          <Icon name="trophy" size={14} className="t-ok" /> Satıldı
        </li>
        <li>
          <Icon name="move" size={14} /> Sürükle ya da Alt + ←/→: başka durağa; başka hatta bırak: sorumlu değişir
        </li>
      </ul>
    </div>
  );
}

function Bead({
  deal,
  country,
  org,
  person,
  activities,
  editable,
  dragging,
  onOpen,
  onMove,
  onDragStart,
  onDragEnd,
}: {
  deal: Deal;
  country: string;
  org?: string;
  person?: string;
  activities: Activity[];
  editable: boolean;
  dragging: boolean;
  onOpen: () => void;
  onMove: (to: StageKey) => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const self = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (refocusId === deal.id) {
      refocusId = null;
      self.current?.focus();
    }
  });
  const rotting = isRotting(deal, activities);
  const won = isWon(deal);
  const lost = deal.stage === "lost";
  const status = dealStatus(deal, activities);
  const idx = ORDER.indexOf(deal.stage);
  const facts = [
    deal.court_count > 0 ? `${deal.court_count} kort` : null,
    deal.value > 0 ? money(deal.value, deal.currency, true) : null,
    `${daysSince(deal.stage_entered_at)} gün`,
  ]
    .filter(Boolean)
    .join(" · ");
  const where = [org && org !== deal.title ? org : null, person, country ? `${flagOf(country)} ${countryName(country)}` : null]
    .filter(Boolean)
    .join(" · ");
  const detail = lost ? deal.lost_reason || "Neden belirtilmemiş" : status?.text;
  const title = [deal.title, where, facts, detail].filter(Boolean).join("\n");

  const onKey = (e: React.KeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onOpen();
    }
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
    <div
      ref={self}
      role="button"
      tabIndex={0}
      className={
        "bead" +
        (rotting ? " is-rotting" : "") +
        (won ? " is-won" : "") +
        (lost ? " is-lost" : "") +
        (!deal.owner ? " is-pool" : "") +
        (dragging ? " is-dragging" : "")
      }
      draggable={editable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={(e) => !(e.target as HTMLElement).closest(".bead-move, .menu") && onOpen()}
      onKeyDown={onKey}
      title={title}
      aria-label={`${deal.title}, ${STAGE[deal.stage].no}. ${STAGE[deal.stage].label}${detail ? ", " + detail : ""}`}
      aria-describedby="card-help"
    >
      <span className={"bead-ic " + (lost ? "t-red" : status ? "t-" + status.tone : "t-neutral")} aria-hidden="true">
        <Icon name={lost ? "ban" : status?.icon ?? "user"} size={14} />
      </span>
      <span className="bead-main">
        <span className="bead-name">{deal.title}</span>
        <span className="bead-sub">{lost ? deal.lost_reason || "Neden belirtilmemiş" : facts}</span>
      </span>
      {editable && (
        <IconButton
          icon="move"
          label="Durağa taşı"
          size="sm"
          className="bead-move"
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
    </div>
  );
}
