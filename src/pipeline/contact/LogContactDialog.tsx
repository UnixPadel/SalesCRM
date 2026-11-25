import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Button, Icon, Modal, Skeleton, fmtDate } from "../../components/ui";
import { localeOf, useLang } from "../../i18n";
import type { ActivityOutcomeDto, ActivityTypeDto, StageCodeDto } from "../../modules/sales-pipeline/api/dto";
import type { ContactFormDto, LogContactResultDto } from "../../modules/sales-pipeline/api/dto.contact";
import { useCrm } from "../../state/CrmContext";
import { ACTIVITY_ICON } from "../activityBits";
import { uploadAll } from "../attachments/attachmentApi";
import { FilePicker } from "../attachments/FilePicker";
import { useErrorText, useNow, useReference } from "../hooks";
import { contactApi } from "./contactApi";
import {
  buildBody,
  changeChannel,
  effectiveTarget,
  evidenceRule,
  initialState,
  isReplyQuestion,
  nextBlocked,
  pickPlan,
  retarget,
  saveBlockers,
  setReplied,
  showsReplied,
  showsStatus,
  stageLineView,
  toLocalInput,
  type DialogState,
} from "./dialogState";

export interface LogContactOpen {
  leadId: string;
  leadName: string;
  /** Bağlantıdan (WhatsApp, e-posta, arama) ya da plandan gelen kanal: özet satırı olarak görünür. */
  type?: ActivityTypeDto;
  outcome?: ActivityOutcomeDto;
  /** `type` seçili gelir ama kanal seçenekleri açık kalır (liste hücresinden: kullanıcı başka kanala geçebilir). */
  pickChannel?: boolean;
  /** Tamamlama modu (Bugün "Tamamla…", plan satırı). */
  activityId?: string | null;
  /** Hızlı kayıt çubuğundan: kanal ve sonuç seçili gelir, odak ekran görüntüsü kutusuna gider. */
  focus?: "file";
}

/**
 * "İletişim kaydet" (eski adı "Temas kaydet"; Faz 7g, iş emri §5.3): Excel'de dört yere yazılan bilgi tek kayıtta. Varsayılan görünüm dört
 * blok (Sonuç, Not, özet satırı, düğmeler); kanal, zaman, takip ve durum gerektiğinde açılır (Hick). Tek istek.
 */
export function LogContactDialog({
  open,
  onClose,
  onSaved,
}: {
  open: LogContactOpen;
  onClose: () => void;
  onSaved: (r: LogContactResultDto) => void;
}) {
  const { t, lang } = useLang();
  const { toast } = useCrm();
  const { ref, stageName, reasonName } = useReference();
  const errText = useErrorText();
  // Görüşme notuna eklenecek dosyalar; temas kaydedilince o görüşmeye bağlanarak yüklenir.
  const [files, setFiles] = useState<File[]>([]);
  const [form, setForm] = useState<ContactFormDto | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [s, setS] = useState<DialogState | null>(null);
  const [channelOpen, setChannelOpen] = useState(!open.type || !!open.pickChannel);
  const [moreOpen, setMoreOpen] = useState(false);
  const [workOpen, setWorkOpen] = useState(false);
  // Plan dışarıdan verildiyse ya da elle seçildiyse kanal değişimi onu değiştirmez.
  const [planLocked, setPlanLocked] = useState(open.activityId !== undefined);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const helpId = useId();
  const rules = ref?.contactRules;
  const nowMs = useNow(15_000);
  const bodyRef = useRef<HTMLDivElement>(null);
  const fileBtn = useRef<HTMLButtonElement>(null);
  const loaded = !!s;

  useEffect(() => {
    contactApi.form(open.leadId).then(setForm).catch(setLoadError);
  }, [open.leadId]);
  // Pencere iskeletle açılır, odak kapat düğmesinde kalır; form gelince seçili sonuca (hızlı kayıttan gelindiyse
  // ekran görüntüsü kutusuna) geçer (Enter pencereyi kapatmasın).
  useEffect(() => {
    if (!loaded) return;
    if (open.focus === "file") fileBtn.current?.focus();
    else bodyRef.current?.querySelector<HTMLElement>('input[name="cd-outcome"]:checked')?.focus();
  }, [loaded, open.focus]);
  useEffect(() => {
    if (form && rules && !s) {
      const init = initialState(form, rules, {
        ...(open.type ? { type: open.type } : {}),
        ...(open.outcome ? { outcome: open.outcome } : {}),
        ...(open.activityId !== undefined ? { activityId: open.activityId } : {}),
      });
      setS(init);
      if (!open.type && !open.pickChannel && init.activityId) setChannelOpen(false);
    }
  }, [form, rules, s, open]);

  const order = useMemo<ActivityOutcomeDto[]>(() => (ref?.outcomeDisplayOrder ?? []) as ActivityOutcomeDto[], [ref]);
  const requestClose = () => (s && (s.note.trim() || files.length) && !saving ? setConfirmClose(true) : onClose());

  const body = () => {
    if (loadError)
      return (
        <p className="field-err" role="alert">
          {errText(loadError)}
        </p>
      );
    if (!form || !rules || !s || !ref) {
      return (
        <div className="cd-skel" aria-busy="true" aria-label={t("common.loading")}>
          <Skeleton h={20} w={160} />
          <Skeleton h={88} />
          <Skeleton h={72} />
          <Skeleton h={20} w={240} />
        </div>
      );
    }
    const up = (patch: Partial<DialogState>, re = false) =>
      setS((prev) => {
        const next = { ...prev!, ...patch };
        return re ? retarget(next, form, rules) : next;
      });
    const planned = form.openActivities.find((a) => a.id === s.activityId);
    const line = stageLineView(s, form, rules);
    const target = effectiveTarget(s, form, rules);
    const blocked = nextBlocked(s, form, rules);
    const blockers = saveBlockers(s, form, rules, nowMs, files.length);
    const evidence = evidenceRule(s.type, target);
    const statusVisible = showsStatus(form, s, rules);
    const fromDefaults = form.defaults[s.type]?.[s.outcome]?.stage ?? null;
    const typeLabel = (x: ActivityTypeDto) => t(`activity.type.${x}`);
    const nextText =
      blocked === "proposal"
        ? t("contact.proposalFollowUp")
        : blocked === "closed"
          ? t("contact.closedNoNext")
          : s.planNext && s.nextDueAt
            ? t("contact.nextSummary", {
                what: `${typeLabel(s.nextType)}, ${new Date(s.nextDueAt).toLocaleString(localeOf(lang), { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`,
              })
            : t("contact.noNext");
    const createdMs = new Date(form.lead.createdAt).getTime();
    const beforeLead = s.occurredAt && new Date(s.occurredAt).getTime() < createdMs;
    const futureErr = blockers.includes("contact.futureTime");

    return (
      <div className="cd" ref={bodyRef}>
        {/* 1. Tamamlanacak iş */}
        {(planned || form.openActivities.length > 0) && (
          <div className="cd-line">
            <Icon name="check" size={16} />
            <span>
              {planned
                ? t("contact.completes", { subject: planned.subject, due: fmtDate(planned.dueAt) })
                : t("contact.asNew")}
            </span>
            <button type="button" className="link-btn" aria-expanded={workOpen} onClick={() => setWorkOpen((v) => !v)}>
              {t("contact.change")}
            </button>
          </div>
        )}
        {workOpen && (
          <fieldset className="cd-pick">
            <legend className="sr-only">{t("contact.completes", { subject: "", due: "" })}</legend>
            {form.openActivities.map((a) => (
              <label key={a.id} className="cd-opt">
                <input
                  type="radio"
                  name="cd-work"
                  checked={s.activityId === a.id}
                  onChange={() => {
                    setPlanLocked(true);
                    setS(pickPlan(s, a, form, rules, open.outcome));
                  }}
                />
                <Icon name={ACTIVITY_ICON[a.type]} size={16} /> {a.subject} · {fmtDate(a.dueAt, true)}
              </label>
            ))}
            <label className="cd-opt">
              <input
                type="radio"
                name="cd-work"
                checked={s.activityId === null}
                onChange={() => {
                  setPlanLocked(true);
                  up({ activityId: null });
                }}
              />
              {t("contact.asNew")}
            </label>
          </fieldset>
        )}

        {/* 2. Kanal */}
        {channelOpen ? (
          <fieldset className="cd-seg" role="radiogroup">
            <legend className="field-l">{t("contact.channel")}</legend>
            <div className="seg-row">
              {form.channels.map((c) => (
                <label key={c} className={"seg-chip" + (s.type === c ? " on" : "")}>
                  <input
                    type="radio"
                    name="cd-type"
                    value={c}
                    checked={s.type === c}
                    onChange={() => setS(changeChannel(s, c, form, rules, { presetOutcome: open.outcome, planLocked }))}
                  />
                  <Icon name={ACTIVITY_ICON[c]} size={16} />
                  <span>{typeLabel(c)}</span>
                  {(c === "call" || c === "whatsapp") && (
                    <small className="seg-sub">{t(`contact.channelHelp.${c}`)}</small>
                  )}
                </label>
              ))}
            </div>
          </fieldset>
        ) : (
          <div className="cd-line">
            <Icon name={ACTIVITY_ICON[s.type]} size={16} />
            <span>
              {t("contact.channel")}: <b>{typeLabel(s.type)}</b>
            </span>
            <button type="button" className="link-btn" onClick={() => setChannelOpen(true)}>
              {t("contact.change")}
            </button>
          </div>
        )}

        {/* 3. Sonuç */}
        <fieldset className="cd-seg" role="radiogroup" aria-describedby={helpId}>
          <legend className="field-l">{t("contact.outcome")}</legend>
          <div className="seg-row">
            {order.map((o) => (
              <label key={o} className={"seg-chip" + (s.outcome === o ? " on" : "")}>
                <input
                  type="radio"
                  name="cd-outcome"
                  value={o}
                  checked={s.outcome === o}
                  onChange={() => up({ outcome: o }, true)}
                />
                <span>{t(`activity.outcome.${o}`)}</span>
              </label>
            ))}
          </div>
          <p className="field-h" id={helpId}>
            {t(`contact.help.${s.outcome}`)}
          </p>
          {showsReplied(s.outcome, rules) && (
            <label className="cd-check">
              <input
                type="checkbox"
                checked={s.replied}
                onChange={(e) => setS(setReplied(s, e.target.checked, form))}
              />
              {t("contact.replied")}
            </label>
          )}
        </fieldset>

        {/* 4. Not */}
        <label className="field">
          <span className="field-l">{t("contact.note")}</span>
          <textarea
            rows={3}
            maxLength={rules.noteMax}
            value={s.note}
            placeholder={t("contact.notePlaceholder")}
            onChange={(e) => up({ note: e.target.value })}
          />
          {s.note.length > 3500 && (
            <span className="field-h">
              {s.note.length} / {rules.noteMax}
            </span>
          )}
        </label>
        <FilePicker
          files={files}
          onChange={setFiles}
          rules={ref.attachments}
          disabled={saving}
          boxed
          required={evidence.required}
          purpose={t(evidence.purposeKey)}
          buttonRef={fileBtn}
        />

        {/* 5. Zaman ve takip özeti */}
        <div className="cd-line">
          <Icon name="clock" size={16} />
          <span>
            {s.occurredAt ? fmtDate(new Date(s.occurredAt).toISOString(), true) : t("contact.now")} · {nextText}
          </span>
          <button type="button" className="link-btn" aria-expanded={moreOpen} onClick={() => setMoreOpen((v) => !v)}>
            {t("contact.change")}
          </button>
        </div>
        {moreOpen && (
          <div className="cd-more">
            <label className={"field" + (futureErr ? " has-error" : "")}>
              <span className="field-l">{t("contact.when")}</span>
              <input
                type="datetime-local"
                min={`${rules.minContactDate}T00:00`}
                max={toLocalInput(new Date().toISOString())}
                value={s.occurredAt ?? toLocalInput(new Date().toISOString())}
                onChange={(e) => up({ occurredAt: e.target.value || null })}
              />
              {futureErr ? (
                <span className="field-err" role="alert">
                  <Icon name="warn" size={14} /> {t("contact.futureTime")}
                </span>
              ) : beforeLead ? (
                <span className="field-h">
                  <Icon name="info" size={14} /> {t("contact.beforeLead")}
                </span>
              ) : null}
            </label>
            {!blocked && (
              <>
                <label className="cd-check">
                  <input type="checkbox" checked={s.planNext} onChange={(e) => up({ planNext: e.target.checked })} />
                  {t("contact.planNext")}
                </label>
                {s.planNext && (
                  <div className="cd-next">
                    <label className="field">
                      <span className="field-l">{t("activity.type")}</span>
                      <select value={s.nextType} onChange={(e) => up({ nextType: e.target.value as ActivityTypeDto })}>
                        {ref.contactChannels.map((c) => (
                          <option key={c} value={c}>
                            {typeLabel(c)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      <span className="field-l">{t("activity.due")}</span>
                      <input
                        type="datetime-local"
                        value={s.nextDueAt ? toLocalInput(s.nextDueAt) : ""}
                        onChange={(e) =>
                          up({ nextDueAt: e.target.value ? new Date(e.target.value).toISOString() : "" })
                        }
                      />
                    </label>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* 6. Müşteri durumu */}
        {statusVisible && (
          <label className="field">
            <span className="field-l">{t("customerStatus.label")}</span>
            <select
              value={s.status === undefined ? (form.lead.customerStatus ?? "") : (s.status ?? "")}
              onChange={(e) => up({ status: e.target.value || null, lostChecked: false })}
            >
              <option value="">{t("customerStatus.none")}</option>
              {ref.customerStatuses.map((x) => (
                <option key={x.code} value={x.code}>
                  {t(`customerStatus.${x.code}`)}
                </option>
              ))}
            </select>
            <span className="field-h">{t("customerStatus.help")}</span>
          </label>
        )}

        {/* 7. Aşama satırı */}
        {line && (
          <div className="cd-stage">
            {line.mode === "fixed" ? (
              <p className="cd-line">
                <Icon name="arrow" size={16} />
                <span>{t("contact.stageFixed", { stage: stageName(line.target as StageCodeDto) })}</span>
              </p>
            ) : isReplyQuestion(fromDefaults) ? (
              <fieldset className={"qa cd-reply" + (blockers.includes("contact.needReplyAnswer") ? " has-error" : "")}>
                <legend>{t("contact.replyAsk")} *</legend>
                <div className="seg" role="radiogroup" aria-required="true">
                  {[false, true].map((v) => (
                    <label key={String(v)} className={"seg-opt" + (s.stageChecked === v ? " on" : "")}>
                      <input
                        type="radio"
                        name="cd-reply"
                        checked={s.stageChecked === v}
                        onChange={() => up({ stageChecked: v })}
                      />
                      {v ? t("common.yes") : t("common.no")}
                    </label>
                  ))}
                </div>
                <span className="field-h">
                  {t("contact.replyHelp", { stage: stageName(line.target as StageCodeDto) })}
                </span>
              </fieldset>
            ) : (
              <label className="cd-check">
                <input
                  type="checkbox"
                  checked={fromDefaults ? s.stageChecked === true : s.lostChecked}
                  onChange={(e) =>
                    up(fromDefaults ? { stageChecked: e.target.checked } : { lostChecked: e.target.checked })
                  }
                />
                {fromDefaults
                  ? t("contact.stageMove", { stage: stageName(line.target as StageCodeDto) })
                  : t("contact.stageLostAsk")}
              </label>
            )}
            {(target === "PROPOSAL" || target === "WON") && (
              <div className="cd-next">
                <label
                  className={
                    "field" +
                    (blockers.includes("contact.needAmount") || blockers.includes("contact.badAmount")
                      ? " has-error"
                      : "")
                  }
                >
                  <span className="field-l">
                    {target === "WON" ? t("dialog.won.amount") : t("contact.proposalAmount")}
                  </span>
                  <input
                    inputMode="decimal"
                    value={s.amount}
                    onChange={(e) => up({ amount: e.target.value })}
                    aria-required={target === "WON"}
                  />
                </label>
                <label className="field">
                  <span className="field-l">{t("dialog.won.currency")}</span>
                  <select value={s.currency} onChange={(e) => up({ currency: e.target.value })}>
                    {ref.currencies.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </label>
              </div>
            )}
            {target === "LOST" && (
              <label className={"field" + (blockers.includes("contact.needReason") ? " has-error" : "")}>
                <span className="field-l">{t("dialog.lost.reason")}</span>
                <select value={s.lostReason} onChange={(e) => up({ lostReason: e.target.value })} aria-required="true">
                  <option value="">—</option>
                  {ref.lostReasons.map((r) => (
                    <option key={r.code} value={r.code}>
                      {reasonName(r.code)}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        )}
        {statusVisible && s.status === "not_interested" && !line && (
          <p className="field-h">{t("customerStatus.lostHint")}</p>
        )}

        {/* 8. Havuz bilgisi */}
        {form.assignsOnSave && (
          <p className="cd-line cd-info">
            <Icon name="hand" size={16} />
            <span>{t("contact.assignsOnSave")}</span>
          </p>
        )}
        {blockers.length > 0 && <p className="field-h cd-block">{blockers.map((b) => t(b)).join(" · ")}</p>}
        {saveError && (
          <p className="field-err" role="alert">
            <Icon name="warn" size={14} /> {saveError}
          </p>
        )}
        {confirmClose && (
          <div className="cd-confirm" role="alertdialog" aria-label={t("contact.discardTitle")}>
            <p>{t("contact.discardTitle")}</p>
            <Button variant="pri" autoFocus onClick={() => setConfirmClose(false)}>
              {t("contact.keepEditing")}
            </Button>
            <Button onClick={onClose}>{t("common.close")}</Button>
          </div>
        )}
      </div>
    );
  };

  const save = async () => {
    if (!form || !rules || !s) return;
    if (saveBlockers(s, form, rules, nowMs, files.length).length) return;
    setSaving(true);
    setSaveError(null);
    try {
      const r = await contactApi.log(open.leadId, buildBody(s, form, rules));
      if (files.length) {
        const failed = await uploadAll(open.leadId, files, r.activity.id);
        if (failed.length) toast(t("attach.failedSaved", { names: failed.join(", ") }), { bad: true });
      }
      onSaved(r);
    } catch (e) {
      const text = errText(e);
      setSaveError(text === "network" ? t("contact.netError") : text);
    } finally {
      setSaving(false);
    }
  };
  const ready = !!(form && rules && s);
  const blocked = ready && saveBlockers(s!, form!, rules!, nowMs, files.length).length > 0;

  return (
    <Modal
      title={t("contact.log")}
      onClose={requestClose}
      width={560}
      footer={
        <>
          <Button onClick={requestClose}>{t("common.cancel")}</Button>
          <Button variant="pri" size="lg" loading={saving} disabled={!ready || blocked} onClick={save}>
            {saving ? t("contact.saving") : t("common.save")}
          </Button>
        </>
      }
    >
      <p className="cd-sub">
        {open.leadName}
        {form ? ` · ${stageName(form.lead.currentStage)}` : ""}
      </p>
      {body()}
    </Modal>
  );
}
