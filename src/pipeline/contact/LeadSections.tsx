import { useState, type ReactNode } from "react";
import { Button, Icon, StatusTag, type Tone } from "../../components/ui";
import { useLang } from "../../i18n";
import type { LeadDto, LeadListDto, ProductPrefsDto, UpdateLeadBody } from "../../modules/sales-pipeline/api/dto";
import { useCrm } from "../../state/CrmContext";
import { pipelineApi } from "../api";
import { extraAnswerRows } from "../extraAnswersView";
import { useErrorText, useNow, useReference } from "../hooks";
import { contactApi } from "./contactApi";
import { courtLine, dateText, daysAgo, productLine, roofArea, warningText } from "./trackingView";

/**
 * Lead sayfasının Faz 7g bölümleri: Temas özeti (Excel H–M, Z–AB), Müşteri (N), Ürün tercihleri (P–Y), Form
 * cevapları (AD–AI), Veri uyarıları (AJ ve sarı hücreler), Kaynak detayı. Excel'in sütun grupları burada bloktur.
 */

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="fact-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

const STATUS_TONE: Record<string, Tone> = {
  interested: "info",
  not_interested: "bad",
  project_phase: "neutral",
  collecting_prices: "warn",
  buyer_ready: "ok",
};
const STATUS_ICON: Record<string, string> = {
  interested: "checkCircle",
  not_interested: "ban",
  project_phase: "ruler",
  collecting_prices: "tag",
  buyer_ready: "star",
};

/** Müşteri durumu etiketi: ikon + metin (renk tek başına anlam taşımaz). */
export function CustomerStatusTag({ status }: { status: string | null }) {
  const { t } = useLang();
  if (!status) return <span className="muted">{t("customerStatus.none")}</span>;
  return (
    <StatusTag tone={STATUS_TONE[status] ?? "neutral"} icon={STATUS_ICON[status] ?? "tag"}>
      {t(`customerStatus.${status}`)}
    </StatusTag>
  );
}

export function ContactSummaryPanel({ lead, isAdmin }: { lead: LeadListDto; isAdmin: boolean }) {
  const { t, lang } = useLang();
  const c = lead.contact;
  const now = useNow(60_000);
  const channel = (key: "email" | "whatsapp") => {
    const f = c.channels[key];
    if (!f) return <span className="muted">{t("summary.notSent")}</span>;
    const last = new Date(f.lastAt).toLocaleDateString(lang === "tr" ? "tr-TR" : "en-GB", {
      day: "2-digit",
      month: "2-digit",
    });
    const reply = f.firstReplyAt
      ? t("summary.reply", { d: dateText(f.firstReplyAt, f.firstReplyEstimated, t, lang) })
      : t("summary.noReply");
    return (
      <>
        {t("summary.channel", { n: f.count, last })} · {reply}
      </>
    );
  };
  const others = (["call", "meeting", "site_visit", "proposal_sent", "other"] as const)
    .filter((k) => c.channels[k])
    .map((k) => `${t(`activity.type.${k}`)} ${c.channels[k]!.count}`)
    .join(" · ");
  return (
    <div className="panel" aria-labelledby="cs-h">
      <h2 className="sec-h" id="cs-h">
        {t("summary.title")}
      </h2>
      {c.state === "never" ? (
        <p>
          <StatusTag tone="bad" icon="warn">
            {t("summary.never")}
          </StatusTag>
        </p>
      ) : c.state === "legacy" ? (
        <p className="muted">{t("summary.legacy")}</p>
      ) : null}
      <dl className="facts-dl facts-2">
        <Fact label={t("summary.first")}>{c.firstAt ? dateText(c.firstAt, c.firstAtEstimated, t, lang) : "—"}</Fact>
        <Fact label={t("summary.last")}>
          {c.lastAt ? `${dateText(c.lastAt, c.lastAtEstimated, t, lang)} · ${daysAgo(c.lastAt, now, lang)}` : "—"}
        </Fact>
        <Fact label={t("summary.count")}>{c.count}</Fact>
        <Fact label={t("summary.email")}>{channel("email")}</Fact>
        <Fact label={t("summary.whatsapp")}>{channel("whatsapp")}</Fact>
        {others && <Fact label={t("summary.other")}>{others}</Fact>}
        <Fact label={t("summary.proposal")}>
          {lead.proposal.given ? (
            <span title={isAdmin && lead.proposal.via ? lead.proposal.via : undefined}>
              {lead.proposal.at
                ? t("summary.proposalGiven", { d: dateText(lead.proposal.at, false, t, lang) })
                : t("common.yes")}
            </span>
          ) : (
            <span className="muted">{t("summary.proposalNo")}</span>
          )}
        </Fact>
      </dl>
    </div>
  );
}

/** Müşteri durumu (D1): sahip, havuzda satışçı (lead ona atanır) ve yönetici değiştirir. */
export function CustomerStatusField({
  lead,
  canSet,
  onSaved,
}: {
  lead: LeadDto;
  canSet: boolean;
  onSaved: (l: LeadDto) => void;
}) {
  const { t } = useLang();
  const { ref } = useReference();
  const { toast, isAdmin } = useCrm();
  const errText = useErrorText();
  const [busy, setBusy] = useState(false);
  const save = async (v: string) => {
    setBusy(true);
    try {
      const l = await contactApi.setStatus(lead.id, v || null);
      toast(t("customerStatus.saved"));
      onSaved(l);
    } catch (e) {
      toast(errText(e), { bad: true });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="panel" aria-labelledby="st-h">
      <h2 className="sec-h" id="st-h">
        {t("customerStatus.label")}
      </h2>
      {canSet && ref ? (
        <label className="field">
          <span className="sr-only">{t("customerStatus.label")}</span>
          <select value={lead.customerStatus ?? ""} disabled={busy} onChange={(e) => save(e.target.value)}>
            <option value="">{t("customerStatus.none")}</option>
            {ref.customerStatuses.map((s) => (
              <option key={s.code} value={s.code}>
                {t(`customerStatus.${s.code}`)}
              </option>
            ))}
          </select>
          <span className="field-h">
            {t("customerStatus.help")}
            {!isAdmin && !lead.assignedUserId ? ` ${t("customerStatus.poolAssigns")}` : ""}
          </span>
          {lead.customerStatus === "not_interested" && <span className="field-h">{t("customerStatus.lostHint")}</span>}
        </label>
      ) : (
        <>
          <CustomerStatusTag status={lead.customerStatus} />
          <p className="field-h">{t("customerStatus.ownerOnly")}</p>
        </>
      )}
    </div>
  );
}

const COURTS = [
  { key: "standard", code: "standard" },
  { key: "panoramic", code: "panoramic" },
  { key: "fullPanoramic", code: "full_panoramic" },
] as const;

/** Ürün tercihleri düzenleyicisi (Excel P–X sırası): ✔ + adet (1–29), Kapatma + genişlik × uzunluk. */
export function ProductPrefsForm({
  value,
  onChange,
}: {
  value: ProductPrefsDto;
  onChange: (p: ProductPrefsDto) => void;
}) {
  const { t, lang } = useLang();
  const [dims, setDims] = useState({
    w: value.roof.widthM === null ? "" : String(value.roof.widthM).replace(".", lang === "tr" ? "," : "."),
    l: value.roof.lengthM === null ? "" : String(value.roof.lengthM).replace(".", lang === "tr" ? "," : "."),
  });
  const parseDim = (s: string) => {
    const n = Number(s.trim().replace(",", "."));
    return s.trim() === "" || !Number.isFinite(n) || n <= 0 ? null : Math.round(n * 100) / 100;
  };
  const area = roofArea(value);
  return (
    <div className="pp">
      {COURTS.map(({ key, code }) => {
        const qty = value[key];
        const name = t(`product.${code}`);
        const set = (q: number | null) => onChange({ ...value, [key]: q });
        return (
          <div key={key} className="pp-row">
            <label className="cd-check">
              <input type="checkbox" checked={qty !== null} onChange={(e) => set(e.target.checked ? 1 : null)} />
              {name}
            </label>
            {qty !== null && (
              <span className="stepper">
                <button type="button" aria-label={`${name} −`} disabled={qty <= 1} onClick={() => set(qty - 1)}>
                  −
                </button>
                <input
                  inputMode="numeric"
                  aria-label={t("product.qty", { name })}
                  value={qty}
                  onChange={(e) => {
                    const n = Math.round(Number(e.target.value));
                    if (Number.isFinite(n)) set(Math.min(29, Math.max(1, n)));
                  }}
                />
                <button type="button" aria-label={`${name} +`} disabled={qty >= 29} onClick={() => set(qty + 1)}>
                  +
                </button>
              </span>
            )}
          </div>
        );
      })}
      <div className="pp-row">
        <label className="cd-check">
          <input
            type="checkbox"
            checked={value.roof.wanted}
            onChange={(e) =>
              onChange({
                ...value,
                roof: e.target.checked
                  ? { ...value.roof, wanted: true }
                  : { wanted: false, widthM: null, lengthM: null },
              })
            }
          />
          {t("product.roof")}
        </label>
        {value.roof.wanted && (
          <span className="pp-dims">
            {(["w", "l"] as const).map((k) => (
              <label key={k} className="pp-dim">
                <span className="sr-only">{k === "w" ? t("product.width") : t("product.length")}</span>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder={k === "w" ? t("product.width") : t("product.length")}
                  value={dims[k]}
                  onChange={(e) => {
                    const next = { ...dims, [k]: e.target.value };
                    setDims(next);
                    onChange({ ...value, roof: { wanted: true, widthM: parseDim(next.w), lengthM: parseDim(next.l) } });
                  }}
                />
                <span aria-hidden="true">m</span>
              </label>
            ))}
          </span>
        )}
      </div>
      {area !== null && (
        <p className="field-h">{t("product.area", { area: area.toLocaleString(lang === "tr" ? "tr-TR" : "en-GB") })}</p>
      )}
    </div>
  );
}

export function ProductsPanel({
  lead,
  canEdit,
  onSaved,
}: {
  lead: LeadListDto;
  canEdit: boolean;
  onSaved: (l: LeadDto) => void;
}) {
  const { t, lang } = useLang();
  const { toast } = useCrm();
  const errText = useErrorText();
  const [draft, setDraft] = useState<ProductPrefsDto | null>(null);
  const [busy, setBusy] = useState(false);
  const line = productLine(lead.products, t, lang);
  const courts = courtLine(lead, t);
  const roofWarn = lead.warnings.find((w) => w.code === "roof_size_missing" && !w.checked);
  const save = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      const l = await pipelineApi.update(lead.id, { products: draft } as UpdateLeadBody);
      toast(t("product.saved"));
      setDraft(null);
      onSaved(l);
    } catch (e) {
      toast(errText(e), { bad: true });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="panel" aria-labelledby="pp-h">
      <h2 className="sec-h" id="pp-h">
        {t("product.title")}
        {canEdit && !draft && (
          <span className="end">
            <Button size="sm" icon="edit" onClick={() => setDraft(structuredClone(lead.products))}>
              {t("lead.edit")}
            </Button>
          </span>
        )}
      </h2>
      {draft ? (
        <>
          <ProductPrefsForm value={draft} onChange={setDraft} />
          <div className="form-actions">
            <Button onClick={() => setDraft(null)}>{t("common.cancel")}</Button>
            <Button variant="pri" loading={busy} onClick={save}>
              {t("common.save")}
            </Button>
          </div>
        </>
      ) : (
        <>
          <p>{line || <span className="muted">{t("product.none")}</span>}</p>
          {courts && <p className="muted">{courts}</p>}
          {roofWarn && (
            <p className="inline-warn">
              <Icon name="warn" size={14} /> {t("warning.roof_size_missing")}
            </p>
          )}
          {lead.courtModel && <p className="muted">{t("product.legacyModel", { model: lead.courtModel })}</p>}
          {lead.productInterest && (
            <p className="muted">
              {t("lead.product")}: {lead.productInterest}
            </p>
          )}
          {!canEdit && <p className="field-h">{t("product.adminOnly")}</p>}
        </>
      )}
    </div>
  );
}

type AnswerKey = "installSite" | "installTimeline" | "customerProfile" | "courtCountBand";
const ANSWER_LIST: {
  key: AnswerKey;
  label: string;
  prefix: string;
  ref: "installSites" | "installTimelines" | "customerProfiles" | "courtCountBands";
}[] = [
  { key: "installSite", label: "answer.installSite", prefix: "answer.site", ref: "installSites" },
  { key: "installTimeline", label: "answer.installTimeline", prefix: "answer.timeline", ref: "installTimelines" },
  { key: "customerProfile", label: "answer.customerProfile", prefix: "answer.profile", ref: "customerProfiles" },
  { key: "courtCountBand", label: "answer.courtCountBand", prefix: "answer.band", ref: "courtCountBands" },
];

export function FormAnswersPanel({
  lead,
  canEdit,
  onSaved,
}: {
  lead: LeadListDto;
  canEdit: boolean;
  onSaved: (l: LeadDto) => void;
}) {
  const { t } = useLang();
  const { ref } = useReference();
  const { toast } = useCrm();
  const errText = useErrorText();
  const [draft, setDraft] = useState<Record<AnswerKey, string> | null>(null);
  const [busy, setBusy] = useState(false);
  const codes = (k: (typeof ANSWER_LIST)[number]["ref"]): string[] =>
    (ref?.[k] ?? []).map((x) => (typeof x === "string" ? x : x.code));
  const save = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      const body = Object.fromEntries(Object.entries(draft).map(([k, v]) => [k, v || null])) as UpdateLeadBody;
      const l = await pipelineApi.update(lead.id, body);
      setDraft(null);
      onSaved(l);
    } catch (e) {
      toast(errText(e), { bad: true });
    } finally {
      setBusy(false);
    }
  };
  const surface = lead.adSurface ? t(`surface.${lead.adSurface}`) : "—";
  return (
    <div className="panel" aria-labelledby="fa-h">
      <h2 className="sec-h" id="fa-h">
        {t("answer.title")}
        {canEdit && !draft && (
          <span className="end">
            <Button
              size="sm"
              icon="edit"
              onClick={() =>
                setDraft({
                  installSite: lead.installSite ?? "",
                  installTimeline: lead.installTimeline ?? "",
                  customerProfile: lead.customerProfile ?? "",
                  courtCountBand: lead.courtCountBand ?? "",
                })
              }
            >
              {t("lead.edit")}
            </Button>
          </span>
        )}
      </h2>
      {draft ? (
        <>
          {ANSWER_LIST.map((a) => (
            <label key={a.key} className="field">
              <span className="field-l">{t(a.label)}</span>
              <select value={draft[a.key]} onChange={(e) => setDraft({ ...draft, [a.key]: e.target.value })}>
                <option value="">—</option>
                {codes(a.ref).map((c) => (
                  <option key={c} value={c}>
                    {t(`${a.prefix}.${c}`)}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <div className="form-actions">
            <Button onClick={() => setDraft(null)}>{t("common.cancel")}</Button>
            <Button variant="pri" loading={busy} onClick={save}>
              {t("common.save")}
            </Button>
          </div>
        </>
      ) : (
        <dl className="facts-dl">
          {ANSWER_LIST.map((a) => {
            const v = lead[a.key];
            return (
              <Fact key={a.key} label={t(a.label)}>
                {v ? (
                  a.key === "installTimeline" && v === "m0_3" ? (
                    <StatusTag tone="warn" icon="flame">
                      {t(`${a.prefix}.${v}`)} · {t("hot.short")}
                    </StatusTag>
                  ) : (
                    t(`${a.prefix}.${v}`)
                  )
                ) : (
                  "—"
                )}
              </Fact>
            );
          })}
          <Fact label={t("answer.adSurface")}>{surface.startsWith("surface.") ? lead.adSurface : surface}</Fact>
          <Fact label={t("answer.campaign")}>{lead.campaign.campaignName || "—"}</Fact>
        </dl>
      )}
    </div>
  );
}

/** Yöneticide sarı ortak bölge: uyarı listesi, "Kontrol edildi", katlı "Kontrol edilenler". */
export function WarningsPanel({ lead, onChanged }: { lead: LeadListDto; onChanged: (l: LeadDto) => void }) {
  const { t } = useLang();
  const { stageName } = useReference();
  const { toast } = useCrm();
  const errText = useErrorText();
  const open = lead.warnings.filter((w) => !w.checked);
  const checked = lead.warnings.filter((w) => w.checked);
  if (!lead.warnings.length) return null;
  const set = async (code: string, value: boolean) => {
    try {
      onChanged(await contactApi.checkWarning(lead.id, code, value));
    } catch (e) {
      toast(errText(e), { bad: true });
    }
  };
  const warnCount = open.filter((w) => w.severity === "warn").length;
  return (
    <details className="warn-zone" open={warnCount > 0}>
      <summary>
        <Icon name="warn" size={16} /> {t("warning.title", { n: open.length })}
      </summary>
      <ul>
        {open.map((w) => (
          <li key={w.code} className={w.severity === "info" ? "info" : ""}>
            <Icon name={w.severity === "info" ? "info" : "warn"} size={14} />
            <span>{warningText(w, t, stageName)}</span>
            <Button size="sm" onClick={() => set(w.code, true)}>
              {t("warning.check")}
            </Button>
          </li>
        ))}
      </ul>
      {checked.length > 0 && (
        <details>
          <summary>{t("warning.checkedList", { n: checked.length })}</summary>
          <ul>
            {checked.map((w) => (
              <li key={w.code} className="muted">
                <Icon name="check" size={14} />
                <span>{warningText(w, t, stageName)}</span>
                <button type="button" className="link-btn" onClick={() => set(w.code, false)}>
                  {t("warning.uncheck")}
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </details>
  );
}

/** Satışçıya telefonun yanında gösterilen uyarılar (panel yok) [U-I18]. */
export function InlinePhoneWarnings({ lead }: { lead: LeadListDto }) {
  const { t } = useLang();
  const ws = lead.warnings.filter(
    (w) => (w.code === "phone_country_mismatch" || w.code === "phone_invalid") && !w.checked,
  );
  if (!ws.length) return null;
  return (
    <>
      {ws.map((w) => (
        <p key={w.code} className="inline-warn">
          <Icon name="warn" size={14} /> {warningText(w, t)}
        </p>
      ))}
    </>
  );
}

export function SourceDetail({ lead }: { lead: LeadListDto }) {
  const { t } = useLang();
  const rows = extraAnswerRows(lead.extraAnswers);
  if (!lead.platformLeadId && !lead.campaign.campaignName && rows.length === 0) return null;
  return (
    <details className="panel">
      <summary className="sec-h">{t("lead.sourceDetail")}</summary>
      <dl className="facts-dl">
        {lead.platformLeadId && (
          <Fact label={t("lead.platformId")}>
            <code>{lead.platformLeadId}</code>
          </Fact>
        )}
        {lead.campaign.adsetName && <Fact label={t("lead.adset")}>{lead.campaign.adsetName}</Fact>}
        {lead.campaign.adName && <Fact label={t("lead.ad")}>{lead.campaign.adName}</Fact>}
        {rows.map((r) => (
          <Fact key={r.key} label={r.labelKey ? t(r.label) : r.label}>
            {r.value}
          </Fact>
        ))}
      </dl>
    </details>
  );
}
