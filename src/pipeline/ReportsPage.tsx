import { useEffect, useState } from "react";
import { Button, Empty, Skeleton, eur } from "../components/ui";
import { countryName } from "../domain/constants";
import { useLang } from "../i18n";
import type { ReportDto } from "../modules/sales-pipeline/api/dto";
import { pipelineApi } from "./api";
import { useErrorText, useReference } from "./hooks";
import { SummaryReport } from "./report/SummaryReport";
import { setHashParams } from "../router";

const MONTH_OPTIONS = [6, 12, 24] as const;
const PERIOD_KEY = "unixcrm.v2.reportMonths";
const TAB_KEY = "unixcrm.v2.reportTab";

/**
 * Raporlar (Faz 7g): iki sekme. "Aşama raporu" (Faz 6c) ve "Özet rapor" (Excel ÖZET RAPOR'un karşılığı).
 * `#/reports?tab=summary`; son sekme tarayıcıda hatırlanır.
 */
export function ReportsPage({ params }: { params: URLSearchParams }) {
  const { t } = useLang();
  const remembered = (() => {
    try {
      return localStorage.getItem(TAB_KEY);
    } catch {
      return null;
    }
  })();
  const tab = (params.get("tab") ?? remembered) === "summary" ? "summary" : "stage";
  const pick = (k: "stage" | "summary") => {
    try {
      localStorage.setItem(TAB_KEY, k);
    } catch {
      /* yalnız kolaylık */
    }
    setHashParams("reports", new URLSearchParams(k === "summary" ? "tab=summary" : "tab=stage"), true);
  };
  return (
    <section className="pl-page reports-page">
      <div className="tabs report-tabs" role="tablist" aria-label={t("reports.title")}>
        {(["stage", "summary"] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            className={"tab" + (tab === k ? " on" : "")}
            onClick={() => pick(k)}
          >
            {t(`reports.tab.${k}`)}
          </button>
        ))}
      </div>
      {tab === "summary" ? (
        <>
          <h1 className="pl-title">{t("reports.tab.summary")}</h1>
          <SummaryReport />
        </>
      ) : (
        <StageReport />
      )}
    </section>
  );
}

/**
 * Raporlar (Faz 6c): yeni aşama olaylarından, sunucuda hesaplanır (`GET /reports`). Dört KPI ve beş grafik:
 * aylık kazanılan, aşamaya göre dönüşüm, ülkeye göre açık hat, kayıp nedenleri, kaynağa göre lead. Boş veride de
 * çalışır: aylar sıfır çubuklarla çizilir, oranlar "—". Dönem (6 / 12 / 24 ay) tarayıcıda hatırlanır.
 */
function StageReport() {
  const { t, lang } = useLang();
  const { stageName, reasonName } = useReference();
  const errText = useErrorText();
  const [months, setMonths] = useState<number>(() => {
    try {
      const n = Number(localStorage.getItem(PERIOD_KEY));
      return (MONTH_OPTIONS as readonly number[]).includes(n) ? n : 12;
    } catch {
      return 12;
    }
  });
  const [report, setReport] = useState<ReportDto | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    pipelineApi
      .reports(months)
      .then((r) => {
        if (!alive) return;
        setReport(r);
        setError(null);
      })
      .catch((e) => alive && setError(e));
    return () => {
      alive = false;
    };
  }, [months, tick]);
  const pickMonths = (n: number) => {
    setMonths(n);
    try {
      localStorage.setItem(PERIOD_KEY, String(n));
    } catch {
      /* depolama kapalı */
    }
  };

  if (error) {
    return (
      <Empty title={errText(error)}>
        <Button onClick={() => setTick((x) => x + 1)} icon="refresh">
          {t("common.retry")}
        </Button>
      </Empty>
    );
  }
  if (!report) {
    return (
      <div className="reports" aria-busy="true">
        <div className="kpis">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} h={96} />
          ))}
        </div>
        <Skeleton h={300} />
      </div>
    );
  }

  const pct = (r: number | null) => (r === null ? "—" : `%${Math.round(r * 100)}`);
  const monthLabel = (ym: string) => {
    const [y, m] = ym.split("-").map(Number) as [number, number];
    return new Date(y, m - 1, 1).toLocaleDateString(lang === "tr" ? "tr-TR" : "en-GB", {
      month: "short",
      year: "2-digit",
    });
  };
  const { kpis } = report;
  const maxMonth = Math.max(1, ...report.wonByMonth.map((m) => m.totalEur));
  const maxCountry = Math.max(
    1,
    ...report.openByCountry.map((c) => c.totalEur),
    ...report.openByCountry.map((c) => c.count),
  );
  const lostTotal = report.lostReasons.reduce((s, r) => s + r.count, 0);
  const maxSource = Math.max(1, ...report.leadsBySource.map((s) => s.count));
  const wonMonths = report.wonByMonth.filter((m) => m.count > 0);
  const periodLabel = t("reports.period", { n: months });

  return (
    <div className="reports" aria-labelledby="reports-h">
      <div className="reports-head">
        <h1 id="reports-h" className="pl-title">
          {t("reports.title")}
        </h1>
        <div className="tabs" role="group" aria-label={t("reports.periodLabel")}>
          {MONTH_OPTIONS.map((n) => (
            <button key={n} type="button" className="chip" aria-pressed={months === n} onClick={() => pickMonths(n)}>
              {t("reports.period", { n })}
            </button>
          ))}
        </div>
      </div>

      <section className="kpis" aria-label={t("reports.kpis")}>
        <Kpi
          label={t("reports.kpi.open")}
          value={eur(kpis.openTotalEur)}
          sub={t("reports.kpi.openSub", { n: kpis.openCount })}
        />
        <Kpi
          label={t("reports.kpi.wonThisMonth")}
          value={eur(kpis.wonThisMonth.totalEur)}
          sub={t("reports.kpi.wonThisMonthSub", { n: kpis.wonThisMonth.count })}
        />
        <Kpi
          label={t("reports.kpi.winRate")}
          value={pct(kpis.winRate)}
          sub={t("reports.kpi.winRateSub", { won: kpis.closedWon, lost: kpis.closedLost })}
        />
        <Kpi
          label={t("reports.kpi.leads")}
          value={String(report.leadsBySource.reduce((s, r) => s + r.count, 0))}
          sub={periodLabel}
        />
      </section>

      <div className="rgrid">
        <section className="rcard wide" aria-labelledby="r-month">
          <h2 id="r-month">{t("reports.won.title")}</h2>
          <p>{t("reports.won.desc", { n: months })}</p>
          <ul
            className="vbars"
            style={{ gridTemplateColumns: `repeat(${report.months.length}, minmax(0, 1fr))` }}
            role="img"
            aria-label={
              wonMonths.length
                ? wonMonths.map((m) => `${monthLabel(m.month)}: ${m.count} · ${eur(m.totalEur)}`).join("; ")
                : t("reports.won.empty")
            }
          >
            {report.wonByMonth.map((m) => (
              <li key={m.month} className="vbar" title={`${monthLabel(m.month)}: ${m.count} · ${eur(m.totalEur)}`}>
                <span className="vbar-v">{m.count ? `${eur(m.totalEur, true)} · ${m.count}` : ""}</span>
                <span className="vbar-track">
                  <i style={{ blockSize: `${(m.totalEur / maxMonth) * 100}%` }} />
                </span>
                <span className="vbar-l">{monthLabel(m.month)}</span>
              </li>
            ))}
          </ul>
          {!wonMonths.length && <p className="muted">{t("reports.won.empty")}</p>}
        </section>

        <section className="rcard" aria-labelledby="r-rate">
          <h2 id="r-rate">{t("reports.conv.title")}</h2>
          <p>{t("reports.conv.desc")}</p>
          <ul className="hbars">
            {report.conversionByStage.map((r, i) => (
              <li className="hbar" key={r.stage}>
                <span className="hbar-l">
                  {i + 1}. {stageName(r.stage)}
                </span>
                <span className="hbar-track" aria-hidden="true">
                  <i style={{ inlineSize: `${(r.rate ?? 0) * 100}%` }} />
                </span>
                <span className="hbar-v">
                  {pct(r.rate)}
                  <small>{t("reports.conv.sub", { won: r.won, closed: r.closed, reached: r.reached })}</small>
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="rcard" aria-labelledby="r-country">
          <h2 id="r-country">{t("reports.country.title")}</h2>
          <p>{t("reports.country.desc")}</p>
          {report.openByCountry.length ? (
            <ul className="hbars">
              {report.openByCountry.map((c) => (
                <li className="hbar" key={c.country || "-"}>
                  <span className="hbar-l">{c.country ? countryName(c.country) : t("common.unknown")}</span>
                  <span className="hbar-track info" aria-hidden="true">
                    <i style={{ inlineSize: `${((c.totalEur || c.count) / maxCountry) * 100}%` }} />
                  </span>
                  <span className="hbar-v">
                    {eur(c.totalEur, true)}
                    <small>{t("reports.country.sub", { n: c.count })}</small>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">{t("reports.country.empty")}</p>
          )}
        </section>

        <section className="rcard" aria-labelledby="r-lost">
          <h2 id="r-lost">{t("reports.lost.title")}</h2>
          <p>{t("reports.lost.desc", { n: lostTotal })}</p>
          {report.lostReasons.length ? (
            <ul className="hbars">
              {report.lostReasons.map((r) => (
                <li className="hbar" key={r.code}>
                  <span className="hbar-l" title={reasonName(r.code)}>
                    {r.code === "unspecified" ? t("reports.lost.unspecified") : reasonName(r.code)}
                  </span>
                  <span className="hbar-track bad" aria-hidden="true">
                    <i style={{ inlineSize: `${(r.count / Math.max(1, lostTotal)) * 100}%` }} />
                  </span>
                  <span className="hbar-v">{t("reports.lost.sub", { n: r.count })}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">{t("reports.lost.empty")}</p>
          )}
        </section>

        <section className="rcard wide" aria-labelledby="r-source">
          <h2 id="r-source">{t("reports.source.title")}</h2>
          <p>{t("reports.source.desc", { n: months })}</p>
          {report.leadsBySource.length ? (
            <ul className="hbars">
              {report.leadsBySource.map((s) => (
                <li className="hbar" key={s.source}>
                  <span className="hbar-l">{t(`source.${s.source}`)}</span>
                  <span className="hbar-track" aria-hidden="true">
                    <i style={{ inlineSize: `${(s.count / maxSource) * 100}%` }} />
                  </span>
                  <span className="hbar-v">
                    {s.count}
                    <small>
                      {t("reports.source.sub", { won: s.won, pct: s.count ? Math.round((s.won / s.count) * 100) : 0 })}
                    </small>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">{t("reports.source.empty")}</p>
          )}
        </section>
      </div>
      <p className="footnote">{t("reports.footnote")}</p>
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="kpi">
      <span>{label}</span>
      <b>{value}</b>
      <small>{sub}</small>
    </div>
  );
}
