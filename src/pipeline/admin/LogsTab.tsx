import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Button, Empty, Skeleton, fmtDate } from "../../components/ui";
import { useLang } from "../../i18n";
import type { ActionLogDto, ActionLogPageDto, ActionTypeDto } from "../../modules/sales-pipeline/api/dto.actionLog";
import { useErrorText, useReference, useTeamNames } from "../hooks";
import { adminApi } from "./adminApi";
import { LoadError, SectionHead } from "./bits";

/**
 * Yönetim > Loglar (2026-11-20): hangi kullanıcı hangi lead'de ne yaptı. Her satır bir cümledir ("… adlı satışçı …
 * leadinin aşamasını … aşamasına taşıdı."); cümle arayüz diline göre kurulur, lead adı lead sayfasına gider. Sekme
 * yalnız oturumu `seesLogs` olan kişiye görünür; sunucu da izinsiz isteği 403 ile reddeder.
 */

/** Süzgeçteki işlem grupları → işlem kodları. */
const GROUPS: Record<string, readonly ActionTypeDto[]> = {
  stage: ["stage.changed", "stage.undone"],
  info: ["lead.created", "lead.fields_updated", "lead.status_changed"],
  contact: [
    "contact.logged",
    "contact.undone",
    "activity.planned",
    "activity.done",
    "activity.reopened",
    "activity.deleted",
  ],
  files: ["attachment.added", "attachment.deleted"],
  assign: ["lead.assigned"],
};

const PAGE = 100;
/** Çeviride kullanıcı ve lead'in yerini tutan işaretler; cümle bunlardan bölünüp kalın ad ve bağlantı konur. */
const USER = "";
const LEAD = "";

const str = (v: unknown): string => (typeof v === "string" ? v : "");
/** Yerel takvim günü (YYYY-MM-DD) → o günün başlangıcı; `plusDays` ile sonraki gün. */
function dayStart(day: string, plusDays = 0): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return undefined;
  const d = new Date(day + "T00:00:00");
  d.setDate(d.getDate() + plusDays);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

export function LogsTab() {
  const { t } = useLang();
  const errText = useErrorText();
  const { nameOf } = useTeamNames();
  const { stageName } = useReference();
  const [actor, setActor] = useState("");
  const [group, setGroup] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState<ActionLogPageDto | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const seq = useRef(0);

  const query = useCallback(
    (before?: string) =>
      adminApi.actionLogs({
        actor: actor || undefined,
        actions: group ? GROUPS[group] : undefined,
        from: dayStart(from),
        to: dayStart(to, 1),
        before,
        limit: PAGE,
      }),
    [actor, group, from, to],
  );

  const reload = useCallback(() => {
    const n = ++seq.current;
    return query()
      .then((p) => {
        if (n !== seq.current) return;
        setPage(p);
        setError(null);
      })
      .catch((e: unknown) => {
        if (n === seq.current) setError(e);
      });
  }, [query]);
  useEffect(() => {
    void reload();
  }, [reload]);

  const more = async () => {
    if (!page?.next) return;
    const n = seq.current;
    setLoadingMore(true);
    try {
      const p = await query(page.next);
      if (n === seq.current) setPage({ items: [...page.items, ...p.items], next: p.next, actors: p.actors });
    } catch (e) {
      if (n === seq.current) setError(e);
    } finally {
      setLoadingMore(false);
    }
  };

  /** Sözlükte karşılığı olmayan kod olduğu gibi görünür. */
  const label = (prefix: string, code: string) => {
    const key = `${prefix}.${code}`;
    const out = t(key);
    return out === key ? code : out;
  };

  const sentence = (e: ActionLogDto): ReactNode => {
    const d = e.details;
    const vars: Record<string, string> = { user: USER, lead: LEAD };
    let key: string = e.action;
    switch (e.action) {
      case "stage.changed":
        vars["to"] = stageName(str(d["to"]));
        if (str(d["from"])) vars["from"] = stageName(str(d["from"]));
        else key = "stage.changedTo";
        break;
      case "stage.undone":
        vars["to"] = stageName(str(d["to"]));
        break;
      case "lead.assigned": {
        const target = str(d["to"]);
        if (!target) key = "lead.released";
        else if (target === e.actorUserId) key = "lead.claimed";
        else vars["to"] = nameOf(target);
        break;
      }
      case "lead.fields_updated": {
        const fields = Array.isArray(d["fields"]) ? d["fields"].map((f) => label("logs.field", str(f))) : [];
        vars["fields"] = fields.join(t("logs.listSep"));
        break;
      }
      case "lead.status_changed":
        if (str(d["status"])) vars["status"] = label("customerStatus", str(d["status"]));
        else key = "lead.status_cleared";
        break;
      case "contact.logged":
        if (str(d["type"]) && str(d["outcome"])) {
          vars["type"] = label("activity.type", str(d["type"]));
          vars["outcome"] = label("activity.outcome", str(d["outcome"]));
        } else key = "contact.loggedPlain";
        break;
      case "activity.planned":
      case "activity.done":
      case "activity.reopened":
      case "activity.deleted":
        vars["type"] = label("activity.type", str(d["type"]) || "other");
        break;
      case "attachment.added":
        key = d["image"] === true ? "attachment.image" : "attachment.file";
        vars["file"] = str(d["fileName"]);
        break;
      case "attachment.deleted":
        vars["file"] = str(d["fileName"]);
        break;
      default:
        break;
    }
    const text = t(`logs.a.${key}`, vars);
    const leadName = e.leadName || t("logs.unnamedLead");
    return text.split(/([])/).map((part, i) =>
      part === USER ? (
        <b key={i}>
          <bdi>{nameOf(e.actorUserId)}</bdi>
        </b>
      ) : part === LEAD ? (
        e.leadId ? (
          <a key={i} className="log-lead" href={`#/lead/${encodeURIComponent(e.leadId)}`}>
            <bdi>{leadName}</bdi>
          </a>
        ) : (
          <b key={i}>
            <bdi>{leadName}</bdi>
          </b>
        )
      ) : (
        <Fragment key={i}>{part}</Fragment>
      ),
    );
  };

  const filtered = Boolean(actor || group || from || to);
  return (
    <div className="adm-stack">
      <SectionHead title={t("logs.title")} help={t("logs.help")}>
        <Button icon="refresh" onClick={() => void reload()}>
          {t("admin.refresh")}
        </Button>
      </SectionHead>
      <div className="log-filters">
        <label className="field">
          <span className="field-l">{t("logs.filter.user")}</span>
          <select value={actor} onChange={(e) => setActor(e.target.value)}>
            <option value="">{t("logs.filter.allUsers")}</option>
            {(page?.actors ?? (actor ? [actor] : []))
              .map((id) => ({ id, name: nameOf(id) }))
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
          </select>
        </label>
        <label className="field">
          <span className="field-l">{t("logs.filter.action")}</span>
          <select value={group} onChange={(e) => setGroup(e.target.value)}>
            <option value="">{t("logs.filter.allActions")}</option>
            {Object.keys(GROUPS).map((g) => (
              <option key={g} value={g}>
                {t(`logs.group.${g}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-l">{t("logs.filter.from")}</span>
          <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-l">{t("logs.filter.to")}</span>
          <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
        </label>
        {filtered && (
          <Button
            variant="ghost"
            onClick={() => {
              setActor("");
              setGroup("");
              setFrom("");
              setTo("");
            }}
          >
            {t("logs.filter.clear")}
          </Button>
        )}
      </div>
      {error ? (
        <LoadError message={errText(error)} onRetry={() => void reload()} />
      ) : !page ? (
        <div aria-busy="true">
          <Skeleton h={240} />
        </div>
      ) : page.items.length === 0 ? (
        <Empty title={t(filtered ? "logs.emptyFiltered" : "logs.empty")}>
          {t(filtered ? "logs.emptyFilteredHint" : "logs.emptyHint")}
        </Empty>
      ) : (
        <>
          <ol className="log-list" aria-label={t("logs.title")}>
            {page.items.map((e) => (
              <li key={e.id}>
                <time dateTime={e.occurredAt}>{fmtDate(e.occurredAt, true)}</time>
                <span className="log-text">{sentence(e)}</span>
              </li>
            ))}
          </ol>
          {page.next && (
            <div>
              <Button onClick={() => void more()} loading={loadingMore}>
                {t("logs.more")}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
