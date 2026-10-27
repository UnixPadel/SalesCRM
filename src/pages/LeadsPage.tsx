import { Fragment, useMemo, useState } from "react";
import { Avatar, Button, Empty, fmtDate, Icon, IconButton } from "../components/ui";
import { LEAD_SOURCES, LEAD_SOURCE_LABEL, URGENCY_LABEL, countryName } from "../domain/constants";
import type { Lead, LeadSource, LeadStatus, TouchState, Urgency } from "../domain/types";
import { convertLead, updateLead } from "../services/crmService";
import { useCrm } from "../state/CrmContext";

const PAGE = 50;
const FLAG_TEXT: Record<string, string> = {
  country_mismatch: "Telefon ülke kodu form ülkesiyle uyuşmuyor, aramadan önce doğrulayın",
  no_dial_code: "Telefonda ülke kodu yok ya da eksik",
  dial_code_added: "Ülke kodu otomatik eklendi, ilk aramada doğrulayın",
  no_phone: "Telefon yok, yalnız e-posta",
};
const URG_ORDER: Record<string, number> = { asap: 0, m13: 1, m36: 2, m612: 3, "": 4 };
const URGENCIES: Urgency[] = ["asap", "m13", "m36", "m612", ""];
const STATUS_TABS: [LeadStatus, string][] = [
  ["new", "Yeni"],
  ["qualified", "Panoya alındı"],
  ["discarded", "Elenen"],
];

export function LeadsPage({ initialQuery = "" }: { initialQuery?: string }) {
  const { data, contactById, me, run, openDeal, markFresh, owners } = useCrm();
  const [status, setStatus] = useState<LeadStatus>("new");
  const [q, setQ] = useState(initialQuery);
  // "mine" = my forms + the untagged pool; "pool" = untagged only; "" = everyone; otherwise one rep's name.
  const [owner, setOwner] = useState<string>(initialQuery ? "" : "mine");
  const [urgency, setUrgency] = useState<Urgency | null>(null);
  const [source, setSource] = useState<LeadSource | "">("");
  const [country, setCountry] = useState("");
  const [sort, setSort] = useState<"urgency" | "date">("urgency");
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const base = useMemo(() => {
    const s = q.trim().toLocaleLowerCase("tr");
    return data.leads.filter((l) => {
      if (owner === "mine" ? l.owner && l.owner !== me : owner === "pool" ? !!l.owner : owner && l.owner !== owner)
        return false;
      if (source && l.source !== source) return false;
      const c = contactById.get(l.contact_id);
      if (country && c?.country !== country) return false;
      if (urgency !== null && l.urgency !== urgency) return false;
      if (s && !`${c?.name} ${c?.email} ${c?.phone} ${l.location} ${l.product}`.toLocaleLowerCase("tr").includes(s))
        return false;
      return true;
    });
  }, [data.leads, contactById, owner, source, country, urgency, q]);

  const counts = { new: 0, qualified: 0, discarded: 0 } as Record<LeadStatus, number>;
  base.forEach((l) => counts[l.status]++);
  const list = base
    .filter((l) => l.status === status)
    .sort((a, b) =>
      sort === "date"
        ? b.created_at.localeCompare(a.created_at)
        : URG_ORDER[a.urgency] - URG_ORDER[b.urgency] || b.created_at.localeCompare(a.created_at),
    );
  const pages = Math.max(1, Math.ceil(list.length / PAGE));
  const pg = Math.min(page, pages - 1);
  const shown = list.slice(pg * PAGE, pg * PAGE + PAGE);

  const countries = useMemo(() => {
    const m = new Map<string, number>();
    data.leads.forEach((l) => {
      const c = contactById.get(l.contact_id)?.country || "";
      m.set(c, (m.get(c) || 0) + 1);
    });
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [data.leads, contactById]);

  const reset = (fn: () => void) => {
    fn();
    setPage(0);
  };
  const convert = async (l: Lead) => {
    setBusy(l.id);
    const deal = await run((repo) => convertLead(repo, l.id, me), "Müşteri panoya alındı: 1. İletişime geçildi");
    setBusy(null);
    if (deal) {
      markFresh(deal.id);
      openDeal(deal.id);
    }
  };
  const patch = (l: Lead, p: Partial<Lead>, msg: string) => run((repo) => updateLead(repo, l.id, p), msg);
  const discard = (l: Lead) =>
    run(
      (repo) => updateLead(repo, l.id, { status: "discarded" }),
      () => ({
        msg: `${contactById.get(l.contact_id)?.name ?? "Lead"} elendi`,
        action: { label: "Geri al", run: () => patch(l, { status: "new" }, "Lead geri alındı") },
      }),
    );

  // Active secondary filters shown as removable chips (they live in the "Filtreler" disclosure).
  const active: { label: string; clear: () => void }[] = [];
  if (source) active.push({ label: `Kaynak: ${LEAD_SOURCE_LABEL[source]}`, clear: () => reset(() => setSource("")) });
  if (country) active.push({ label: `Ülke: ${countryName(country)}`, clear: () => reset(() => setCountry("")) });
  if (sort === "date") active.push({ label: "Sıralama: en yeni", clear: () => setSort("urgency") });

  return (
    <div className="leads">
      <div className="toolbar">
        <div className="tabs" role="tablist" aria-label="Lead durumu">
          {STATUS_TABS.map(([k, label]) => (
            <button
              key={k}
              role="tab"
              aria-selected={status === k}
              className="tab"
              onClick={() => reset(() => setStatus(k))}
            >
              {label} <span className="count">{counts[k]}</span>
            </button>
          ))}
        </div>
        <div className="filters">
          <label className="searchfield">
            <Icon name="search" size={14} />
            <span className="sr-only">Leadlerde ara</span>
            <input
              type="search"
              placeholder="İsim, e-posta, telefon…"
              value={q}
              onChange={(e) => reset(() => setQ(e.target.value))}
            />
          </label>
          <select
            value={owner}
            onChange={(e) => reset(() => setOwner(e.target.value))}
            aria-label="Satışçıya göre filtrele"
          >
            <option value="mine">Benim + havuz</option>
            <option value="pool">Yalnız havuz (atanmamış)</option>
            <option value="">Tüm ekip</option>
            {owners.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
          <details className="more-filters">
            <summary className="btn btn-sec btn-md">
              <Icon name="filter" /> Filtreler{active.length ? ` (${active.length})` : ""}
            </summary>
            <div className="pop">
              <label className="field">
                <span className="field-l">Kaynak</span>
                <select value={source} onChange={(e) => reset(() => setSource(e.target.value as LeadSource))}>
                  <option value="">Tümü</option>
                  {LEAD_SOURCES.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="field-l">Ülke</span>
                <select value={country} onChange={(e) => reset(() => setCountry(e.target.value))}>
                  <option value="">Tümü</option>
                  {countries.map(([c, n]) => (
                    <option key={c} value={c}>
                      {countryName(c)} ({n})
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="field-l">Sıralama</span>
                <select value={sort} onChange={(e) => setSort(e.target.value as "urgency" | "date")}>
                  <option value="urgency">Aciliyete göre</option>
                  <option value="date">En yeni önce</option>
                </select>
              </label>
            </div>
          </details>
        </div>
      </div>

      <div className="toolbar" style={{ borderBlockEnd: 0, paddingBlockEnd: 0, background: "transparent" }}>
        <div className="filters" role="group" aria-label="Aciliyet">
          {URGENCIES.map((u) => (
            <button
              key={u || "none"}
              className="chip"
              aria-pressed={urgency === u}
              onClick={() => reset(() => setUrgency(urgency === u ? null : u))}
            >
              {URGENCY_LABEL[u]}
            </button>
          ))}
          {active.map((a) => (
            <button key={a.label} className="afchip" onClick={a.clear} aria-label={`${a.label} filtresini kaldır`}>
              {a.label} <Icon name="x" size={14} />
            </button>
          ))}
        </div>
      </div>

      {!shown.length ? (
        <Empty title={status === "new" && !q && !owner ? "Gelen form yok" : "Bu filtreye uyan form yok"}>
          {status === "new"
            ? "Filtreleri gevşetin ya da Panoya alındı sekmesine bakın."
            : "Başka bir sekmeye geçin ya da filtreleri temizleyin."}
        </Empty>
      ) : (
        <div className="table-wrap">
          <table className="tbl">
            <caption className="sr-only">
              {STATUS_TABS.find((t) => t[0] === status)![1]} formlar, {list.length} kayıt
            </caption>
            <thead>
              <tr>
                <th scope="col">Kişi</th>
                <th scope="col">Ülke</th>
                <th scope="col">İhtiyaç</th>
                <th scope="col">Kaynak / sahip</th>
                <th scope="col">Tarih</th>
                <th scope="col">
                  <span className="sr-only">İşlemler</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((l) => {
                const c = contactById.get(l.contact_id);
                const open = expanded === l.id;
                const detailId = `lead-d-${l.id}`;
                return (
                  <Fragment key={l.id}>
                    <tr className={open ? "is-open" : ""}>
                      <td>
                        <div className="who">
                          <b>
                            {c?.name}
                            {l.submissions > 1 && <span className="tag">{l.submissions}. başvuru</span>}
                            {l.flags.length > 0 && (
                              <span className="flag" title={l.flags.map((f) => FLAG_TEXT[f] || f).join("\n")}>
                                <Icon name="warn" size={14} />
                                <span className="sr-only">Veri uyarısı</span>
                              </span>
                            )}
                          </b>
                          <span>{c?.email || c?.phone}</span>
                        </div>
                      </td>
                      <td>{countryName(c?.country || "")}</td>
                      <td>
                        <div className="need">
                          <span>
                            {l.product}
                            {l.court_count ? ` · ${l.court_count} kort` : ""}
                          </span>
                          <span>
                            <span className={"pill u-" + (l.urgency || "none")}>{URGENCY_LABEL[l.urgency]}</span>
                          </span>
                        </div>
                      </td>
                      <td>
                        <div className="srcown">
                          {l.owner ? <Avatar name={l.owner} size={24} /> : <span className="muted">Atanmadı</span>}
                          <span>{LEAD_SOURCE_LABEL[l.source]}</span>
                        </div>
                      </td>
                      <td className="mono">{fmtDate(l.created_at)}</td>
                      <td>
                        <div className="row-actions">
                          {l.status === "qualified" && l.deal_id ? (
                            <Button size="sm" icon="pipeline" onClick={() => openDeal(l.deal_id!)}>
                              Kartı aç
                            </Button>
                          ) : l.status === "discarded" ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => patch(l, { status: "new" }, "Lead geri alındı")}
                            >
                              Gelen kutusuna al
                            </Button>
                          ) : (
                            <>
                              <Button
                                size="sm"
                                variant="pri"
                                icon="arrow"
                                loading={busy === l.id}
                                onClick={() => convert(l)}
                                title="Müşteriyle iletişime geçtiniz: kartı panoya ekler"
                              >
                                Panoya al
                              </Button>
                              <IconButton
                                icon="ban"
                                label={`${c?.name ?? "Lead"} adlı lead'i ele`}
                                onClick={() => discard(l)}
                              />
                            </>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-expanded={open}
                            aria-controls={detailId}
                            onClick={() => setExpanded(open ? null : l.id)}
                          >
                            Detay <Icon name="chevron" size={14} />
                          </Button>
                        </div>
                      </td>
                    </tr>
                    {open && (
                      <tr className="detail-row" id={detailId}>
                        <td colSpan={6}>
                          <div className="detail-grid">
                            <div>
                              <span className="field-l">İletişim</span>
                              {c?.email && <a href={`mailto:${c.email}`}>{c.email}</a>}
                              {c?.phone && (
                                <a
                                  href={`https://wa.me/${c.phone.replace(/\D/g, "")}`}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  {c.phone} · WhatsApp
                                </a>
                              )}
                              <span className="muted">{l.location || "Konum yok"}</span>
                            </div>
                            <div>
                              <span className="field-l">Kampanya</span>
                              <span>{l.campaign || "—"}</span>
                              {l.flags.map((f) => (
                                <span key={f} className="flagtxt">
                                  <Icon name="warn" size={14} /> {FLAG_TEXT[f] || f}
                                </span>
                              ))}
                            </div>
                            <div>
                              <span className="field-l">Temas durumu</span>
                              <div className="touch">
                                <TouchSelect
                                  label="Mail"
                                  v={l.mail}
                                  yes="sent"
                                  onSet={(v) => patch(l, { mail: v }, "Mail durumu güncellendi")}
                                />
                                <TouchSelect
                                  label="Telefon"
                                  v={l.phone_call}
                                  yes="ok"
                                  onSet={(v) => patch(l, { phone_call: v }, "Telefon durumu güncellendi")}
                                />
                                <TouchSelect
                                  label="WhatsApp"
                                  v={l.whatsapp}
                                  yes="ok"
                                  onSet={(v) => patch(l, { whatsapp: v }, "WhatsApp durumu güncellendi")}
                                />
                              </div>
                            </div>
                            <label className="field">
                              <span className="field-l">Sorumlu</span>
                              <select
                                value={l.owner}
                                onChange={(e) => patch(l, { owner: e.target.value }, "Sorumlu değişti")}
                              >
                                <option value="">Ortak havuz (atanmamış)</option>
                                {owners.map((o) => (
                                  <option key={o}>{o}</option>
                                ))}
                              </select>
                            </label>
                            {l.form_answers && (
                              <div className="detail-wide">
                                <span className="field-l">Form cevapları</span>
                                <code>{l.form_answers}</code>
                              </div>
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
      )}
      {pages > 1 && (
        <nav className="pager" aria-label="Sayfalama">
          <Button size="sm" icon="arrowL" disabled={pg === 0} onClick={() => setPage(pg - 1)}>
            Önceki
          </Button>
          <span aria-live="polite">
            {pg * PAGE + 1}–{Math.min(list.length, pg * PAGE + PAGE)} / {list.length}
          </span>
          <Button size="sm" disabled={pg >= pages - 1} onClick={() => setPage(pg + 1)}>
            Sonraki <Icon name="arrow" />
          </Button>
        </nav>
      )}
    </div>
  );
}

function TouchSelect({
  label,
  v,
  yes,
  onSet,
}: {
  label: string;
  v: TouchState;
  yes: TouchState;
  onSet: (v: TouchState) => void;
}) {
  const id = `touch-${label}`;
  return (
    <>
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        value={v === yes ? "yes" : v === "fail" ? "fail" : "none"}
        onChange={(e) => onSet(e.target.value === "yes" ? yes : (e.target.value as TouchState))}
      >
        <option value="none">Henüz yok</option>
        <option value="yes">{yes === "sent" ? "Gönderildi" : "Ulaşıldı"}</option>
        <option value="fail">{yes === "sent" ? "Gönderilemedi" : "Ulaşılamadı"}</option>
      </select>
    </>
  );
}
