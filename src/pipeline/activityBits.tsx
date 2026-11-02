import { useState, type FormEvent } from "react";
import { Button, Field, Icon, StatusTag, fmtDate, relDays } from "../components/ui";
import { useLang } from "../i18n";
import type { ActivityDto, ActivityTypeDto, AddActivityBody, TodayItemDto } from "../modules/sales-pipeline/api/dto";
import { navigate } from "../router";
import { useErrorText } from "./hooks";
import { pipelineApi } from "./api";
import { useCrm } from "../state/CrmContext";

/** Aktivite parçaları (Faz 6a): satır, ekleme formu, tür simgeleri. Detay sayfası ve "Bugün" paylaşır. */

export const ACTIVITY_TYPES: readonly ActivityTypeDto[] = ["call", "email", "meeting", "proposal_sent", "site_visit"];

export const ACTIVITY_ICON: Record<ActivityTypeDto, string> = {
  call: "phone",
  email: "mail",
  meeting: "users",
  proposal_sent: "file",
  site_visit: "pin",
};

export type DueState = "overdue" | "today" | "upcoming";

/** Tarayıcının takvim gününe göre: dün ve öncesi gecikmiş, bugün bugün, sonrası yaklaşan. */
export function dueState(iso: string, now = Date.now()): DueState {
  const d = new Date(iso);
  const n = new Date(now);
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = day(d) - day(n);
  return diff < 0 ? "overdue" : diff === 0 ? "today" : "upcoming";
}

export function ActivityItem({
  a,
  lead,
  canEdit,
  onToggle,
  onDelete,
  now,
}: {
  a: ActivityDto;
  /** "Bugün" sayfasında: hangi lead'in işi; detayda verilmez. */
  lead?: TodayItemDto["lead"];
  canEdit: boolean;
  onToggle: (done: boolean) => void;
  onDelete?: () => void;
  now: number;
}) {
  const { t } = useLang();
  const done = a.doneAt !== null;
  const state = done ? "done" : dueState(a.dueAt, now);
  return (
    <div className={`arow is-${state}`}>
      <label className="arow-check" title={done ? t("activity.markOpen") : t("activity.markDone")}>
        <input type="checkbox" checked={done} disabled={!canEdit} onChange={() => onToggle(!done)} />
        <span className="sr-only">{a.subject}</span>
      </label>
      <span className="arow-ic" aria-hidden="true">
        <Icon name={ACTIVITY_ICON[a.type]} />
      </span>
      <div className="arow-main">
        <div className="arow-title">
          <span className={done ? "done" : ""}>{a.subject}</span>
          <span className="tag tag-neutral">{t(`activity.type.${a.type}`)}</span>
          {a.autoCreated && <span className="tag">{t("activity.auto")}</span>}
        </div>
        {a.notes && <p className="arow-notes">{a.notes}</p>}
        {lead && (
          <button className="dealref" type="button" onClick={() => navigate("lead", undefined, lead.id)}>
            <Icon name="user" size={14} /> {lead.fullName}
            {lead.company && <span className="muted"> · {lead.company}</span>}
          </button>
        )}
      </div>
      <div className="arow-due">
        {!done && state !== "upcoming" && (
          <StatusTag tone={state === "overdue" ? "bad" : "ok"} icon={state === "overdue" ? "alarm" : "clock"}>
            {state === "overdue" ? t("activity.overdue") : t("activity.today")} · {relDays(a.dueAt)}
          </StatusTag>
        )}
        <time dateTime={a.dueAt}>{fmtDate(a.dueAt, true)}</time>
        {canEdit && onDelete && (
          <button className="btn btn-ghost btn-sm" type="button" onClick={onDelete} aria-label={t("activity.delete")}>
            <Icon name="trash" size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

/** Yarın 09:00, `datetime-local` biçiminde (yerel saat). */
function defaultDue(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function AddActivityForm({ leadId, onAdded }: { leadId: string; onAdded: (a: ActivityDto) => void }) {
  const { t } = useLang();
  const { toast } = useCrm();
  const errText = useErrorText();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<ActivityTypeDto>("call");
  const [subject, setSubject] = useState("");
  const [due, setDue] = useState(defaultDue);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  if (!open) {
    return (
      <Button icon="plus" onClick={() => setOpen(true)}>
        {t("activity.add")}
      </Button>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const dueAt = new Date(due);
    if (Number.isNaN(dueAt.getTime())) return setErr(t("err.activity.due_required"));
    setSaving(true);
    setErr("");
    try {
      const body: AddActivityBody = { type, subject: subject.trim(), dueAt: dueAt.toISOString(), notes: notes.trim() };
      const a = await pipelineApi.addActivity(leadId, body);
      toast(t("activity.added"));
      setSubject("");
      setNotes("");
      setDue(defaultDue());
      setOpen(false);
      onAdded(a);
    } catch (ex) {
      setErr(errText(ex));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="act-form" onSubmit={submit} aria-label={t("activity.add")}>
      <Field label={t("activity.type")}>
        <select value={type} onChange={(e) => setType(e.target.value as ActivityTypeDto)}>
          {ACTIVITY_TYPES.map((k) => (
            <option key={k} value={k}>
              {t(`activity.type.${k}`)}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t("activity.due")} error={err} errorId="act-due-err">
        <input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} required />
      </Field>
      <div className="wide">
        <Field label={t("activity.subject")}>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder={t(`activity.type.${type}`)}
            maxLength={200}
          />
        </Field>
      </div>
      <div className="wide">
        <Field label={t("activity.notes")}>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={4000} />
        </Field>
      </div>
      <div className="modal-actions wide">
        <Button onClick={() => setOpen(false)}>{t("common.cancel")}</Button>
        <Button variant="pri" icon="calendar" loading={saving} type="submit">
          {t("activity.save")}
        </Button>
      </div>
    </form>
  );
}
