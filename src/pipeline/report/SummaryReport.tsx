import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { Button, Empty, Icon, Skeleton, StatusTag } from "../../components/ui";
import { useLang } from "../../i18n";
import type { OwnerRowDto, TrackingCountsDto, TrackingReportDto } from "../../modules/sales-pipeline/api/dto";
import { useCrm } from "../../state/CrmContext";
import { contactApi } from "../contact/contactApi";
import { useReference, useTeamNames } from "../hooks";
import { downloadCsv, toCsv } from "../list/csv";
import { drillDownHref, type CellSelector, type Metric, type ReportFilters } from "./drillDown";

const SCOPE_KEY = "unixcrm.v2.reportScope";
type Period = "all" | "month" | "30" | "custom";

/**
 * Özet rapor (Faz 7g, D8; iş emri §5.5): Excel ÖZET RAPOR'un beş bölümü, aynı tanımlarla sunucuda hesaplanır.
 * Sıfır olmayan her sayı o lead'leri Lead listesinde açan bağlantıdır (noktalı alt çizgi; renk tek başına değil).
 */
export function SummaryReport() {
  const { t, lang } = useLang();
  const { isAdmin } = useCrm();
  const { ref } = useReference();
  const { team, nameOf } = useTeamNames();

  const [scope, setScope] = useState<"all" | "excel">(() => {
    try {
      return localStorage.getItem(SCOPE_KEY) === "excel" ? "excel" : "all";
    } catch {
      return "all";
    }
  });
  const [period, setPeriod] = useState<Period>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [source, setSource] = useState("");
  const [campaign, setCampaign] = useState("");
  const [owner, setOwner] = useState("");
  const [report, setReport] = useState<TrackingReportDto | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [poolOpen, setPoolOpen] = useState(false);
  const [tick, setTick] = useState(0);
  const tz = ref?.timeZone ?? "Europe/Istanbul";
  const day = useMemo(() => new Intl.DateTimeFormat("en-CA", { timeZone: tz }), [tz]);

  const range = useMemo(() => {
    const now = new Date();
    if (period === "month") return { from: `${day.format(now).slice(0, 7)}-01`, to: day.format(now) };
    if (period === "30") return { from: day.format(new Date(now.getTime() - 29 * 86_400_000)), to: day.format(now) };
    if (period === "custom") return { from: from || null, to: to || null };
    return { from: null, to: null };
  }, [period, from, to, day]);
  const filters: ReportFilters = {
    scope: scope === "excel" ? "excel" : null,
    source: source || null,
    campaign: campaign || null,
    from: range.from,
    to: range.to,
    owner: owner || null,
  };
  const key = JSON.stringify(filters);

  useEffect(() => {
    let alive = true;
    const p = new URLSearchParams();
    const f = JSON.parse(key) as ReportFilters;
    if (f.scope) p.set("scope", f.scope);
    if (f.source) p.set("source", f.source);
    if (f.campaign) p.set("campaign", f.campaign);
    if (f.from) p.set("from", f.from);
    if (f.to) p.set("to", f.to);
    if (f.owner) p.set("owner", f.owner);
    contactApi
      .tracking(p)
      .then((r) => alive && (setReport(r), setError(null)))
      .catch((e) => alive && setError(e));
    return () => {
      alive = false;
    };
  }, [key, tick]);

  const pickScope = (s: "all" | "excel") => {
    setScope(s);
    try {
      localStorage.setItem(SCOPE_KEY, s);
    } catch {
      /* yalnız kolaylık */
    }
  };
  const pct = (r: number | null) =>
    r === null ? (
      <span aria-label={t("reports.summary.na")}>–</span>
    ) : (
      new Intl.NumberFormat(lang === "tr" ? "tr-TR" : "en-GB", { style: "percent", maximumFractionDigits: 1 }).format(r)
    );
  const dd = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleDateString(lang === "tr" ? "tr-TR" : "en-GB", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
        })
      : "—";
  const ownerName = (id: string | null) => (id === null ? t("common.pool") : nameOf(id));
  /** Sıfır olmayan sayı bağlantıdır; sıfır düz metin. */
  const n = (value: number, sel: CellSelector, label: string): ReactNode =>
    value > 0 ? (
      <a className="drill" href={drillDownHref(filters, sel, label)}>
        {value.toLocaleString(lang === "tr" ? "tr-TR" : "en-GB")}
      </a>
    ) : (
      <span className="zero">0</span>
    );

  if (error) {
    return (
      <Empty title={t("reports.summary.loadError")}>
        <Button icon="refresh" onClick={() => setTick((x) => x + 1)}>
          {t("common.retry")}
        </Button>
      </Empty>
    );
  }

  const filtersRow = (
    <div className="sr-filters">
      <div className="chips" role="group" aria-label={t("reports.summary.scope")}>
        <button type="button" className="chip hit" aria-pressed={scope === "all"} onClick={() => pickScope("all")}>
          {t("reports.summary.scopeAll", { n: report?.scope.counts.all ?? "…" })}
        </button>
        <button type="button" className="chip hit" aria-pressed={scope === "excel"} onClick={() => pickScope("excel")}>
          <Icon name="file" size={14} /> {t("reports.summary.scopeExcel", { n: report?.scope.counts.excel ?? "…" })}
        </button>
      </div>
      <label className="field">
        <span className="field-l">{t("reports.summary.period")}</span>
        <select value={period} onChange={(e) => setPeriod(e.target.value as Period)}>
          <option value="all">{t("history.range.all")}</option>
          <option value="month">{t("reports.summary.thisMonth")}</option>
          <option value="30">{t("history.range.30")}</option>
          <option value="custom">{t("reports.summary.custom")}</option>
        </select>
      </label>
      {period === "custom" && (
        <>
          <label className="field">
            <span className="field-l">{t("reports.summary.from")}</span>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="field">
            <span className="field-l">{t("reports.summary.to")}</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
        </>
      )}
      <label className="field">
        <span className="field-l">{t("board.filter.source")}</span>
        <select value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="">{t("board.filter.allSources")}</option>
          {(["meta_form", "google_form", "web_form", "manual", "import"] as const).map((s) => (
            <option key={s} value={s}>
              {t(`source.${s}`)}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="field-l">{t("answer.campaign")}</span>
        <select value={campaign} onChange={(e) => setCampaign(e.target.value)}>
          <option value="">{t("common.all")}</option>
          {(report?.campaigns ?? []).map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
      {isAdmin && (
        <label className="field">
          <span className="field-l">{t("board.filter.owner")}</span>
          <select value={owner} onChange={(e) => setOwner(e.target.value)}>
            <option value="">{t("board.filter.allOwners")}</option>
            <option value="pool">{t("common.pool")}</option>
            {team.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );

  if (!report) {
    return (
      <div className="sr" aria-busy="true">
        {filtersRow}
        <div className="sr-tiles">
          {Array.from({ length: 7 }, (_, i) => (
            <Skeleton key={i} h={96} />
          ))}
        </div>
        <Skeleton h={320} />
      </div>
    );
  }

  const b = report.basics;
  const owners = [...report.byOwner].sort((x, y) =>
    x.ownerId === null ? 1 : y.ownerId === null ? -1 : ownerName(x.ownerId).localeCompare(ownerName(y.ownerId), "tr"),
  );
  const maxLead = Math.max(1, ...owners.map((r) => r.lead));
  const showLegacy = owners.some((r) => r.legacyNoContact > 0) || b.legacyNoContact > 0;
  const statusCodes = [...(ref?.customerStatuses.map((s) => s.code) ?? []), "none"];
  const tiles: { key: Metric; label: string; value: number; share?: number }[] = [
    { key: "total", label: t("reports.summary.total"), value: b.total },
    { key: "mailSent", label: t("reports.summary.mailSent"), value: b.mailSent, share: b.share.mailSent },
    {
      key: "whatsappSent",
      label: t("reports.summary.whatsappSent"),
      value: b.whatsappSent,
      share: b.share.whatsappSent,
    },
    {
      key: "neverReached",
      label: t("reports.summary.neverReached"),
      value: b.neverReached,
      share: b.share.neverReached,
    },
    { key: "replied", label: t("reports.summary.replied"), value: b.replied, share: b.share.replied },
    {
      key: "proposalGiven",
      label: t("reports.summary.proposalGiven"),
      value: b.proposalGiven,
      share: b.share.proposalGiven,
    },
    { key: "buyers", label: t("reports.summary.buyers"), value: b.buyers, share: b.share.buyers },
  ];
  const ownerCells = (r: TrackingCountsDto, sel: CellSelector, label: string) => (
    <>
      <td className="num">
        <span className="bar" style={{ inlineSize: `${(r.lead / maxLead) * 100}%` }} aria-hidden="true" />
        {n(r.lead, { ...sel, metric: "total" }, `${label} · ${t("reports.summary.col.lead")}`)}
      </td>
      <td className="num">
        {n(r.mailSent, { ...sel, metric: "mailSent" }, `${label} · ${t("reports.summary.col.mail")}`)}
      </td>
      <td className="num">
        {n(r.whatsappSent, { ...sel, metric: "whatsappSent" }, `${label} · ${t("reports.summary.col.wa")}`)}
      </td>
      <td className="num">
        {r.neverReached > 0 && <Icon name="warn" size={12} />}
        {n(r.neverReached, { ...sel, metric: "neverReached" }, `${label} · ${t("reports.summary.col.never")}`)}
      </td>
      {showLegacy && (
        <td className="num">
          {n(r.legacyNoContact, { ...sel, metric: "legacyNoContact" }, `${label} · ${t("summary.legacyShort")}`)}
        </td>
      )}
      <td className="num">
        {n(r.replied, { ...sel, metric: "replied" }, `${label} · ${t("reports.summary.col.replied")}`)}
      </td>
      <td className="num">
        {n(r.proposalGiven, { ...sel, metric: "proposalGiven" }, `${label} · ${t("reports.summary.col.proposal")}`)}
      </td>
      <td className="num">
        {n(r.buyers, { ...sel, metric: "buyers" }, `${label} · ${t("reports.summary.col.buyers")}`)}
      </td>
      <td className="num">{pct(r.reachRate)}</td>
      <td className="num">{pct(r.replyRate)}</td>
      <td className="num">{pct(r.proposalRate)}</td>
    </>
  );
  const exportCsv = () => {
    const rows: string[][] = [
      [t("reports.summary.s1")],
      ...tiles.map((x) => [x.label, String(x.value)]),
      [],
      [t("reports.summary.s2")],
      ...owners.map((r: OwnerRowDto) => [
        ownerName(r.ownerId),
        ...[
          r.lead,
          r.mailSent,
          r.whatsappSent,
          r.neverReached,
          r.legacyNoContact,
          r.replied,
          r.proposalGiven,
          r.buyers,
        ].map(String),
      ]),
      [],
      [t("reports.summary.s5")],
      ...report.byInstallTimeline.map((x) => [
        t(`answer.timeline.${x.timeline ?? "none"}`),
        ...[x.lead, x.neverReached, x.replied, x.proposalGiven].map(String),
      ]),
    ];
    downloadCsv(`ozet-rapor-${day.format(new Date())}.csv`, toCsv([t("reports.tab.summary")], rows));
  };

  return (
    <div className="sr">
      {filtersRow}
      <p className="sr-scope">
        {t("reports.summary.scopeLine", {
          n: b.total,
          first: dd(report.header.firstLeadAt),
          last: dd(report.header.lastLeadAt),
          today: dd(new Date().toISOString()),
        })}
        {scope === "excel" && ` · ${t("reports.summary.sameAsExcel")}`}
        {report.scope.repScoped && ` · ${t("reports.summary.repScope")}`}
      </p>
      <p className="field-h">
        <Icon name="info" size={14} /> {t("reports.summary.hint")}{" "}
        <button type="button" className="link-btn" onClick={exportCsv}>
          {t("list.export")}
        </button>
      </p>

      {b.total === 0 ? (
        <Empty title={t("reports.summary.empty")} />
      ) : (
        <>
          <section aria-labelledby="sr-1">
            <h2 id="sr-1">{t("reports.summary.s1")}</h2>
            <div className="sr-tiles">
              {tiles.map((x) => (
                <div key={x.key} className="sr-tile">
                  <span className="sr-tl">{x.label}</span>
                  <span className="sr-tv">{n(x.value, { metric: x.key }, x.label)}</span>
                  {x.share !== undefined && (
                    <span className="sr-ts">
                      {pct(x.share)} · {t("reports.summary.ofTotal")}
                    </span>
                  )}
                </div>
              ))}
            </div>
            {b.legacyNoContact > 0 && (
              <p className="field-h">
                {t("reports.summary.legacyNote", { n: b.legacyNoContact })}{" "}
                <a
                  className="drill"
                  href={drillDownHref(filters, { metric: "legacyNoContact" }, t("summary.legacyShort"))}
                >
                  {t("today.openList")}
                </a>
              </p>
            )}
          </section>

          <section aria-labelledby="sr-2">
            <h2 id="sr-2">{t("reports.summary.s2")}</h2>
            <div className="sr-wrap" tabIndex={0} role="region" aria-labelledby="sr-2">
              <table className="sr-tbl">
                <thead>
                  <tr>
                    <th scope="col">{t("list.col.owner")}</th>
                    <th scope="col">{t("reports.summary.col.lead")}</th>
                    <th scope="col">{t("reports.summary.col.mail")}</th>
                    <th scope="col">{t("reports.summary.col.wa")}</th>
                    <th scope="col">{t("reports.summary.col.never")}</th>
                    {showLegacy && <th scope="col">{t("summary.legacyShort")}</th>}
                    <th scope="col">{t("reports.summary.col.replied")}</th>
                    <th scope="col">{t("reports.summary.col.proposal")}</th>
                    <th scope="col">{t("reports.summary.col.buyers")}</th>
                    <th scope="col">{t("reports.summary.col.reachRate")}</th>
                    <th scope="col">{t("reports.summary.col.replyRate")}</th>
                    <th scope="col">{t("reports.summary.col.proposalRate")}</th>
                  </tr>
                </thead>
                <tbody>
                  {owners.map((r) => (
                    <Fragment key={r.ownerId ?? "pool"}>
                      <tr className={r.ownerId === null ? "pool" : ""}>
                        <th scope="row">
                          {r.ownerId === null && report.poolBreakdown.length > 0 ? (
                            <button
                              type="button"
                              className="link-btn"
                              aria-expanded={poolOpen}
                              onClick={() => setPoolOpen((v) => !v)}
                            >
                              <Icon name="chevron" size={12} className={poolOpen ? "" : "rot"} /> {t("common.pool")}
                            </button>
                          ) : (
                            ownerName(r.ownerId)
                          )}
                        </th>
                        {ownerCells(r, { owner: r.ownerId }, ownerName(r.ownerId))}
                      </tr>
                      {r.ownerId === null &&
                        poolOpen &&
                        report.poolBreakdown.map((p) => (
                          <tr key={`pb-${p.excelOwner ?? "none"}`} className="sub">
                            <th scope="row">↳ {p.excelOwner ?? t("reports.summary.noExcelOwner")}</th>
                            {ownerCells(
                              p,
                              { owner: null, excelOwner: p.excelOwner },
                              `${t("common.pool")} · ${p.excelOwner ?? "—"}`,
                            )}
                          </tr>
                        ))}
                    </Fragment>
                  ))}
                  <tr className="total">
                    <th scope="row">{t("reports.summary.totalRow")}</th>
                    {ownerCells(report.byOwnerTotal, {}, t("reports.summary.totalRow"))}
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="field-h">{t("reports.summary.s2note")}</p>
            {owners.some((r) => r.ownerId === null) && <p className="field-h">{t("reports.summary.poolNote")}</p>}
          </section>

          <section aria-labelledby="sr-3">
            <h2 id="sr-3">{t("reports.summary.s3")}</h2>
            <div className="sr-wrap" tabIndex={0} role="region" aria-labelledby="sr-3">
              <table className="sr-tbl">
                <thead>
                  <tr>
                    <th scope="col">{t("list.col.owner")}</th>
                    {statusCodes.map((c) => (
                      <th key={c} scope="col">
                        {t(`customerStatus.${c}`)}
                      </th>
                    ))}
                    <th scope="col">{t("reports.summary.totalRow")}</th>
                  </tr>
                </thead>
                <tbody>
                  {[...report.statusByOwner]
                    .sort((x, y) =>
                      x.ownerId === null
                        ? 1
                        : y.ownerId === null
                          ? -1
                          : ownerName(x.ownerId).localeCompare(ownerName(y.ownerId), "tr"),
                    )
                    .map((r) => (
                      <tr key={r.ownerId ?? "pool"}>
                        <th scope="row">{ownerName(r.ownerId)}</th>
                        {statusCodes.map((c) => (
                          <td
                            key={c}
                            className={"num" + ((r.counts[c as keyof typeof r.counts] ?? 0) > 0 ? " strong" : "")}
                          >
                            {n(
                              r.counts[c as keyof typeof r.counts] ?? 0,
                              { owner: r.ownerId, status: c },
                              `${ownerName(r.ownerId)} · ${t(`customerStatus.${c}`)}`,
                            )}
                          </td>
                        ))}
                        <td className="num">{n(r.total, { owner: r.ownerId }, ownerName(r.ownerId))}</td>
                      </tr>
                    ))}
                  <tr className="total">
                    <th scope="row">{t("reports.summary.totalRow")}</th>
                    {statusCodes.map((c) => (
                      <td key={c} className="num">
                        {n(
                          report.statusTotal.counts[c as keyof typeof report.statusTotal.counts] ?? 0,
                          { status: c },
                          t(`customerStatus.${c}`),
                        )}
                      </td>
                    ))}
                    <td className="num">{n(report.statusTotal.total, {}, t("reports.summary.totalRow"))}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section aria-labelledby="sr-4">
            <h2 id="sr-4">{t("reports.summary.s4")}</h2>
            <div className="sr-wrap" tabIndex={0} role="region" aria-labelledby="sr-4">
              <table className="sr-tbl">
                <thead>
                  <tr>
                    <th scope="col">{t("reports.summary.col.product")}</th>
                    <th scope="col">{t("reports.summary.col.preferred")}</th>
                    <th scope="col">{t("reports.summary.col.inProposals")}</th>
                    <th scope="col">{t("reports.summary.col.shareProposals")}</th>
                    <th scope="col">{t("reports.summary.col.inBuyers")}</th>
                    <th scope="col">{t("reports.summary.col.totalQty")}</th>
                  </tr>
                </thead>
                <tbody>
                  {report.products.map((p) => {
                    const name = t(`product.${p.code}`);
                    return (
                      <tr key={p.code}>
                        <th scope="row">{name}</th>
                        <td className="num">{n(p.preferred, { product: p.code }, name)}</td>
                        <td className="num">
                          {n(
                            p.amongProposals,
                            { product: p.code, within: "proposal" },
                            `${name} · ${t("reports.summary.col.inProposals")}`,
                          )}
                        </td>
                        <td className="num">{pct(p.shareOfProposals)}</td>
                        <td className="num">
                          {n(
                            p.amongBuyers,
                            { product: p.code, within: "buyer" },
                            `${name} · ${t("reports.summary.col.inBuyers")}`,
                          )}
                        </td>
                        <td className="num">
                          {p.code === "roof"
                            ? `${(p.totalAreaM2 ?? 0).toLocaleString(lang === "tr" ? "tr-TR" : "en-GB")} m²`
                            : (p.totalQty ?? 0)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="field-h">
              {t("reports.summary.closing")}{" "}
              {n(report.closingPotential, { closing: true }, t("answer.site.covered_court"))}
            </p>
          </section>

          <section aria-labelledby="sr-5">
            <h2 id="sr-5">{t("reports.summary.s5")}</h2>
            <div className="sr-wrap" tabIndex={0} role="region" aria-labelledby="sr-5">
              <table className="sr-tbl">
                <thead>
                  <tr>
                    <th scope="col">{t("answer.installTimeline")}</th>
                    <th scope="col">{t("reports.summary.col.lead")}</th>
                    <th scope="col">{t("reports.summary.col.never")}</th>
                    {showLegacy && <th scope="col">{t("summary.legacyShort")}</th>}
                    <th scope="col">{t("reports.summary.col.replied")}</th>
                    <th scope="col">{t("reports.summary.col.proposal")}</th>
                    <th scope="col">{t("reports.summary.col.neverRate")}</th>
                  </tr>
                </thead>
                <tbody>
                  {report.byInstallTimeline.map((x) => {
                    const label = t(`answer.timeline.${x.timeline ?? "none"}`);
                    const sel = { timeline: x.timeline };
                    return (
                      <tr key={x.timeline ?? "none"}>
                        <th scope="row">
                          {x.timeline === "m0_3" ? (
                            <StatusTag tone="warn" icon="flame">
                              {label} · {t("hot.short")}
                            </StatusTag>
                          ) : (
                            label
                          )}
                          {x.timeline === "m0_3" && x.neverReached > 0 && (
                            <span className="inline-warn">
                              <Icon name="warn" size={12} /> {t("reports.summary.hotWarn", { n: x.neverReached })}
                            </span>
                          )}
                        </th>
                        <td className="num">{n(x.lead, sel, label)}</td>
                        <td className="num">
                          {n(
                            x.neverReached,
                            { ...sel, metric: "neverReached" },
                            `${label} · ${t("reports.summary.col.never")}`,
                          )}
                        </td>
                        {showLegacy && (
                          <td className="num">
                            {n(
                              x.legacyNoContact,
                              { ...sel, metric: "legacyNoContact" },
                              `${label} · ${t("summary.legacyShort")}`,
                            )}
                          </td>
                        )}
                        <td className="num">
                          {n(
                            x.replied,
                            { ...sel, metric: "replied" },
                            `${label} · ${t("reports.summary.col.replied")}`,
                          )}
                        </td>
                        <td className="num">
                          {n(
                            x.proposalGiven,
                            { ...sel, metric: "proposalGiven" },
                            `${label} · ${t("reports.summary.col.proposal")}`,
                          )}
                        </td>
                        <td className="num">{pct(x.neverRate)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
