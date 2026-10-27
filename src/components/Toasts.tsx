import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useCrm } from "../state/CrmContext";
import { Icon } from "./ui";

/**
 * A modal <dialog> makes everything outside it inert and paints over it, so toasts (and their
 * "Undo" action) are portalled into the topmost open dialog, or <body> when none is open.
 */
function topHost(): HTMLElement {
  const open = document.querySelectorAll<HTMLDialogElement>("dialog[open]");
  return open.length ? open[open.length - 1] : document.body;
}

export function Toasts() {
  const { toasts, dismissToast } = useCrm();
  const [host, setHost] = useState<HTMLElement>(() => document.body);

  useEffect(() => {
    const sync = () => setHost((h) => {
      const next = topHost();
      return next === h ? h : next;
    });
    const mo = new MutationObserver(sync);
    mo.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["open"] });
    sync();
    return () => mo.disconnect();
  }, []);

  return createPortal(
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={"toast" + (t.bad ? " bad" : "")}>
          <span>{t.msg}</span>
          {t.action && (
            <button
              className="toast-action"
              onClick={() => {
                t.action!.run();
                dismissToast(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
          <button className="toast-x" aria-label="Bildirimi kapat" onClick={() => dismissToast(t.id)}>
            <Icon name="x" size={14} />
          </button>
        </div>
      ))}
    </div>,
    host,
  );
}
