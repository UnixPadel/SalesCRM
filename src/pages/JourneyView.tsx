import { useEffect, useRef, useState } from "react";
import { MoveMenu } from "../components/MoveMenu";
import { Stations } from "../components/Stations";
import { Button, Empty, Icon, IconButton, money, StatusTag } from "../components/ui";
import { STAGE, STAGES, countryName, flagOf } from "../domain/constants";
import { daysSince, isOpenDeal, isRotting, isWon, stageStats } from "../domain/rules";
import type { Deal, StageKey } from "../domain/types";
import { assignDeal, setWon } from "../services/crmService";
import { useCrm } from "../state/CrmContext";
import { dealStatus } from "./dealStatus";

const ORDER = STAGES.map((s) => s.key);
/** A keyboard move remounts the card in another station; this hands focus back to it. */
let refocusId: string | null = null;

/**
 * Personal journey: one line, five stations across the top (with counts and "what moves a
 * customer on"), and under each station the customers parked there. Every card says in plain
 * words what to do now and has a one-click "next station" button.
 */
export function JourneyView({
  deals,
  owner,
  filtered,
  move,
}: {
  deals: Deal[];
  owner: string;
  filtered: boolean;
  move: (dealId: string, to: StageKey) => void;
}) {
  const { data, me, canEdit, orgById, contactById, countryOfDeal, openDeal, run } = useCrm();
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<StageKey | null>(null);
  const stats = stageStats(deals);
  const open = deals.filter(isOpenDeal);
  const rotting = open.filter((d) => isRotting(d, data.activities)).length;
  const title = owner === me ? "Müşterilerim" : owner ? `${owner} — müşterileri` : "Ortak havuz";

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

  if (!deals.length) {
    return (
      <Empty title={filtered ? "Filtreye uyan müşteri yok" : owner ? "Henüz müşteriniz yok" : "Havuzda müşteri yok"}>
        {filtered
          ? "Filtreleri temizleyin."
          : owner
            ? "Formlar sayfasından bir formu panoya alın ya da sağ üstteki “Müşteri” düğmesiyle ekleyin."
            : "Sahipsiz kartlar burada görünür; satışçılar “Üstlen” ile alır."}
      </Empty>
    );
  }

  return (
    <div className="journey">
      <section className="journey-head" aria-label="Yolculuk özeti">
        <div className="journey-title">
          <h2>{title}</h2>
          <span>
            <b>{open.length}</b> açık müşteri
            {rotting > 0 && (
              <>
                {" · "}
                <b className="t-bad">{rotting}</b> takipsiz
              </>
            )}
          </span>
        </div>
        <Stations counts={stats} showNext />
      </section>

      <div className="jcols">
        {STAGES.map((s) => {
          const here = deals
            .filter((d) => d.stage === s.key)
            .sort((a, b) => (s.open ? a.stage_entered_at.localeCompare(b.stage_entered_at) : b.stage_entered_at.localeCompare(a.stage_entered_at)));
          return (
            <section
              key={s.key}
              className={"jcol" + (over === s.key ? " is-over" : "")}
              data-tone={s.tone}
              aria-label={`${s.no}. ${s.label}: ${here.length} müşteri`}
              {...dropProps(s.key)}
            >
              {here.map((d) => (
                <JourneyCard
                  key={d.id}
                  deal={d}
                  sub={[
                    d.organization_id && orgById.get(d.organization_id)?.name !== d.title ? orgById.get(d.organization_id)?.name : null,
                    d.contact_id ? contactById.get(d.contact_id)?.name : null,
                    countryOfDeal(d) ? `${flagOf(countryOfDeal(d))} ${countryName(countryOfDeal(d))}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  editable={canEdit(d.owner)}
                  dragging={dragId === d.id}
                  onOpen={() => openDeal(d.id)}
                  onMove={(to) => move(d.id, to)}
                  onWon={() => run((repo) => setWon(repo, d.id, true), `Tebrikler, ${d.title} satıldı`)}
                  onTake={() =>
                    run((repo) => assignDeal(repo, d.id, me), () => ({
                      msg: `${d.title} artık sizin müşteriniz`,
                      action: { label: "Geri al", run: () => run((repo) => assignDeal(repo, d.id, ""), "Havuza geri bırakıldı") },
                    }))
                  }
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
              {!here.length && <p className="jcol-empty">{s.open ? "Bu durakta kimse yok" : "Kırmızı hatta kimse yok"}</p>}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function JourneyCard({
  deal,
  sub,
  editable,
  dragging,
  onOpen,
  onMove,
  onWon,
  onTake,
  onDragStart,
  onDragEnd,
}: {
  deal: Deal;
  sub: string;
  editable: boolean;
  dragging: boolean;
  onOpen: () => void;
  onMove: (to: StageKey) => void;
  onWon: () => void;
  onTake: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
}) {
  const { data } = useCrm();
  const [menu, setMenu] = useState(false);
  const self = useRef<HTMLElement>(null);
  useEffect(() => {
    if (refocusId === deal.id) {
      refocusId = null;
      self.current?.focus();
    }
  });
  const rotting = isRotting(deal, data.activities);
  const won = isWon(deal);
  const lost = deal.stage === "lost";
  const status = dealStatus(deal, data.activities);
  const idx = ORDER.indexOf(deal.stage);
  const next = !lost && idx < 3 ? STAGE[ORDER[idx + 1]] : null;

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
  const go = (to: StageKey) => {
    refocusId = deal.id;
    onMove(to);
  };

  return (
    <article
      ref={self}
      className={
        "jcard" + (rotting ? " is-rotting" : "") + (won ? " is-won" : "") + (lost ? " is-lost" : "") + (!deal.owner ? " is-pool" : "") + (dragging ? " is-dragging" : "")
      }
      draggable={editable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={(e) => !(e.target as HTMLElement).closest("button, .menu, a") && onOpen()}
      onKeyDown={onKey}
      tabIndex={0}
      aria-label={`${deal.title}, ${STAGE[deal.stage].no}. ${STAGE[deal.stage].label}${status ? ", " + status.text : ""}. Açmak için Enter.`}
      aria-describedby="card-help"
    >
      <h3 className="jcard-name">{deal.title}</h3>
      {sub && <p className="jcard-sub">{sub}</p>}
      <p className="jcard-facts">
        {deal.court_count > 0 && (
          <span>
            <Icon name="court" size={14} /> {deal.court_count} kort
          </span>
        )}
        {deal.value > 0 && (
          <span>
            <Icon name="money" size={14} /> {money(deal.value, deal.currency, true)}
          </span>
        )}
        <span title="Bu durakta geçen süre">
          <Icon name="clock" size={14} /> {daysSince(deal.stage_entered_at)} gün
        </span>
      </p>
      {lost ? (
        <p className="jcard-now bad">
          <Icon name="ban" size={16} /> <span>{deal.lost_reason || "Neden belirtilmemiş"}</span>
        </p>
      ) : status ? (
        <p className={"jcard-now " + status.tone}>
          <Icon name={status.icon} size={16} /> <span>{status.text}</span>
        </p>
      ) : null}
      <div className="jcard-actions">
        {!deal.owner && isOpenDeal(deal) ? (
          <Button size="sm" variant="pri" icon="hand" onClick={onTake}>
            Üstlen
          </Button>
        ) : editable && !won && next ? (
          <Button size="sm" variant="sec" onClick={() => go(next.key)} title={`${next.no}. ${next.label} durağına taşı`}>
            <Icon name="arrow" size={14} /> {next.short}
          </Button>
        ) : editable && !won && !lost ? (
          <Button size="sm" variant="won" icon="trophy" onClick={onWon}>
            Satış tamamlandı
          </Button>
        ) : (
          <Button size="sm" variant="ghost" onClick={onOpen}>
            Aç
          </Button>
        )}
        {editable && (
          <IconButton
            icon="move"
            label="Başka durağa taşı"
            size="sm"
            aria-haspopup="menu"
            aria-expanded={menu}
            onClick={() => setMenu((m) => !m)}
          />
        )}
        {rotting && editable && !won && (
          <StatusTag tone="bad" icon="flame">
            adım planla
          </StatusTag>
        )}
      </div>
      {menu && (
        <MoveMenu
          current={deal.stage}
          onPick={(to) => {
            setMenu(false);
            go(to);
          }}
          onClose={() => setMenu(false)}
        />
      )}
    </article>
  );
}
