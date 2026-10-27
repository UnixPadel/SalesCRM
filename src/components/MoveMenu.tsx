import { useEffect, useRef } from "react";
import { STAGES } from "../domain/constants";
import type { StageKey } from "../domain/types";

/** "Taşı" menu shared by the column board and the line map: lists every column, current one disabled. */
export function MoveMenu({ current, onPick, onClose }: { current: StageKey; onPick: (s: StageKey) => void; onClose: () => void }) {
  const ref = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const items = () => [...(ref.current?.querySelectorAll<HTMLButtonElement>("button:not([aria-current])") ?? [])];
    items()[0]?.focus();
    const away = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [onClose]);

  const onKey = (e: React.KeyboardEvent) => {
    const list = [...(ref.current?.querySelectorAll<HTMLButtonElement>("button:not([aria-current])") ?? [])];
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "ArrowDown") list[(i + 1) % list.length]?.focus();
    else if (e.key === "ArrowUp") list[(i - 1 + list.length) % list.length]?.focus();
    else if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
      (ref.current?.parentElement as HTMLElement | null)?.focus();
    } else return;
    e.preventDefault();
  };

  return (
    <ul className="menu" role="menu" ref={ref} onKeyDown={onKey} aria-label="Kolona taşı">
      <li role="presentation" className="menu-h">
        Taşı
      </li>
      {STAGES.map((s) => (
        <li key={s.key} role="presentation">
          <button
            role="menuitem"
            aria-current={s.key === current || undefined}
            disabled={s.key === current}
            onClick={() => onPick(s.key)}
          >
            <span className="dot" style={{ background: `var(--col-${s.tone})` }} aria-hidden="true" />
            {s.no}. {s.label}
            {s.key === current && " (şu an)"}
          </button>
        </li>
      ))}
    </ul>
  );
}
