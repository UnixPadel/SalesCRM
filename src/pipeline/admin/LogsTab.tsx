import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Button, Empty, Skeleton, fmtDate } from "../../components/ui";
import { useLang } from "../../i18n";
import type {
  ActionLogDto,
  ActionLogPageDto,
  ActionResultDto,
  ActionTypeDto,
} from "../../modules/sales-pipeline/api/dto.actionLog";
import { useCrm } from "../../state/CrmContext";
import { useErrorText, useReference, useTeamNames } from "../hooks";
import { downloadCsv, toCsv } from "../list/csv";
import { adminApi } from "./adminApi";
import { LoadError, SectionHead } from "./bits";

/**
 * Yönetim > Loglar (2026-11-20; 2026-11-27 bütün işlemler): kim, ne zaman, ne yaptı. Her satır bir cümledir ("… adlı
 * satışçı … leadinin aşamasını … aşamasına taşıdı."); cümle arayüz diline göre kurulur, lead adı lead sayfasına gider.
 * Lead işlemleri, yönetim paneli, elle başlatılan aktarımlar, oturumlar ve reddedilen denemeler aynı listededir.
 * Kayıtlar yalnız okunur: arayüzde silme ya da düzenleme yoktur, sunucu ve veritabanı da reddeder.
 * Sekme yalnız oturumu `seesLogs` olan kişiye görünür; sunucu da izinsiz isteği 403 ile reddeder.
 * `#/admin?tab=logs&lead=<id>` tek bir lead'in geçmişini açar (lead sayfasındaki bağlantı).
 */

/** Süzgeçteki işlem grupları → işlem kodları. */
const GROUPS: Record<string, readonly ActionTypeDto[]> = {
  stage: ["stage.changed", "stage.undone"],
  info: ["lead.created", "lead.fields_updated", "lead.status_changed", "lead.deleted", "lead.restored"],
  contact: [
    "contact.logged",
    "contact.undone",
    "contact.deleted",
    "contact.updated",
    "activity.planned",
    "activity.updated",
    "activity.done",
    "activity.reopened",
    "activity.deleted",
  ],
  files: ["attachment.added", "attachment.deleted"],
  assign: ["lead.assigned"],
  warnings: ["warning.checked", "warning.unchecked"],
  people: [
    "organization.created",
    "organization.updated",
    "organization.archived",
    "organization.unarchived",
    "person.merged",
  ],
  admin: [
    "territory.updated",
    "territory.deleted",
    "territory.applied_to_pool",
    "territory.reassigned",
    "product_catalog.imported",
    "settings.updated",
    "stage_mapping.updated",
    "field_mapping.updated",
    "field_mapping.deleted",
    "fx_rates.updated",
    "fx_rates.refreshed",
    "outbox.requeued",
    "inbox.requeued",
    "provider.outbound_updated",
    "checkpoint.restored",
  ],
  sync: ["sheet_sync.run", "st_customer_sync.run", "mail_stats.run"],
  session: ["auth.login", "auth.login_failed", "auth.logout"],
  other: ["request.other"],
};
const RESULTS: readonly ActionResultDto[] = ["ok", "denied", "rejected", "error"];

const PAGE = 100;
/** İndirme: sunucunun sayfa üst sınırıyla çekilir; dosya en çok bu kadar satır taşır (Excel rahat açar). */
const EXPORT_PAGE = 500;
const EXPORT_MAX = 20000;
/** Çeviride kullanıcı ve hedefin (lead, ülke, ayar…) yerini tutan işaretler; cümle bunlardan bölünüp kalın ad konur. */
const USER = "";
const LEAD = "";
const MARKS = /([])/;
const ANONYMOUS = "anonymous";

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => (typeof v === "number" ? v : 0);
/** Yerel takvim günü (YYYY-MM-DD) → o günün başlangıcı; `plusDays` ile sonraki gün. */
function dayStart(day: string, plusDays = 0): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return undefined;
  const d = new Date(day + "T00:00:00");
  d.setDate(d.getDate() + plusDays);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}
const pad = (n: number) => String(n).padStart(2, "0");
const localDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** Dosyadaki tarih: yerel saat, Excel'in tarih diye tanıyıp sıraladığı biçim. */
const localStamp = (iso: string) => {
  const d = new Date(iso);
  return `${localDay(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const groupOf = (action: ActionTypeDto) => Object.keys(GROUPS).find((g) => GROUPS[g]!.includes(action));

export function LogsTab({ lead = "" }: { lead?: string | undefined }) {
  const { t } = useLang();
  const errText = useErrorText();
  const { nameOf } = useTeamNames();
  const { stageName } = useReference();
  const [actor, setActor] = useState("");
  const [group, setGroup] = useState("");
  const [result, setResult] = useState<ActionResultDto | "">("");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  // Lead sayfasından gelince yalnız o lead'in geçmişi (adres çubuğundaki `lead`).
  const [leadId, setLeadId] = useState(lead);
  const [page, setPage] = useState<ActionLogPageDto | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const { toast } = useCrm();
  const seq = useRef(0);

  // Arama kutusu yazarken her tuşta sunucuya gitmez.
  useEffect(() => {
    const h = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(h);
  }, [search]);

  const query = useCallback(
    (before?: string, limit = PAGE) =>
      adminApi.actionLogs({
        actor: actor || undefined,
        actions: group ? GROUPS[group] : undefined,
        target: leadId ? "lead" : undefined,
        targetId: leadId || undefined,
        q: q || undefined,
        result: result || undefined,
        from: dayStart(from),
        to: dayStart(to, 1),
        before,
        limit,
      }),
    [actor, group, leadId, q, result, from, to],
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
  const who = (id: string) => (id === ANONYMOUS ? t("logs.anonymous") : nameOf(id));
  const fieldList = (v: unknown, prefix: string) =>
    (Array.isArray(v) ? v.map((f) => label(prefix, str(f))) : []).join(t("logs.listSep"));
  /** Cümledeki hedefin görünen adı: lead adı, ülke kodu, sağlayıcı… */
  const targetName = (e: ActionLogDto) =>
    e.targetType === "lead" ? e.leadName || e.targetLabel || t("logs.unnamedLead") : e.targetLabel || e.targetId || "";

  /** Cümle metni; kullanıcı ve hedefin yerinde USER / LEAD işaretleri durur. */
  const phrase = (e: ActionLogDto): string => {
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
      case "lead.fields_updated":
        vars["fields"] = fieldList(d["fields"], "logs.field");
        break;
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
      case "contact.deleted":
        vars["reason"] = str(d["reason"]);
        break;
      case "contact.updated":
      case "activity.updated":
        vars["type"] = label("activity.type", str(d["type"]) || "other");
        vars["fields"] = fieldList(d["fields"], "logs.afield");
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
      case "lead.deleted":
        vars["reason"] = str(d["reason"]);
        break;
      case "warning.checked":
      case "warning.unchecked":
        vars["code"] = label("logs.warning", str(d["code"]));
        break;
      case "organization.updated":
        vars["fields"] = fieldList(d["fields"], "logs.ofield");
        break;
      case "territory.updated":
        vars["to"] = str(d["assignedUserId"]) ? nameOf(str(d["assignedUserId"])) : t("logs.pool");
        break;
      case "product_catalog.imported":
        vars["n"] = String(num(d["rows"]));
        break;
      case "settings.updated":
        vars["fields"] = fieldList(d["fields"], "logs.sfield");
        break;
      case "provider.outbound_updated":
        key = d["enabled"] === true ? "provider.outbound_on" : "provider.outbound_off";
        break;
      case "auth.login_failed":
        vars["reason"] = label("logs.loginReason", str(d["reason"]));
        break;
      case "request.other":
        vars["method"] = str(d["method"]);
        vars["path"] = str(d["path"]);
        break;
      default:
        break;
    }
    return t(`logs.a.${key}`, vars);
  };

  const sentence = (e: ActionLogDto): ReactNode => {
    const text = phrase(e);
    const name = targetName(e);
    return text.split(MARKS).map((part, i) =>
      part === USER ? (
        <b key={i}>
          <bdi>{who(e.actorUserId)}</bdi>
        </b>
      ) : part === LEAD ? (
        e.targetType === "lead" && e.leadId ? (
          <a key={i} className="log-lead" href={`#/lead/${encodeURIComponent(e.leadId)}`}>
            <bdi>{name}</bdi>
          </a>
        ) : (
          <b key={i}>
            <bdi>{name}</bdi>
          </b>
        )
      ) : (
        <Fragment key={i}>{part}</Fragment>
      ),
    );
  };
  const plain = (e: ActionLogDto) => phrase(e).split(USER).join(who(e.actorUserId)).split(LEAD).join(targetName(e));

  /** Süzgece uyan bütün kayıtlar (yalnız ekrana yüklenenler değil) Excel'in açtığı CSV olarak iner. */
  const download = async () => {
    setDownloading(true);
    try {
      const items: ActionLogDto[] = [];
      let before: string | undefined;
      do {
        const p = await query(before, EXPORT_PAGE);
        items.push(...p.items);
        before = p.next ?? undefined;
      } while (before && items.length < EXPORT_MAX);
      const rows = items.map((e) => {
        const g = groupOf(e.action);
        return [
          localStamp(e.occurredAt),
          who(e.actorUserId),
          g ? t(`logs.group.${g}`) : e.action,
          targetName(e),
          t(`logs.result.${e.result}`),
          plain(e),
        ];
      });
      const header = [
        t("logs.col.date"),
        t("logs.filter.user"),
        t("logs.filter.action"),
        t("logs.col.lead"),
        t("logs.filter.result"),
        t("logs.col.text"),
      ];
      downloadCsv(`loglar-${localDay(new Date())}.csv`, toCsv(header, rows));
      toast(t(before ? "logs.downloadCapped" : "logs.downloaded", { n: items.length }));
    } catch (e) {
      toast(errText(e), { bad: true });
    } finally {
      setDownloading(false);
    }
  };

  const filtered = Boolean(actor || group || result || q || from || to || leadId);
  const leadTitle = leadId ? page?.items.find((e) => e.targetId === leadId)?.leadName : undefined;
  return (
    <div className="adm-stack">
      <SectionHead title={t("logs.title")} help={t("logs.help")}>
        <Button icon="download" onClick={() => void download()} disabled={!page?.items.length} loading={downloading}>
          {t("logs.download")}
        </Button>
        <Button icon="refresh" onClick={() => void reload()}>
          {t("admin.refresh")}
        </Button>
      </SectionHead>
      {leadId && (
        <p className="log-scope">
          {t("logs.leadScope", { lead: leadTitle || t("logs.unnamedLead") })}{" "}
          <Button variant="ghost" onClick={() => setLeadId("")}>
            {t("logs.leadScopeClear")}
          </Button>
        </p>
      )}
      <div className="log-filters">
        <label className="field">
          <span className="field-l">{t("logs.filter.search")}</span>
          <input
            type="search"
            value={search}
            maxLength={100}
            placeholder={t("logs.filter.searchHint")}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <label className="field">
          <span className="field-l">{t("logs.filter.user")}</span>
          <select value={actor} onChange={(e) => setActor(e.target.value)}>
            <option value="">{t("logs.filter.allUsers")}</option>
            {(page?.actors ?? (actor ? [actor] : []))
              .map((id) => ({ id, name: who(id) }))
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
          <span className="field-l">{t("logs.filter.result")}</span>
          <select value={result} onChange={(e) => setResult(e.target.value as ActionResultDto | "")}>
            <option value="">{t("logs.filter.allResults")}</option>
            {RESULTS.map((r) => (
              <option key={r} value={r}>
                {t(`logs.result.${r}`)}
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
              setResult("");
              setSearch("");
              setQ("");
              setFrom("");
              setTo("");
              setLeadId("");
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
                <span className="log-text">
                  {e.result !== "ok" && (
                    <span className={`tag log-result log-result-${e.result}`}>{t(`logs.result.${e.result}`)}</span>
                  )}
                  {sentence(e)}
                </span>
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
