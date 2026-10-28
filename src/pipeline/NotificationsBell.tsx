import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../components/ui";
import { useLang } from "../i18n";
import type { NotificationDto, NotificationsDto } from "../modules/sales-pipeline/api/dto";
import { navigate } from "../router";
import { pipelineApi } from "./api";
import { useSince } from "./hooks";

const POLL_MS = 30_000;

/** Başlıktaki zil: okunmamış sayısı, son 30 bildirim; tıklanınca lead açılır ve okundu olur. */
export function NotificationsBell() {
  const { t } = useLang();
  const since = useSince();
  const [data, setData] = useState<NotificationsDto>({ items: [], unreadCount: 0 });
  const ref = useRef<HTMLDetailsElement>(null);

  const reload = useCallback(() => {
    pipelineApi
      .notifications()
      .then(setData)
      .catch(() => {
        /* başlıkta hata göstermeyiz; bir sonraki yoklamada yeniden denenir */
      });
  }, []);

  useEffect(() => {
    reload();
    const id = setInterval(reload, POLL_MS);
    const onFocus = () => reload();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [reload]);

  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (ref.current?.open && !ref.current.contains(e.target as Node)) ref.current.open = false;
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape" && ref.current?.open) ref.current.open = false;
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, []);

  const open = (n: NotificationDto) => {
    if (ref.current) ref.current.open = false;
    if (!n.readAt) {
      setData((d) => ({
        unreadCount: Math.max(0, d.unreadCount - 1),
        items: d.items.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)),
      }));
      pipelineApi.markRead(n.id).catch(() => reload());
    }
    if (n.leadId) navigate("lead", undefined, n.leadId);
  };

  const markAll = () => {
    setData((d) => ({
      unreadCount: 0,
      items: d.items.map((x) => ({ ...x, readAt: x.readAt ?? new Date().toISOString() })),
    }));
    pipelineApi.markAllRead().catch(() => reload());
  };

  const label = (n: NotificationDto) => {
    const name = String(n.body["leadName"] ?? "");
    return n.type === "lead_assigned" ? t("notif.lead_assigned", { name }) : n.title;
  };

  return (
    <details className="notif" ref={ref} onToggle={(e) => e.currentTarget.open && reload()}>
      <summary aria-label={t("notif.open", { n: data.unreadCount })} title={t("notif.title")}>
        <Icon name="bell" size={18} />
        {data.unreadCount > 0 && (
          <b className="badge" aria-hidden="true">
            {data.unreadCount > 99 ? "99+" : data.unreadCount}
          </b>
        )}
      </summary>
      <div className="pop" role="region" aria-label={t("notif.title")}>
        <div className="notif-head">
          <span>{t("notif.title")}</span>
          {data.unreadCount > 0 && (
            <button className="btn btn-ghost" type="button" onClick={markAll}>
              <Icon name="check" size={14} /> {t("notif.markAll")}
            </button>
          )}
        </div>
        {data.items.length === 0 ? (
          <div className="notif-empty">{t("notif.empty")}</div>
        ) : (
          <ul className="notif-list">
            {data.items.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  className={"notif-item" + (n.readAt ? "" : " unread")}
                  onClick={() => open(n)}
                  aria-label={label(n)}
                >
                  <span className="dot" aria-hidden="true" />
                  <span>
                    <span className="t">{label(n)}</span>
                    <span className="m">
                      {[
                        n.body["company"] ? String(n.body["company"]) : null,
                        n.body["country"] ? String(n.body["country"]) : null,
                        n.body["isTest"] ? t("notif.test") : null,
                        since(n.createdAt),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}
