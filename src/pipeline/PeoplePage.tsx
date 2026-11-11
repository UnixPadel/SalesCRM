import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { Button, Empty, Icon, Skeleton, StatusTag, eur, money } from "../components/ui";
import { countryName } from "../domain/constants";
import type { Currency } from "../domain/types";
import { useLang } from "../i18n";
import type {
  LeadListDto,
  OrganizationDto,
  OrganizationSummaryDto,
  OrganizationTypeDto,
  PersonSummaryDto,
} from "../modules/sales-pipeline/api/dto";
import { navigate } from "../router";
import { useCrm } from "../state/CrmContext";
import { adminApi } from "./admin/adminApi";
import { ConfirmDialog } from "./admin/bits";
import { pipelineApi } from "./api";
import { StageTag } from "./bits";
import { useErrorText, useTeamNames } from "./hooks";
import { MergePersonDialog } from "./MergePersonDialog";
import { ORGANIZATION_TYPES, OrganizationDialog } from "./OrganizationDialog";

type Tab = "orgs" | "people";
const TAB_KEY = "unixcrm.v2.peopleTab";
const PAGE = 50;

/**
 * Kişiler ve kuruluşlar (Faz 6d): yeni `persons` ve `organizations` tablolarından. Kuruluş satırı açılınca bağlı
 * kişiler ve görünür lead'leri; kişi satırında lead'leri (aşama, tutar). Arama sunucuda. Kuruluş türü satırdan,
 * diğer alanlar pencereden düzenlenir. Lead'e tıklayınca detaya gider.
 */
export function PeoplePage({ initialQuery = "" }: { initialQuery?: string }) {
  const { t } = useLang();
  const { toast, isViewer, isAdmin } = useCrm();
  // Kuruluş kayıtlarını yalnız yönetici düzenler (Faz 7e); satışçı ve görüntüleyici okur.
  const canEditOrg = isAdmin && !isViewer;
  const errText = useErrorText();
  const [tab, setTab] = useState<Tab>(() => {
    try {
      return localStorage.getItem(TAB_KEY) === "people" ? "people" : "orgs";
    } catch {
      return "orgs";
    }
  });
  const [q, setQ] = useState(initialQuery);
  const [debounced, setDebounced] = useState(initialQuery.trim());
  const [page, setPage] = useState(0);
  const [orgs, setOrgs] = useState<OrganizationSummaryDto[] | null>(null);
  const [people, setPeople] = useState<PersonSummaryDto[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [openOrg, setOpenOrg] = useState<string | null>(null);
  const [orgPeople, setOrgPeople] = useState<Record<string, PersonSummaryDto[] | undefined>>({});
  const [dialog, setDialog] = useState<{ initial?: OrganizationDto } | null>(null);
  // Faz 7d: arşivlenenleri göster süzgeci, arşiv onayı ve kişi birleştirme penceresi.
  const [showArchived, setShowArchived] = useState(false);
  const [archiving, setArchiving] = useState<OrganizationDto | null>(null);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [merging, setMerging] = useState<PersonSummaryDto | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(id);
  }, [q]);

  const reload = useCallback(() => {
    const n = ++seq.current;
    const search = debounced || undefined;
    Promise.all([pipelineApi.organizations({ q: search, archived: showArchived }), pipelineApi.persons({ q: search })])
      .then(([o, p]) => {
        if (n !== seq.current) return;
        setOrgs(o);
        setPeople(p);
        setError(null);
        setOrgPeople({});
      })
      .catch((e) => n === seq.current && setError(e));
  }, [debounced, showArchived]);
  useEffect(reload, [reload]);

  const setArchived = async (o: OrganizationDto, archived: boolean) => {
    setArchiveBusy(true);
    try {
      await adminApi.archiveOrganization(o.id, archived);
      setArchiving(null);
      toast(t(archived ? "org.archived.toast" : "org.unarchived.toast", { name: o.name }));
      reload();
    } catch (e) {
      toast(errText(e), { bad: true });
    } finally {
      setArchiveBusy(false);
    }
  };

  const pickTab = (next: Tab) => {
    setTab(next);
    setPage(0);
    try {
      localStorage.setItem(TAB_KEY, next);
    } catch {
      /* depolama kapalı */
    }
  };

  const toggleOrg = async (id: string) => {
    const next = openOrg === id ? null : id;
    setOpenOrg(next);
    if (next && !orgPeople[next]) {
      try {
        const rows = await pipelineApi.persons({ organizationId: next });
        setOrgPeople((m) => ({ ...m, [next]: rows }));
      } catch (e) {
        toast(errText(e), { bad: true });
      }
    }
  };

  const setType = async (o: OrganizationDto, type: OrganizationTypeDto) => {
    try {
      await pipelineApi.updateOrganization(o.id, { type });
      toast(t("org.saved"));
      reload();
    } catch (e) {
      toast(errText(e), { bad: true });
    }
  };

  if (error) {
    return (
      <Empty title={errText(error)}>
        <Button onClick={reload} icon="refresh">
          {t("common.retry")}
        </Button>
      </Empty>
    );
  }

  const rows = tab === "orgs" ? orgs : people;
  const pages = Math.max(1, Math.ceil((rows?.length ?? 0) / PAGE));
  const pg = Math.min(page, pages - 1);

  return (
    <section className="pl-page people-page" aria-labelledby="people-h">
      <div className="toolbar">
        <h1 id="people-h" className="pl-title sr-only">
          {t("nav.contacts")}
        </h1>
        <div className="tabs" role="tablist" aria-label={t("people.tabs")}>
          <button role="tab" aria-selected={tab === "orgs"} className="tab" onClick={() => pickTab("orgs")}>
            <Icon name="building" size={14} /> {t("people.orgs")} <span className="count">{orgs?.length ?? "…"}</span>
          </button>
          <button role="tab" aria-selected={tab === "people"} className="tab" onClick={() => pickTab("people")}>
            <Icon name="user" size={14} /> {t("people.persons")} <span className="count">{people?.length ?? "…"}</span>
          </button>
        </div>
        <div className="filters">
          <label className="searchfield">
            <Icon name="search" size={14} />
            <input
              type="search"
              placeholder={t("people.searchPh")}
              aria-label={t("common.search")}
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(0);
              }}
            />
          </label>
          {tab === "orgs" && (
            <label className="cd-check">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => {
                  setShowArchived(e.target.checked);
                  setPage(0);
                }}
              />
              {t("org.showArchived")}
            </label>
          )}
          {canEditOrg && tab === "orgs" && (
            <Button variant="pri" icon="plus" onClick={() => setDialog({})}>
              {t("org.new")}
            </Button>
          )}
        </div>
      </div>

      {!rows ? (
        <div className="pl-list" aria-busy="true">
          <Skeleton h={48} />
          <Skeleton h={48} />
          <Skeleton h={48} />
        </div>
      ) : rows.length === 0 ? (
        <Empty title={tab === "orgs" ? t("people.noOrgs") : t("people.noPersons")}>
          {debounced ? t("people.tryOther") : tab === "orgs" ? t("people.noOrgsHint") : t("people.noPersonsHint")}
        </Empty>
      ) : tab === "orgs" ? (
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th scope="col">{t("org.name")}</th>
                <th scope="col">{t("org.type")}</th>
                <th scope="col">{t("new.country")}</th>
                <th scope="col" className="num">
                  {t("people.col.persons")}
                </th>
                <th scope="col" className="num">
                  {t("people.col.open")}
                </th>
                <th scope="col" className="num">
                  {t("people.col.openValue")}
                </th>
                <th scope="col" className="num">
                  {t("people.col.won")}
                </th>
                <th scope="col">
                  <span className="sr-only">{t("people.col.actions")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {(orgs ?? []).slice(pg * PAGE, pg * PAGE + PAGE).map((row) => {
                const o = row.organization;
                const expanded = openOrg === o.id;
                return (
                  <Fragment key={o.id}>
                    <tr className={(expanded ? "is-open" : "") + (o.archivedAt ? " is-archived" : "")}>
                      <td>
                        <b>{o.name}</b>{" "}
                        {o.archivedAt && (
                          <StatusTag tone="neutral" icon="lock">
                            {t("org.archived")}
                          </StatusTag>
                        )}
                        {o.website && <div className="muted mono">{o.website}</div>}
                      </td>
                      <td>
                        {!canEditOrg ? (
                          t(`org.type.${o.type}`)
                        ) : (
                          <select
                            className="bare"
                            aria-label={`${o.name} ${t("org.type")}`}
                            value={o.type}
                            onChange={(e) => setType(o, e.target.value as OrganizationTypeDto)}
                          >
                            {ORGANIZATION_TYPES.map((k) => (
                              <option key={k} value={k}>
                                {t(`org.type.${k}`)}
                              </option>
                            ))}
                          </select>
                        )}
                      </td>
                      <td>{o.country ? countryName(o.country) : "—"}</td>
                      <td className="num">{row.personCount}</td>
                      <td className="num">{row.openCount}</td>
                      <td className="num">{row.openTotalEur ? eur(row.openTotalEur, true) : "—"}</td>
                      <td className="num">{row.wonCount}</td>
                      <td>
                        <div className="row-actions">
                          {canEditOrg && !o.archivedAt && (
                            <Button size="sm" variant="ghost" icon="edit" onClick={() => setDialog({ initial: o })}>
                              {t("lead.edit")}
                            </Button>
                          )}
                          {canEditOrg &&
                            (o.archivedAt ? (
                              <Button size="sm" variant="ghost" onClick={() => void setArchived(o, false)}>
                                {t("org.unarchive")}
                              </Button>
                            ) : (
                              <Button size="sm" variant="ghost" onClick={() => setArchiving(o)}>
                                {t("org.archive")}
                              </Button>
                            ))}
                          <Button size="sm" variant="ghost" aria-expanded={expanded} onClick={() => toggleOrg(o.id)}>
                            {t("people.leadsN", { n: row.leadCount })} <Icon name="chevron" size={14} />
                          </Button>
                        </div>
                      </td>
                    </tr>
                    {expanded && (
                      <tr className="detail-row">
                        <td colSpan={8}>
                          <OrgDetail rows={orgPeople[o.id]} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th scope="col">{t("people.col.person")}</th>
                <th scope="col">{t("new.email")}</th>
                <th scope="col">{t("new.phone")}</th>
                <th scope="col">{t("people.col.org")}</th>
                <th scope="col">{t("new.country")}</th>
                <th scope="col">{t("people.col.leads")}</th>
                {canEditOrg && (
                  <th scope="col">
                    <span className="sr-only">{t("people.col.actions")}</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {(people ?? []).slice(pg * PAGE, pg * PAGE + PAGE).map((row) => (
                <tr key={row.person.id}>
                  <td>
                    <b>{row.person.fullName || "—"}</b>{" "}
                    {row.person.mergedIntoId && (
                      <StatusTag tone="neutral" icon="arrow">
                        {t("merge.badge")}
                      </StatusTag>
                    )}
                    {row.person.company && <div className="muted">{row.person.company}</div>}
                  </td>
                  <td className="mono">
                    {row.person.emailNormalized ? (
                      <a href={`mailto:${row.person.emailNormalized}`}>{row.person.emailNormalized}</a>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="mono">
                    {row.person.phoneE164 ? <a href={`tel:${row.person.phoneE164}`}>{row.person.phoneE164}</a> : "—"}
                  </td>
                  <td>
                    {row.organization?.name ?? "—"}
                    {row.organization?.archived ? ` (${t("org.archived")})` : ""}
                  </td>
                  <td>{row.person.country ? countryName(row.person.country) : "—"}</td>
                  <td>
                    <LeadChips leads={row.leads} />
                  </td>
                  {canEditOrg && (
                    <td>
                      <div className="row-actions">
                        {!row.person.mergedIntoId && (
                          <Button size="sm" variant="ghost" icon="users" onClick={() => setMerging(row)}>
                            {t("merge.action")}
                          </Button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rows && pages > 1 && (
        <div className="pager">
          <Button size="sm" disabled={pg === 0} onClick={() => setPage(pg - 1)} icon="arrowL">
            {t("common.back")}
          </Button>
          <span className="muted">
            {pg + 1} / {pages}
          </span>
          <Button size="sm" disabled={pg >= pages - 1} onClick={() => setPage(pg + 1)} icon="arrow">
            {t("people.next")}
          </Button>
        </div>
      )}

      {archiving && (
        <ConfirmDialog
          title={t("org.archive")}
          confirmLabel={t("org.archive")}
          busy={archiveBusy}
          onConfirm={() => void setArchived(archiving, true)}
          onClose={() => setArchiving(null)}
        >
          {t("org.archiveConfirm", { name: archiving.name })}
        </ConfirmDialog>
      )}
      {merging && (
        <MergePersonDialog
          target={merging}
          onClose={() => setMerging(null)}
          onMerged={() => {
            setMerging(null);
            reload();
          }}
        />
      )}

      {dialog && (
        <OrganizationDialog
          {...(dialog.initial ? { initial: dialog.initial } : {})}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            reload();
          }}
        />
      )}
    </section>
  );
}

/** Kuruluş satırının altı: bağlı kişiler ve her birinin görünür lead'leri. */
function OrgDetail({ rows }: { rows: PersonSummaryDto[] | undefined }) {
  const { t } = useLang();
  if (!rows) return <Skeleton h={32} />;
  if (!rows.length) return <span className="muted">{t("people.orgNoPersons")}</span>;
  return (
    <div className="org-people">
      {rows.map((r) => (
        <div key={r.person.id} className="org-person">
          <span>
            <b>{r.person.fullName || "—"}</b>
            <span className="muted"> {r.person.emailNormalized ?? r.person.phoneE164 ?? ""}</span>
          </span>
          <LeadChips leads={r.leads} />
        </div>
      ))}
    </div>
  );
}

/** Lead çipleri: aşama etiketi + ad + tutar; tıklayınca detay. */
function LeadChips({ leads }: { leads: LeadListDto[] }) {
  const { t } = useLang();
  const { nameOf } = useTeamNames();
  if (!leads.length) return <span className="muted">{t("people.noLeads")}</span>;
  return (
    <div className="lead-chips">
      {leads.map((l) => (
        <button
          key={l.id}
          type="button"
          className="lead-chip"
          onClick={() => navigate("lead", undefined, l.id)}
          title={`${l.fullName} · ${nameOf(l.assignedUserId)}`}
        >
          <StageTag code={l.currentStage} />
          <span className="lead-chip-t">{l.productInterest || l.courtModel || l.company || l.fullName}</span>
          {l.value && <b>{money(l.value.amount, l.value.currency as Currency, true)}</b>}
        </button>
      ))}
    </div>
  );
}
