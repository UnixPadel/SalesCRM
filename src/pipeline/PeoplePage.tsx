import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Empty, Icon, Skeleton, StatusTag } from "../components/ui";
import { countryName } from "../domain/constants";
import { useLang } from "../i18n";
import type { LeadListDto, PersonSummaryDto } from "../modules/sales-pipeline/api/dto";
import { useCrm } from "../state/CrmContext";
import { pipelineApi } from "./api";
import { useErrorText, useTeamNames } from "./hooks";
import { MergePersonDialog } from "./MergePersonDialog";

const PAGE = 50;

/**
 * Kişiler (Faz 6d): `persons` tablosundan, arama sunucuda. Her satırda kişinin lead'lerinin sorumluları görünür.
 * Kuruluş listesi bu sayfadan kaldırıldı (2026-11-19); kuruluş lead detayından bağlanır ve düzenlenir.
 */
export function PeoplePage({ initialQuery = "" }: { initialQuery?: string }) {
  const { t } = useLang();
  const { isViewer, isAdmin } = useCrm();
  // Kişi birleştirmeyi yalnız yönetici yapar (Faz 7d).
  const canMerge = isAdmin && !isViewer;
  const errText = useErrorText();
  const { nameOf } = useTeamNames();
  const [q, setQ] = useState(initialQuery);
  const [debounced, setDebounced] = useState(initialQuery.trim());
  const [page, setPage] = useState(0);
  const [people, setPeople] = useState<PersonSummaryDto[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [merging, setMerging] = useState<PersonSummaryDto | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(id);
  }, [q]);

  const reload = useCallback(() => {
    const n = ++seq.current;
    pipelineApi
      .persons({ q: debounced || undefined })
      .then((p) => {
        if (n !== seq.current) return;
        setPeople(p);
        setError(null);
      })
      .catch((e) => n === seq.current && setError(e));
  }, [debounced]);
  useEffect(reload, [reload]);

  if (error) {
    return (
      <Empty title={errText(error)}>
        <Button onClick={reload} icon="refresh">
          {t("common.retry")}
        </Button>
      </Empty>
    );
  }

  const pages = Math.max(1, Math.ceil((people?.length ?? 0) / PAGE));
  const pg = Math.min(page, pages - 1);

  return (
    <section className="pl-page people-page" aria-labelledby="people-h">
      <div className="toolbar">
        <h1 id="people-h" className="pl-title">
          {t("people.persons")} <span className="count">{people?.length ?? "…"}</span>
        </h1>
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
        </div>
      </div>

      {!people ? (
        <div className="pl-list" aria-busy="true">
          <Skeleton h={48} />
          <Skeleton h={48} />
          <Skeleton h={48} />
        </div>
      ) : people.length === 0 ? (
        <Empty title={t("people.noPersons")}>{debounced ? t("people.tryOther") : t("people.noPersonsHint")}</Empty>
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
                <th scope="col">{t("lead.owner")}</th>
                {canMerge && (
                  <th scope="col">
                    <span className="sr-only">{t("people.col.actions")}</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {people.slice(pg * PAGE, pg * PAGE + PAGE).map((row) => (
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
                    <Owners leads={row.leads} nameOf={nameOf} />
                  </td>
                  {canMerge && (
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

      {people && pages > 1 && (
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
    </section>
  );
}

/** Kişinin lead'lerindeki sorumlular, tekrarsız; sorumlusuz lead "Ortak havuz" olarak yazılır. */
function Owners({ leads, nameOf }: { leads: LeadListDto[]; nameOf: (userId: string | null) => string }) {
  if (!leads.length) return <span className="muted">—</span>;
  const names = [...new Set(leads.map((l) => nameOf(l.assignedUserId)))];
  return <>{names.join(", ")}</>;
}
