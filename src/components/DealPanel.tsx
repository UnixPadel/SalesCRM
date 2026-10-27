import { useEffect, useId, useRef, useState } from "react";
import {
  ACTIVITY_LABEL,
  ACTIVITY_TYPES,
  COURT_MODELS,
  CURRENCIES,
  LANGUAGE_NAME,
  ORG_TYPE_LABEL,
  STAGE,
  countryName,
  flagOf,
} from "../domain/constants";
import { activityBucket, daysSince, isOpenDeal, isRotting, isWon, localDate } from "../domain/rules";
import type { Activity, ActivityType, Currency, Deal, StageKey } from "../domain/types";
import { dealStatus } from "../pages/dealStatus";
import {
  addActivity,
  assignDeal,
  defaultSubject,
  deleteActivity,
  deleteDeal,
  setActivityDone,
  setWon,
  updateContact,
  updateDeal,
} from "../services/crmService";
import { useCrm } from "../state/CrmContext";
import { Stations } from "./Stations";
import { Avatar, Button, Field, fmtDate, Icon, IconButton, money, relDays, StatusTag } from "./ui";
import { useStageMover } from "./useStageMover";

const TYPE_ICON = Object.fromEntries(ACTIVITY_TYPES.map((a) => [a.key, a.icon])) as Record<ActivityType, string>;

/** Other screens can ask the drawer to open with the activity composer expanded. */
const composeRequests = new Set<string>();
export const requestCompose = (dealId: string) => composeRequests.add(dealId);

type Tab = "steps" | "info" | "notes";

/**
 * Customer drawer. Reads top-down in four short bands, then one tab at a time:
 *   who + where they are on the journey + what to do now
 *   → the journey line (click a station to move)
 *   → identity card: contact, big call / WhatsApp / e-mail buttons, key facts
 *   → tabs: Adımlar · Bilgiler · Notlar  (E-postalar sekmesi MAIL_ENABLED ile geri gelir)
 */
export function DealPanel({ dealId }: { dealId: string }) {
  const { data, orgById, contactById, openDeal, run, freshDeals, me, isAdmin, canEdit, owners } = useCrm();
  const { move, dialog } = useStageMover();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const deal = data.deals.find((d) => d.id === dealId);
  const [composing, setComposing] = useState(() => composeRequests.has(dealId) || freshDeals.has(dealId));
  const [promptNext, setPromptNext] = useState(false);
  const [tab, setTab] = useState<Tab>("steps");

  useEffect(() => {
    const dlg = ref.current;
    const opener = document.activeElement as HTMLElement | null;
    if (dlg && !dlg.open) dlg.showModal();
    composeRequests.delete(dealId);
    return () => {
      if (dlg?.open) dlg.close();
      opener?.focus?.();
    };
  }, [dealId]);

  if (!deal) return null;
  const org = deal.organization_id ? orgById.get(deal.organization_id) : undefined;
  const contact = deal.contact_id ? contactById.get(deal.contact_id) : undefined;
  const country = org?.country || contact?.country || "";
  const acts = data.activities.filter((a) => a.deal_id === deal.id);
  const openActs = acts.filter((a) => !a.done);
  const overdue = openActs.filter((a) => activityBucket(a) === "overdue").length;
  const changes = data.stageChanges
    .filter((c) => c.deal_id === deal.id)
    .sort((a, b) => a.changed_at.localeCompare(b.changed_at));
  const rotting = isRotting(deal, data.activities);
  const won = isWon(deal);
  const editable = canEdit(deal.owner);
  const status = dealStatus(deal, data.activities);
  const close = () => openDeal(null);
  const save = (patch: Parameters<typeof updateDeal>[2], msg = "Kaydedildi") =>
    run((repo) => updateDeal(repo, deal.id, patch), msg);

  const toggle = async (a: Activity) => {
    const finishingLast = !a.done && isOpenDeal(deal) && openActs.length === 1 && openActs[0].id === a.id;
    await run((repo) => setActivityDone(repo, a.id, !a.done), a.done ? "Adım yeniden açıldı" : "Adım tamamlandı");
    if (finishingLast) setPromptNext(true);
  };
  const startCompose = () => {
    setTab("steps");
    setComposing(true);
    setPromptNext(false);
  };

  const showChecklist = freshDeals.has(deal.id) && (deal.value === 0 || acts.length === 0);
  const stage = STAGE[deal.stage];
  const phoneDigits = contact?.phone?.replace(/\D/g, "") ?? "";

  const TABS: { key: Tab; icon: string; label: string; badge?: React.ReactNode }[] = [
    {
      key: "steps",
      icon: "calendar",
      label: "Adımlar",
      badge: overdue ? (
        <span className="count bad">{overdue} gecikmiş</span>
      ) : openActs.length ? (
        <span className="count">{openActs.length}</span>
      ) : null,
    },
    { key: "info", icon: "edit", label: "Bilgiler" },
    { key: "notes", icon: "note", label: "Notlar", badge: deal.notes ? <span className="count">var</span> : null },
  ];

  return (
    <dialog
      ref={ref}
      className="drawer"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <header className="drawer-head">
        <div className="drawer-title">
          <EditableTitle
            id={titleId}
            value={deal.title}
            disabled={!editable}
            onSave={(v) => save({ title: v }, "Müşteri adı güncellendi")}
          />
          <div className="drawer-where">
            <span className="where-stage" data-tone={stage.tone}>
              <span className="no" aria-hidden="true">
                {stage.no}
              </span>
              {stage.label}
            </span>
            <span className="muted">{daysSince(deal.stage_entered_at)} gündür bu durakta</span>
            {won && (
              <StatusTag tone="ok" icon="trophy">
                Satıldı · {fmtDate(deal.won_at)}
              </StatusTag>
            )}
            {!won && status && deal.stage !== "lost" && (
              <StatusTag tone={status.tone} icon={status.icon} title={status.text}>
                {status.text}
              </StatusTag>
            )}
            <label className="owner-chip" title="Sorumlu satışçı">
              <Icon name="tag" size={14} />
              <span>Sorumlu:</span>
              <select
                value={deal.owner}
                disabled={!isAdmin && !!deal.owner && deal.owner !== me}
                onChange={(e) =>
                  run(
                    (repo) => assignDeal(repo, deal.id, e.target.value),
                    e.target.value ? `Sorumlu: ${e.target.value}` : "Ortak havuza bırakıldı",
                  )
                }
              >
                <option value="">Ortak havuz</option>
                {owners.map((o) => (
                  <option key={o} value={o} disabled={!isAdmin && o !== me}>
                    {o}
                    {o === me ? " (ben)" : ""}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
        <div className="drawer-actions">
          {!deal.owner && isOpenDeal(deal) && (
            <Button
              variant="pri"
              icon="hand"
              onClick={() => run((repo) => assignDeal(repo, deal.id, me), "Müşteri size atandı")}
            >
              Üstlen
            </Button>
          )}
          {editable &&
            deal.stage !== "lost" &&
            (won ? (
              <Button icon="reset" onClick={() => run((repo) => setWon(repo, deal.id, false), "Satış yeniden açıldı")}>
                Satışı geri al
              </Button>
            ) : (
              <Button
                variant="won"
                icon="trophy"
                onClick={() => run((repo) => setWon(repo, deal.id, true), `Tebrikler, ${deal.title} satıldı`)}
              >
                Satış tamamlandı
              </Button>
            ))}
          <IconButton icon="x" label="Paneli kapat" onClick={close} />
        </div>
      </header>

      <section className="drawer-journey" aria-label="Yolculuk">
        <Stations current={deal.stage} onPick={editable ? (s) => move(deal.id, s) : undefined} />
        <p className="journey-next">
          <Icon name="arrow" size={14} /> Sırada: {stage.next}
          {editable && <span className="muted"> · başka durağa taşımak için üstteki durağa tıklayın</span>}
        </p>
      </section>

      {!editable && (
        <div className="readonly-note" role="note">
          <Icon name="lock" size={16} /> Bu müşteri {deal.owner} sorumluluğunda; yalnız görüntüleyebilirsiniz.
          Değişiklik için admin gerekir.
        </div>
      )}
      {deal.stage === "lost" && (
        <div className="banner banner-red">
          <Icon name="ban" />
          <label htmlFor="lost-reason-edit">Olumsuz sonuç nedeni:</label>
          <TextCommit
            id="lost-reason-edit"
            value={deal.lost_reason || ""}
            disabled={!editable}
            onSave={(v) => save({ lost_reason: v }, "Neden güncellendi")}
          />
        </div>
      )}
      {showChecklist && (
        <section className="checklist" aria-label="İlk adımlar">
          <h3>Formdan panoya alındı. İlk adımlar:</h3>
          <ul>
            <li className={deal.value > 0 ? "done" : ""}>
              <span className="box">{deal.value > 0 && <Icon name="check" size={12} />}</span> Tahmini değeri girin
            </li>
            <li className={acts.length > 0 ? "done" : ""}>
              <span className="box">{acts.length > 0 && <Icon name="check" size={12} />}</span> İlk adımı planlayın
            </li>
          </ul>
        </section>
      )}

      <section className="idcard" aria-label="Müşteri kartı">
        <div className="id-main">
          <Avatar name={contact?.name || deal.title} size={44} label={false} />
          <div className="id-who">
            <b>{contact?.name || "Kişi bağlı değil"}</b>
            <small>
              {[
                contact?.role,
                org && org.name !== deal.title
                  ? `${org.name} · ${ORG_TYPE_LABEL[org.type]}`
                  : org
                    ? ORG_TYPE_LABEL[org.type]
                    : null,
              ]
                .filter(Boolean)
                .join(" · ") || "Rol belirtilmemiş"}
            </small>
            <small>
              {country ? `${flagOf(country)} ${countryName(country)}` : "Ülke belirsiz"}
              {contact?.preferred_language &&
                ` · ${LANGUAGE_NAME[contact.preferred_language] || contact.preferred_language}`}
            </small>
          </div>
        </div>
        <div className="id-actions">
          {phoneDigits ? (
            <>
              <a className="btn btn-sec" href={`tel:+${phoneDigits}`}>
                <Icon name="phone" /> Ara
              </a>
              <a className="btn btn-sec" href={`https://wa.me/${phoneDigits}`} target="_blank" rel="noreferrer">
                <Icon name="phone" /> WhatsApp
              </a>
            </>
          ) : (
            <span className="id-missing">Telefon yok</span>
          )}
          {contact?.email ? (
            <a className="btn btn-sec" href={`mailto:${contact.email}`}>
              <Icon name="mail" /> E-posta
            </a>
          ) : (
            <span className="id-missing">E-posta yok</span>
          )}
        </div>
        <dl className="id-facts">
          <div>
            <dt>Tahmini değer</dt>
            <dd>{deal.value > 0 ? money(deal.value, deal.currency) : <span className="muted">girilmedi</span>}</dd>
          </div>
          <div>
            <dt>Kort</dt>
            <dd>
              {deal.court_count > 0 ? `${deal.court_count} · ${deal.court_model}` : <span className="muted">—</span>}
            </dd>
          </div>
          <div>
            <dt>Hedef kapanış</dt>
            <dd>{deal.expected_close_date ? fmtDate(deal.expected_close_date) : <span className="muted">—</span>}</dd>
          </div>
          <div>
            <dt>Telefon</dt>
            <dd>{contact?.phone || <span className="muted">—</span>}</dd>
          </div>
          <div>
            <dt>E-posta</dt>
            <dd className="wrap">{contact?.email || <span className="muted">—</span>}</dd>
          </div>
        </dl>
      </section>

      <div className="drawer-tabs" role="tablist" aria-label="Müşteri bölümleri">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            id={`tb-${t.key}`}
            aria-controls={`tp-${t.key}`}
            aria-selected={tab === t.key}
            className="tab"
            onClick={() => setTab(t.key)}
          >
            <Icon name={t.icon} size={16} /> {t.label}
            {t.badge}
          </button>
        ))}
      </div>

      <div className="drawer-body">
        {tab === "steps" && (
          <div className="panel" role="tabpanel" id="tp-steps" aria-labelledby="tb-steps">
            {isOpenDeal(deal) && status && (
              <div className={"nowbox " + status.tone} role="status">
                <Icon name={status.icon} size={18} />
                <span>
                  <b>Şimdi:</b>{" "}
                  {rotting ? "Planlı bir sonraki adım yok. Unutulmasın diye bir adım planlayın." : status.text}
                </span>
                {rotting && editable && !composing && (
                  <Button size="sm" variant="pri" onClick={startCompose}>
                    Adım planla
                  </Button>
                )}
              </div>
            )}
            {promptNext && !composing && (
              <div className="nextprompt" role="status">
                <Icon name="flame" />
                <span>Son planlı adım tamamlandı. Müşteri takipsiz kalmasın diye sıradaki adımı planlayın.</span>
                <Button size="sm" variant="pri" onClick={startCompose}>
                  Sıradaki adımı planla
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setPromptNext(false)}>
                  Şimdi değil
                </Button>
              </div>
            )}
            {editable &&
              (composing ? (
                <ActivityComposer dealId={deal.id} onDone={() => setComposing(false)} />
              ) : (
                <button className="composer-closed" onClick={() => setComposing(true)}>
                  <Icon name="plus" /> Adım planla…{" "}
                  <span className="muted">arama, e-posta, toplantı, proforma, saha ziyareti</span>
                </button>
              ))}
            <Timeline deal={deal} acts={acts} changes={changes} editable={editable} onToggle={toggle} />
          </div>
        )}

        {tab === "info" && (
          <div className="panel" role="tabpanel" id="tp-info" aria-labelledby="tb-info">
            <div className="facts">
              <div className="fact">
                <label htmlFor="d-value">Tahmini değer</label>
                <div className="pair">
                  <NumberCommit
                    id="d-value"
                    value={deal.value}
                    disabled={!editable}
                    onSave={(v) => save({ value: v })}
                  />
                  <select
                    value={deal.currency}
                    disabled={!editable}
                    onChange={(e) => save({ currency: e.target.value as Currency })}
                    aria-label="Para birimi"
                  >
                    {CURRENCIES.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="fact">
                <label htmlFor="d-courts">Kort adedi</label>
                <NumberCommit
                  id="d-courts"
                  value={deal.court_count}
                  disabled={!editable}
                  onSave={(v) => save({ court_count: Math.round(v) })}
                />
              </div>
              <div className="fact">
                <label htmlFor="d-model">Kort modeli</label>
                <select
                  id="d-model"
                  value={deal.court_model}
                  disabled={!editable}
                  onChange={(e) => save({ court_model: e.target.value })}
                >
                  {!COURT_MODELS.includes(deal.court_model) && <option>{deal.court_model}</option>}
                  {COURT_MODELS.map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
              </div>
              <div className="fact">
                <label htmlFor="d-close">Tahmini kapanış</label>
                <input
                  id="d-close"
                  type="date"
                  value={deal.expected_close_date || ""}
                  disabled={!editable}
                  onChange={(e) => save({ expected_close_date: e.target.value || null })}
                />
              </div>
              {contact ? (
                <>
                  <div className="fact">
                    <label htmlFor="c-email">E-posta</label>
                    <TextCommit
                      id="c-email"
                      value={contact.email}
                      placeholder="ad@firma.com"
                      allowEmpty
                      disabled={!editable}
                      onSave={(v) =>
                        run((repo) => updateContact(repo, contact.id, { email: v.trim() }), "E-posta güncellendi")
                      }
                    />
                  </div>
                  <div className="fact">
                    <label htmlFor="c-phone">Telefon</label>
                    <TextCommit
                      id="c-phone"
                      value={contact.phone}
                      placeholder="+90 5xx…"
                      allowEmpty
                      disabled={!editable}
                      onSave={(v) =>
                        run((repo) => updateContact(repo, contact.id, { phone: v.trim() }), "Telefon güncellendi")
                      }
                    />
                  </div>
                  <div className="fact">
                    <span>Tercih edilen dil</span>
                    <span className="val">
                      {LANGUAGE_NAME[contact.preferred_language] || contact.preferred_language}
                    </span>
                  </div>
                </>
              ) : (
                <div className="fact">
                  <span>Kişi</span>
                  <span className="val muted">Kişi bağlı değil</span>
                </div>
              )}
              {org && (
                <div className="fact">
                  <span>Organizasyon</span>
                  <span className="val">
                    {org.name} · {ORG_TYPE_LABEL[org.type]}
                  </span>
                  {org.website && (
                    <a href={`https://${org.website.replace(/^https?:\/\//, "")}`} target="_blank" rel="noreferrer">
                      <Icon name="globe" size={14} /> {org.website}
                    </a>
                  )}
                </div>
              )}
              <div className="fact">
                <span>Kayıt</span>
                <span className="val">{fmtDate(deal.created_at)}</span>
              </div>
            </div>
            {(isAdmin || editable) && (
              <Button
                variant="ghost"
                size="sm"
                icon="trash"
                className="delete-link"
                onClick={() => {
                  if (confirm(`“${deal.title}” ve tüm adımları kalıcı olarak silinsin mi?`)) {
                    run((repo) => deleteDeal(repo, deal.id), "Müşteri silindi");
                    close();
                  }
                }}
              >
                Müşteriyi sil
              </Button>
            )}
          </div>
        )}

        {tab === "notes" && (
          <div className="panel" role="tabpanel" id="tp-notes" aria-labelledby="tb-notes">
            <NotesBox value={deal.notes} disabled={!editable} onSave={(v) => save({ notes: v }, "Not kaydedildi")} />
          </div>
        )}
      </div>
      {dialog}
    </dialog>
  );
}

/* ---------------- activity composer ---------------- */

const QUICK: [number, string][] = [
  [0, "Bugün"],
  [1, "Yarın"],
  [3, "3 gün"],
  [7, "1 hafta"],
];
const inDays = (n: number) => localDate(new Date(Date.now() + n * 86_400_000));

function ActivityComposer({ dealId, onDone }: { dealId: string; onDone: () => void }) {
  const { run } = useCrm();
  const [type, setType] = useState<ActivityType>("call");
  const [subject, setSubject] = useState("");
  const [date, setDate] = useState(inDays(1));
  const [time, setTime] = useState("10:00");
  const [notes, setNotes] = useState("");
  const [done, setDone] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dateErr, setDateErr] = useState("");
  const first = useRef<HTMLButtonElement>(null);

  useEffect(() => first.current?.focus(), []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!date) {
      setDateErr("Tarih seçin.");
      return;
    }
    setSaving(true);
    const due = new Date(`${date}T${time || "09:00"}`).toISOString();
    const ok = await run(
      (repo) => addActivity(repo, { deal_id: dealId, type, subject, due_at: due, notes, done }),
      done ? "Adım geçmişe kaydedildi" : `${ACTIVITY_LABEL[type]} planlandı: ${fmtDate(due, true)}`,
    );
    setSaving(false);
    if (ok) onDone();
  };

  return (
    <form className="composer" onSubmit={submit} aria-label="Adım planla">
      <div className="seg" role="radiogroup" aria-label="Adım tipi">
        {ACTIVITY_TYPES.map((a, i) => (
          <button
            ref={i === 0 ? first : undefined}
            type="button"
            key={a.key}
            role="radio"
            aria-checked={type === a.key}
            onClick={() => setType(a.key)}
          >
            <Icon name={a.icon} size={14} /> {a.label}
          </button>
        ))}
      </div>
      <Field label="Konu">
        <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={defaultSubject(type)} />
      </Field>
      <div className="composer-row">
        <Field label="Tarih" error={dateErr}>
          <input type="date" value={date} required onChange={(e) => (setDate(e.target.value), setDateErr(""))} />
        </Field>
        <Field label="Saat">
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </Field>
        <div className="field">
          <span className="field-l" id="quick-l">
            Hızlı seç
          </span>
          <div className="seg" role="group" aria-labelledby="quick-l">
            {QUICK.map(([n, l]) => (
              <button type="button" key={l} aria-pressed={date === inDays(n)} onClick={() => setDate(inDays(n))}>
                {l}
              </button>
            ))}
          </div>
        </div>
      </div>
      <Field label="Not (isteğe bağlı)">
        <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <div className="composer-foot">
        <label className="check">
          <input type="checkbox" checked={done} onChange={(e) => setDone(e.target.checked)} /> Zaten yapıldı (geçmişe
          kaydet)
        </label>
        <div>
          <Button variant="ghost" onClick={onDone}>
            Vazgeç
          </Button>
          <Button variant="pri" type="submit" loading={saving}>
            Kaydet
          </Button>
        </div>
      </div>
    </form>
  );
}

/* ---------------- timeline ---------------- */

type Ev = { kind: "act"; at: string; a: Activity } | { kind: "stage"; at: string; from: StageKey | null; to: StageKey };

function Timeline({
  deal,
  acts,
  changes,
  editable,
  onToggle,
}: {
  deal: Deal;
  acts: Activity[];
  changes: { from_stage: StageKey | null; to_stage: StageKey; changed_at: string }[];
  editable: boolean;
  onToggle: (a: Activity) => void;
}) {
  const { run } = useCrm();
  const planned = acts.filter((a) => !a.done).sort((a, b) => a.due_at.localeCompare(b.due_at));
  const history: Ev[] = [
    ...acts.filter((a) => a.done).map((a) => ({ kind: "act" as const, at: a.done_at || a.due_at, a })),
    ...changes.map((c) => ({ kind: "stage" as const, at: c.changed_at, from: c.from_stage, to: c.to_stage })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <div className="timeline" aria-label="Zaman çizelgesi">
      <h4 className="section-h">Planlanan</h4>
      {!planned.length && (
        <p className={"tl-empty" + (isOpenDeal(deal) ? " bad" : "")}>
          {isOpenDeal(deal) ? "Planlanmış adım yok." : "Kapalı müşteri, planlı adım yok."}
        </p>
      )}
      {planned.map((a) => (
        <ActivityRow
          key={a.id}
          a={a}
          disabled={!editable}
          onToggle={() => onToggle(a)}
          onDelete={editable ? () => run((r) => deleteActivity(r, a.id), "Adım silindi") : undefined}
        />
      ))}

      <h4 className="section-h">Geçmiş</h4>
      <ol className="tl">
        {history.map((ev, i) =>
          ev.kind === "act" ? (
            <li key={ev.a.id} className="tl-i">
              <span className="tl-dot act" aria-hidden="true">
                <Icon name={TYPE_ICON[ev.a.type]} size={14} />
              </span>
              <ActivityRow a={ev.a} disabled={!editable} onToggle={() => onToggle(ev.a)} flat />
            </li>
          ) : (
            <li key={"s" + i} className="tl-i">
              <span className="tl-dot" aria-hidden="true">
                <Icon name="arrow" size={14} />
              </span>
              <div className="tl-stage">
                {ev.from ? (
                  <span>
                    Kolon değişti: <s>{STAGE[ev.from].label}</s> → <b>{STAGE[ev.to].label}</b>
                  </span>
                ) : (
                  <span>
                    Panoya eklendi: <b>{STAGE[ev.to].label}</b>
                  </span>
                )}
                <time className="t" dateTime={ev.at}>
                  {fmtDate(ev.at, true)}
                </time>
              </div>
            </li>
          ),
        )}
      </ol>
    </div>
  );
}

export function ActivityRow({
  a,
  onToggle,
  onDelete,
  flat,
  extra,
  disabled,
}: {
  a: Activity;
  onToggle: () => void;
  onDelete?: () => void;
  flat?: boolean;
  extra?: React.ReactNode;
  disabled?: boolean;
}) {
  const bucket = a.done ? "done" : activityBucket(a);
  const when = bucket === "overdue" ? "Gecikti" : bucket === "today" ? "Bugün" : "";
  return (
    <div className={`arow is-${bucket}` + (flat ? " is-flat" : "")}>
      <label className="arow-check" title={a.done ? "Tamamlanmadı olarak işaretle" : "Tamamlandı olarak işaretle"}>
        <input type="checkbox" checked={a.done} disabled={disabled} onChange={onToggle} />
        <span className="sr-only">
          {a.subject} — {a.done ? "tamamlandı" : "tamamlandı olarak işaretle"}
        </span>
      </label>
      {!flat && (
        <span className="arow-ic" aria-hidden="true">
          <Icon name={TYPE_ICON[a.type]} />
        </span>
      )}
      <div className="arow-main">
        <div className="arow-title">
          <span className={a.done ? "done" : ""}>{a.subject}</span>
          <span className="tag tag-neutral">{ACTIVITY_LABEL[a.type]}</span>
          {a.auto_created && <span className="tag">otomatik</span>}
        </div>
        {a.notes && <p className="arow-notes">{a.notes}</p>}
        {extra}
      </div>
      <div className="arow-due">
        {when ? (
          <StatusTag tone={bucket === "overdue" ? "bad" : "ok"} icon={bucket === "overdue" ? "alarm" : "clock"}>
            {when} · {relDays(a.due_at)}
          </StatusTag>
        ) : null}
        <time dateTime={a.due_at}>{fmtDate(a.due_at, true)}</time>
        {!a.done && !when && <small>{relDays(a.due_at)}</small>}
      </div>
      {onDelete && <IconButton icon="trash" label={`${a.subject} adımını sil`} size="sm" onClick={onDelete} />}
    </div>
  );
}

/* ---------------- small inputs ---------------- */

function EditableTitle({
  id,
  value,
  onSave,
  disabled,
}: {
  id: string;
  value: string;
  onSave: (v: string) => void;
  disabled?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const commit = () => {
    setEditing(false);
    if (v.trim() && v.trim() !== value) onSave(v.trim());
    else setV(value);
  };
  return editing ? (
    <div className="title-row">
      <input
        autoFocus
        aria-label="Müşteri adı"
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") {
            e.preventDefault(); // keep the drawer open, just cancel the edit
            setV(value);
            setEditing(false);
          }
        }}
      />
      <h2 id={id} className="sr-only">
        {value}
      </h2>
    </div>
  ) : (
    <div className="title-row">
      <h2 id={id}>{value}</h2>
      {!disabled && <IconButton icon="edit" label="Müşteri adını düzenle" size="sm" onClick={() => setEditing(true)} />}
    </div>
  );
}

function TextCommit({
  id,
  value,
  onSave,
  placeholder,
  allowEmpty,
  disabled,
}: {
  id: string;
  value: string;
  onSave: (v: string) => void;
  placeholder?: string;
  allowEmpty?: boolean;
  disabled?: boolean;
}) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <input
      id={id}
      value={v}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => (v.trim() || allowEmpty ? v !== value && onSave(v) : setV(value))}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
    />
  );
}

function NumberCommit({
  id,
  value,
  onSave,
  disabled,
}: {
  id: string;
  value: number;
  onSave: (v: number) => void;
  disabled?: boolean;
}) {
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value]);
  return (
    <input
      id={id}
      type="number"
      min={0}
      inputMode="decimal"
      value={v}
      disabled={disabled}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        const n = Number(v);
        if (!Number.isNaN(n) && n !== value) onSave(Math.max(0, n));
        else setV(String(value));
      }}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
    />
  );
}

function NotesBox({ value, onSave, disabled }: { value: string; onSave: (v: string) => void; disabled?: boolean }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <>
      <Field label="Müşteri notları" hint="Görüşme özeti, proforma numarası, itirazlar…">
        <textarea rows={6} value={v} disabled={disabled} onChange={(e) => setV(e.target.value)} />
      </Field>
      {!disabled && (
        <div>
          <Button
            variant="pri"
            disabled={v === value}
            title={v === value ? "Değişiklik yok" : undefined}
            onClick={() => onSave(v)}
          >
            Notu kaydet
          </Button>
        </div>
      )}
    </>
  );
}
