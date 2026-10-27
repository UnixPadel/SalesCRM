import { STAGES } from "../domain/constants";
import type { StageKey } from "../domain/types";
import type { StageStats } from "../domain/rules";
import { eur, Icon } from "./ui";

const ORDER = STAGES.map((s) => s.key);

/**
 * The sales journey drawn as one line with five stations: 1–4 open columns, then the red-line
 * terminal. Used as the header of the personal journey view (with counts) and in the customer
 * drawer (with the current station highlighted, stations clickable to move).
 */
export function Stations({
  current,
  counts,
  onPick,
  showNext,
}: {
  current?: StageKey;
  counts?: Record<StageKey, StageStats>;
  onPick?: (s: StageKey) => void;
  showNext?: boolean;
}) {
  const curIdx = current ? ORDER.indexOf(current) : -1;
  return (
    <ol className="stations" aria-label="Duraklar">
      {STAGES.map((s, i) => {
        const isCur = s.key === current;
        const past = curIdx >= 0 && current !== "lost" && i < curIdx;
        const c = counts?.[s.key];
        const inner = (
          <>
            <span className="st-node" aria-hidden="true">
              {s.key === "lost" ? <Icon name="ban" size={16} /> : s.no}
            </span>
            <span className="st-label">
              {s.key !== "lost" && <span className="sr-only">{s.no}. </span>}
              {s.label}
            </span>
            <span className="st-hint">{s.hint}</span>
            {c && (
              <span className="st-count">
                <b>{c.count}</b> müşteri{c.totalEUR > 0 ? ` · ${eur(c.totalEUR, true)}` : ""}
              </span>
            )}
            {showNext && (
              <span className="st-next">
                <Icon name="arrow" size={12} /> {s.next}
              </span>
            )}
          </>
        );
        return (
          <li
            key={s.key}
            data-tone={s.tone}
            className={(past ? "is-past" : "") + (isCur ? " is-current" : "")}
            aria-current={isCur ? "step" : undefined}
          >
            {onPick ? (
              <button
                type="button"
                className="st-btn"
                disabled={isCur}
                onClick={() => onPick(s.key)}
                title={isCur ? "Şu anki durak" : `${s.no}. ${s.label} durağına taşı`}
              >
                {inner}
              </button>
            ) : (
              <div className="st-btn">{inner}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
