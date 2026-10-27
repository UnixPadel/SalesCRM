import { Fragment, useMemo, useState } from "react";
import { Avatar, Button, Empty, eur, Icon, money } from "../components/ui";
import { LANGUAGE_NAME, ORG_TYPES, ORG_TYPE_LABEL, STAGE, countryName } from "../domain/constants";
import { isOpenDeal, isWon, toEUR } from "../domain/rules";
import type { Deal, OrgType } from "../domain/types";
import { updateOrganization } from "../services/crmService";
import { useCrm } from "../state/CrmContext";

const PAGE = 50;

export function ContactsPage({ initialQuery = "" }: { initialQuery?: string }) {
  const { data, orgById, run, openDeal } = useCrm();
  const [tab, setTab] = useState<"orgs" | "people">("orgs");
  const [q, setQ] = useState(initialQuery);
  const [onlyLinked, setOnlyLinked] = useState(true);
  const [page, setPage] = useState(0);
  const [openOrg, setOpenOrg] = useState<string | null>(initialQuery ? "__first" : null);
  const s = q.trim().toLocaleLowerCase("tr");

  const dealsByOrg = useMemo(() => {
    const m = new Map<string, Deal[]>();
    data.deals.forEach((d) => d.organization_id && m.set(d.organization_id, [...(m.get(d.organization_id) || []), d]));
    return m;
  }, [data.deals]);

  const orgs = data.organizations
    .filter((o) => !s || `${o.name} ${o.website} ${countryName(o.country)}`.toLocaleLowerCase("tr").includes(s))
    .sort((a, b) => a.name.localeCompare(b.name, "tr"));
  const people = data.contacts
    .filter((c) => (!onlyLinked || c.organization_id) && (!s || `${c.name} ${c.email} ${c.phone}`.toLocaleLowerCase("tr").includes(s)))
    .sort((a, b) => a.name.localeCompare(b.name, "tr"));
  const rows = tab === "orgs" ? orgs : people;
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const pg = Math.min(page, pages - 1);
  const expandedOrg = openOrg === "__first" ? orgs[0]?.id : openOrg;

  return (
    <div className="contacts">
      <div className="toolbar">
        <div className="tabs" role="tablist" aria-label="Kayıt tipi">
          <button role="tab" aria-selected={tab === "orgs"} className="tab" onClick={() => (setTab("orgs"), setPage(0))}>
            <Icon name="building" size={14} /> Organizasyonlar <span className="count">{orgs.length}</span>
          </button>
          <button role="tab" aria-selected={tab === "people"} className="tab" onClick={() => (setTab("people"), setPage(0))}>
            <Icon name="user" size={14} /> Kişiler <span className="count">{people.length}</span>
          </button>
        </div>
        <div className="filters">
          <label className="searchfield">
            <Icon name="search" size={14} />
            <span className="sr-only">Ara</span>
            <input type="search" placeholder="Ad, e-posta, ülke…" value={q} onChange={(e) => (setQ(e.target.value), setPage(0))} />
          </label>
          {tab === "people" && (
            <label className="check">
              <input type="checkbox" checked={onlyLinked} onChange={(e) => (setOnlyLinked(e.target.checked), setPage(0))} />
              Yalnız organizasyona bağlı kişiler
            </label>
          )}
        </div>
      </div>

      {!rows.length ? (
        <Empty title="Kayıt bulunamadı">Aramayı değiştirin{tab === "people" && onlyLinked ? " ya da form kişilerini de gösterin" : ""}.</Empty>
      ) : tab === "orgs" ? (
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th scope="col">Organizasyon</th>
                <th scope="col">Tip</th>
                <th scope="col">Ülke</th>
                <th scope="col" className="num">Açık müşteri</th>
                <th scope="col" className="num">Açık değer</th>
                <th scope="col" className="num">Satılan</th>
                <th scope="col">
                  <span className="sr-only">Müşteri kartları</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {orgs.slice(pg * PAGE, pg * PAGE + PAGE).map((o) => {
                const ds = dealsByOrg.get(o.id) || [];
                const open = ds.filter(isOpenDeal);
                const won = ds.filter(isWon);
                const expanded = expandedOrg === o.id;
                return (
                  <Fragment key={o.id}>
                    <tr className={expanded ? "is-open" : ""}>
                      <td>
                        <b>{o.name}</b>
                        {o.website && <div className="muted mono">{o.website}</div>}
                      </td>
                      <td>
                        <select
                          className="bare"
                          aria-label={`${o.name} tipi`}
                          value={o.type}
                          onChange={(e) => run((r) => updateOrganization(r, o.id, { type: e.target.value as OrgType }), "Tip güncellendi")}
                        >
                          {ORG_TYPES.map((t) => (
                            <option key={t.key} value={t.key}>
                              {t.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>{countryName(o.country)}</td>
                      <td className="num">{open.length}</td>
                      <td className="num">{eur(open.reduce((sum, d) => sum + toEUR(d), 0), true)}</td>
                      <td className="num">{won.length}</td>
                      <td>
                        <div className="row-actions">
                          <Button size="sm" variant="ghost" aria-expanded={expanded} onClick={() => setOpenOrg(expanded ? null : o.id)}>
                            {ds.length} kart <Icon name="chevron" size={14} />
                          </Button>
                        </div>
                      </td>
                    </tr>
                    {expanded && (
                      <tr className="detail-row">
                        <td colSpan={7}>
                          <div className="org-deals">
                            {ds.length ? (
                              ds.map((d) => (
                                <button key={d.id} className="org-deal" onClick={() => openDeal(d.id)}>
                                  <b>{d.title}</b>
                                  <span className="muted">{STAGE[d.stage].no}. {STAGE[d.stage].label}</span>
                                  <span>{money(d.value, d.currency)}</span>
                                  <Avatar name={d.owner} size={24} />
                                </button>
                              ))
                            ) : (
                              <span className="muted">Bu organizasyonun kartı yok.</span>
                            )}
                          </div>
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
                <th scope="col">Kişi</th>
                <th scope="col">Rol</th>
                <th scope="col">Organizasyon</th>
                <th scope="col">E-posta</th>
                <th scope="col">Telefon</th>
                <th scope="col">Dil</th>
              </tr>
            </thead>
            <tbody>
              {people.slice(pg * PAGE, pg * PAGE + PAGE).map((c) => {
                const org = c.organization_id ? orgById.get(c.organization_id) : undefined;
                return (
                  <tr key={c.id}>
                    <td>
                      <span className="who-inline">
                        <Avatar name={c.name} size={24} label={false} /> <b>{c.name}</b>
                      </span>
                    </td>
                    <td className="muted">{c.role || "—"}</td>
                    <td>{org ? `${org.name} · ${ORG_TYPE_LABEL[org.type]}` : <span className="muted">—</span>}</td>
                    <td>{c.email ? <a href={`mailto:${c.email}`}>{c.email}</a> : "—"}</td>
                    <td className="mono">{c.phone || "—"}</td>
                    <td>{LANGUAGE_NAME[c.preferred_language] || c.preferred_language}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 && (
        <nav className="pager" aria-label="Sayfalama">
          <Button size="sm" icon="arrowL" disabled={pg === 0} onClick={() => setPage(pg - 1)}>
            Önceki
          </Button>
          <span>
            {pg * PAGE + 1}–{Math.min(rows.length, pg * PAGE + PAGE)} / {rows.length}
          </span>
          <Button size="sm" disabled={pg >= pages - 1} onClick={() => setPage(pg + 1)}>
            Sonraki <Icon name="arrow" />
          </Button>
        </nav>
      )}
    </div>
  );
}
