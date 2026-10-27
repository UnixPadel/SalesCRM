import { eur } from "../components/ui";
import { STAGE, countryName } from "../domain/constants";
import { isOpenDeal, isWon, pipelineByCountry, toEUR, weightedEUR, winRateByStage, wonPerMonth } from "../domain/rules";
import { useCrm } from "../state/CrmContext";

const pct = (r: number | null) => (r == null ? "—" : `%${Math.round(r * 100)}`);

export function ReportsPage() {
  const { data, countryOfDeal } = useCrm();
  const deals = data.deals;
  const months = wonPerMonth(deals, 12);
  const rates = winRateByStage(deals, data.stageChanges);
  const byCountry = pipelineByCountry(deals, countryOfDeal);

  const open = deals.filter(isOpenDeal);
  const won = deals.filter(isWon);
  const lost = deals.filter((d) => d.stage === "lost");
  const closed = won.length + lost.length;
  const thisMonth = months[months.length - 1];
  const maxMonth = Math.max(1, ...months.map((m) => m.valueEUR));
  const maxCountry = Math.max(1, ...byCountry.map((c) => c.valueEUR));
  const lostReasons = new Map<string, number>();
  lost.forEach((d) => {
    const r = (d.lost_reason || "Belirtilmemiş").split(" — ")[0];
    lostReasons.set(r, (lostReasons.get(r) || 0) + 1);
  });
  const wonMonths = months.filter((m) => m.count);

  return (
    <div className="reports">
      <section className="kpis" aria-label="Özet göstergeler">
        <Kpi
          label="Açık hat değeri"
          value={eur(open.reduce((s, d) => s + toEUR(d), 0))}
          sub={`${open.length} açık müşteri`}
        />
        <Kpi
          label="Ağırlıklı tahmin"
          value={eur(open.reduce((s, d) => s + weightedEUR(d), 0))}
          sub="Değer × kolon olasılığı"
        />
        <Kpi label="Bu ay satılan" value={eur(thisMonth.valueEUR)} sub={`${thisMonth.count} satış`} />
        <Kpi
          label="Satışa dönüşüm"
          value={closed ? pct(won.length / closed) : "—"}
          sub={`${won.length} satıldı, ${lost.length} red line`}
        />
      </section>

      <div className="rgrid">
        <section className="rcard wide" aria-labelledby="r-month">
          <h2 id="r-month">Aylık satışlar</h2>
          <p>Son 12 ay, satışın kapandığı tarihe göre, EUR karşılığı.</p>
          <ul
            className="vbars"
            role="img"
            aria-label={
              wonMonths.length
                ? "Satış olan aylar: " +
                  wonMonths.map((m) => `${m.label} ${m.count} satış ${eur(m.valueEUR)}`).join("; ")
                : "Son 12 ayda satış yok"
            }
          >
            {months.map((m) => (
              <li key={m.key} className="vbar" title={`${m.label}: ${m.count} satış, ${eur(m.valueEUR)}`}>
                <span className="vbar-v">{m.count ? `${eur(m.valueEUR, true)} · ${m.count}` : ""}</span>
                <span className="vbar-track">
                  <i style={{ blockSize: `${(m.valueEUR / maxMonth) * 100}%` }} />
                </span>
                <span className="vbar-l">{m.label}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="rcard" aria-labelledby="r-rate">
          <h2 id="r-rate">Kolona göre satışa dönüşüm</h2>
          <p>Bu kolona ulaşıp kapanan müşterilerden satışa dönüşenlerin payı.</p>
          <ul className="hbars">
            {rates.map((r) => (
              <li className="hbar" key={r.stage}>
                <span className="hbar-l">
                  {STAGE[r.stage].no}. {STAGE[r.stage].label}
                </span>
                <span className="hbar-track" aria-hidden="true">
                  <i style={{ inlineSize: `${(r.rate ?? 0) * 100}%` }} />
                </span>
                <span className="hbar-v">
                  {pct(r.rate)}
                  <small>
                    {r.won}/{r.closed} kapanan
                  </small>
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="rcard" aria-labelledby="r-country">
          <h2 id="r-country">Ülkeye göre açık hat</h2>
          <p>Açık kolonlardaki müşteriler, EUR karşılığı.</p>
          <ul className="hbars">
            {byCountry.map((c) => (
              <li className="hbar" key={c.country}>
                <span className="hbar-l">{countryName(c.country)}</span>
                <span className="hbar-track info" aria-hidden="true">
                  <i style={{ inlineSize: `${(c.valueEUR / maxCountry) * 100}%` }} />
                </span>
                <span className="hbar-v">
                  {eur(c.valueEUR, true)}
                  <small>{c.count} müşteri</small>
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="rcard" aria-labelledby="r-lost">
          <h2 id="r-lost">Red line nedenleri</h2>
          <p>Olumsuz sonuçlanan {lost.length} müşteri.</p>
          {lostReasons.size ? (
            <ul className="hbars">
              {[...lostReasons.entries()]
                .sort((a, b) => b[1] - a[1])
                .map(([r, n]) => (
                  <li className="hbar" key={r}>
                    <span className="hbar-l" title={r}>
                      {r}
                    </span>
                    <span className="hbar-track bad" aria-hidden="true">
                      <i style={{ inlineSize: `${(n / Math.max(1, lost.length)) * 100}%` }} />
                    </span>
                    <span className="hbar-v">{n} müşteri</span>
                  </li>
                ))}
            </ul>
          ) : (
            <p className="tl-empty">Red line'da müşteri yok.</p>
          )}
        </section>
      </div>
      <p className="footnote">Döviz çevrimi sabit kurla yapılır (src/domain/constants.ts → EUR_RATE).</p>
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
