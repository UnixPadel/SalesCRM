import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../components/ui";
import { useLang } from "../i18n";
import type { NotificationDto, NotificationsDto } from "../modules/sales-pipeline/api/dto";
import { navigate } from "../router";
import { useCrm } from "../state/CrmContext";
import { pipelineApi } from "./api";
import { useSince, useTeamNames } from "./hooks";
import { disablePush, enablePush, onPushOpen, syncPush, type PushState } from "./push";

const POLL_MS = 30_000;

/**
 * Başlıktaki zil: okunmamış sayısı, son 30 bildirim; tıklanınca lead açılır ve okundu olur. Altındaki satır bu
 * tarayıcıda anlık bildirimi (Web Push) açıp kapatır; sunucuda kapalıysa ya da tarayıcı desteklemiyorsa görünmez.
 */
export function NotificationsBell() {
  const { t, lang } = useLang();
  const { toast } = useCrm();
  const since = useSince();
  const { nameOf } = useTeamNames();
  const [data, setData] = useState<NotificationsDto>({ items: [], unreadCount: 0 });
  const [push, setPush] = useState<PushState>("unsupported");
  const [pushBusy, setPushBusy] = useState(false);
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    let live = true;
    syncPush(lang)
      .then((s) => live && setPush(s))
      .catch(() => {
        /* durum okunamadıysa satır görünmez; zil çalışmaya devam eder */
      });
    return () => {
      live = false;
    };
  }, [lang]);

  // Tarayıcı bildirimine tıklandı ve program zaten açık: o sekmede lead'e gidilir.
  useEffect(
    () =>
      onPushOpen((hash) => {
        window.location.hash = hash;
      }),
    [],
  );

  const togglePush = async () => {
    setPushBusy(true);
    try {
      const next = push === "on" ? await disablePush() : await enablePush(lang);
      setPush(next);
      if (next === "on") toast(t("notif.push.enabled"));
    } catch {
      toast(t("notif.push.failed"), { bad: true });
    } finally {
      setPushBusy(false);
    }
  };

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

  /** Sözlükte karşılığı olmayan tür (eski istemci, yeni sunucu) sunucunun düz başlığıyla görünür. */
  const label = (n: NotificationDto) => {
    const key = `notif.${n.type}`;
    const out = t(key, { name: String(n.body["leadName"] ?? ""), hours: String(n.body["hours"] ?? "") });
    return out === key ? n.title : out;
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
                        n.body["subject"] ? String(n.body["subject"]) : null,
                        n.body["ownerId"] ? t("notif.owner", { name: nameOf(String(n.body["ownerId"])) }) : null,
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
        {(push === "on" || push === "off" || push === "denied") && (
          <div className="notif-push">
            {push === "denied" ? (
              <span>{t("notif.push.denied")}</span>
            ) : (
              <>
                <span>{t(push === "on" ? "notif.push.on" : "notif.push.off")}</span>
                <button className="btn btn-ghost" type="button" onClick={() => void togglePush()} disabled={pushBusy}>
                  {t(push === "on" ? "notif.push.disable" : "notif.push.enable")}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </details>
  );
}
