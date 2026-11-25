import { useCallback, useState, type ReactNode } from "react";
import { Button, Field, Icon, Modal } from "../components/ui";
import { useLang } from "../i18n";
import type {
  ActivityDto,
  ActivityOutcomeDto,
  ActivityTypeDto,
  UpdateActivityBody,
} from "../modules/sales-pipeline/api/dto";
import { useCrm } from "../state/CrmContext";
import { ACTIVITY_TYPES } from "./activityBits";
import { pipelineApi } from "./api";
import { contactApi } from "./contact/contactApi";
import { toLocalInput } from "./contact/dialogState";
import { useErrorText, useReference } from "./hooks";

/** Sunucudaki alt sınırla aynı (application/contacts.ts `CONTACT_DELETE_REASON_MIN`). */
const REASON_MIN = 3;

/**
 * Aktivite düzenleme ve temas silme pencereleri (2026-11-25). Açık iş: tür, konu, vade, not (işi açabilen herkes).
 * Tamamlanmış temas: kanal, sonuç, "müşteri cevap verdi", görüşme notu, tarih (yalnız yönetici). Kurallar sunucudadır;
 * pencere yalnız `/reference` listelerini kullanır ve sunucunun hatasını gösterir.
 */
export function EditActivityDialog({
  activity,
  onClose,
  onSaved,
}: {
  activity: ActivityDto;
  onClose: () => void;
  onSaved: (a: ActivityDto) => void;
}) {
  const { t } = useLang();
  const { ref } = useReference();
  const errText = useErrorText();
  const done = activity.doneAt !== null;
  const [type, setType] = useState<ActivityTypeDto>(activity.type);
  const [subject, setSubject] = useState(activity.subject);
  const [due, setDue] = useState(toLocalInput(activity.dueAt));
  const [notes, setNotes] = useState(activity.notes);
  const [outcome, setOutcome] = useState<ActivityOutcomeDto | "">(activity.outcome ?? "");
  const [replied, setReplied] = useState(activity.customerReplied);
  const [resultNote, setResultNote] = useState(activity.resultNote);
  const [at, setAt] = useState(toLocalInput(activity.doneAt ?? activity.dueAt));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const channels: ActivityTypeDto[] = done
    ? [...new Set<ActivityTypeDto>([...(ref?.contactChannels ?? []), activity.type])]
    : [...ACTIVITY_TYPES];
  const outcomes = (ref?.outcomeDisplayOrder ?? []) as ActivityOutcomeDto[];
  const repliedApplies = outcome !== "" && (ref?.contactRules.repliedFlagOutcomes ?? []).includes(outcome);

  const submit = async () => {
    setError(null);
    let body: UpdateActivityBody;
    if (done) {
      if (!outcome) return setError(t("err.contact.outcome"));
      const when = new Date(at);
      if (Number.isNaN(when.getTime())) return setError(t("err.contact.occurred_invalid"));
      body = {
        type,
        outcome,
        customerReplied: repliedApplies && replied,
        resultNote: resultNote.trim(),
        // Dakika hassasiyetinde değişmediyse gönderilmez: saniyeli kayıt tarihi yerinde kalsın.
        ...(toLocalInput(activity.doneAt ?? activity.dueAt) !== at ? { doneAt: when.toISOString() } : {}),
      };
    } else {
      const when = new Date(due);
      if (Number.isNaN(when.getTime())) return setError(t("err.activity.due_required"));
      body = {
        type,
        subject: subject.trim(),
        notes: notes.trim(),
        ...(toLocalInput(activity.dueAt) !== due ? { dueAt: when.toISOString() } : {}),
      };
    }
    setBusy(true);
    try {
      onSaved(await pipelineApi.updateActivity(activity.id, body));
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  };

  return (
    <Modal
      title={done ? t("contact.edit.title") : t("activity.edit.title")}
      onClose={() => !busy && onClose()}
      width={480}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button variant="pri" loading={busy} onClick={submit}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      {done && <p className="lede">{t("contact.edit.lede")}</p>}
      <Field label={done ? t("contact.channel") : t("activity.type")}>
        <select value={type} onChange={(e) => setType(e.target.value as ActivityTypeDto)}>
          {channels.map((k) => (
            <option key={k} value={k}>
              {t(`activity.type.${k}`)}
            </option>
          ))}
        </select>
      </Field>
      {done ? (
        <>
          <Field label={t("contact.outcome")}>
            <select value={outcome} onChange={(e) => setOutcome(e.target.value as ActivityOutcomeDto)}>
              {!outcome && <option value="">{t("common.choose")}</option>}
              {outcomes.map((o) => (
                <option key={o} value={o}>
                  {t(`activity.outcome.${o}`)}
                </option>
              ))}
            </select>
          </Field>
          {repliedApplies && (
            <label className="cd-check">
              <input type="checkbox" checked={replied} onChange={(e) => setReplied(e.target.checked)} />
              <span>{t("contact.replied")}</span>
            </label>
          )}
          <Field label={t("contact.when")}>
            <input
              type="datetime-local"
              value={at}
              max={toLocalInput(new Date().toISOString())}
              onChange={(e) => setAt(e.target.value)}
              required
            />
          </Field>
          <Field label={t("contact.note")}>
            <textarea
              rows={4}
              maxLength={ref?.contactRules.noteMax ?? 4000}
              value={resultNote}
              onChange={(e) => setResultNote(e.target.value)}
            />
          </Field>
        </>
      ) : (
        <>
          <Field label={t("activity.due")}>
            <input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} required />
          </Field>
          <Field label={t("activity.subject")}>
            <input
              value={subject}
              maxLength={200}
              placeholder={t(`activity.type.${type}`)}
              onChange={(e) => setSubject(e.target.value)}
            />
          </Field>
          <Field label={t("activity.notes")}>
            <textarea rows={3} maxLength={4000} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </>
      )}
      {error && (
        <p className="field-err" role="alert">
          <Icon name="warn" size={14} /> {error}
        </p>
      )}
    </Modal>
  );
}

/**
 * Yönetici temas silme penceresi: neden zorunlu. Kayıt hiç girilmemiş gibi geri çevrilir (sonraki takip ve durum
 * değişikliği dahil); aşama sonradan değiştiyse yerinde kalır ve bildirim bunu söyler.
 */
export function DeleteContactDialog({
  activity,
  onClose,
  onDeleted,
}: {
  activity: ActivityDto & { logId: string };
  onClose: () => void;
  onDeleted: (stageKept: boolean) => void;
}) {
  const { t } = useLang();
  const errText = useErrorText();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ok = reason.trim().length >= REASON_MIN;
  const submit = async () => {
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      const r = await contactApi.deleteLog(activity.logId, reason.trim());
      onDeleted(r.stageKept);
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  };
  return (
    <Modal
      title={t("contact.delete.title")}
      onClose={() => !busy && onClose()}
      width={460}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button variant="danger" icon="trash" loading={busy} disabled={!ok} onClick={submit}>
            {t("contact.delete.confirm")}
          </Button>
        </>
      }
    >
      <p className="lede">{t("contact.delete.lede")}</p>
      <label className="field">
        <span className="field-l">{t("contact.delete.reason")}</span>
        <textarea
          rows={3}
          maxLength={500}
          value={reason}
          aria-required="true"
          placeholder={t("contact.delete.reasonPh")}
          onChange={(e) => setReason(e.target.value)}
        />
        <span className="field-h">{t("contact.delete.reasonHelp")}</span>
      </label>
      {error && (
        <p className="field-err" role="alert">
          <Icon name="warn" size={14} /> {error}
        </p>
      )}
    </Modal>
  );
}

/**
 * Lead sayfası, Bugün ve Temas geçmişi için tek giriş: `edit(a)` düzenleme penceresini, `remove(a)` silmeyi açar.
 * Temas kaydına bağlı satır (`logId`) nedenli silme penceresiyle, bağsız tamamlanmış ya da açık satır onayla silinir.
 */
export function useActivityEditor(onChanged: () => void): {
  edit: (a: ActivityDto) => void;
  remove: (a: ActivityDto) => void;
  dialog: ReactNode;
} {
  const { t } = useLang();
  const { toast } = useCrm();
  const errText = useErrorText();
  const [editing, setEditing] = useState<ActivityDto | null>(null);
  const [deleting, setDeleting] = useState<(ActivityDto & { logId: string }) | null>(null);

  const remove = useCallback(
    (a: ActivityDto) => {
      if (a.doneAt !== null && a.logId) return setDeleting({ ...a, logId: a.logId });
      // Açık iş eskisi gibi onaysız silinir; bağsız (ör. aktarılmış) tamamlanmış temas onay ister.
      if (a.doneAt !== null && !window.confirm(t("contact.deleteConfirm"))) return;
      pipelineApi
        .deleteActivity(a.id)
        .then(() => {
          toast(t("activity.deleted"));
          onChanged();
        })
        .catch((e) => toast(errText(e), { bad: true }));
    },
    [t, toast, errText, onChanged],
  );

  const dialog = (
    <>
      {editing && (
        <EditActivityDialog
          activity={editing}
          onClose={() => setEditing(null)}
          onSaved={(a) => {
            setEditing(null);
            toast(a.doneAt !== null ? t("contact.edit.saved") : t("activity.edit.saved"));
            onChanged();
          }}
        />
      )}
      {deleting && (
        <DeleteContactDialog
          activity={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={(stageKept) => {
            setDeleting(null);
            toast(stageKept ? t("contact.delete.doneNoStage") : t("contact.delete.done"));
            onChanged();
          }}
        />
      )}
    </>
  );

  return { edit: setEditing, remove, dialog };
}
