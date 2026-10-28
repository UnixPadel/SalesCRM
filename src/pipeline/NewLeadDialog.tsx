import { useState } from "react";
import { Button, Field, Modal } from "../components/ui";
import { COUNTRY_NAME, COURT_MODELS } from "../domain/constants";
import { useLang } from "../i18n";
import { navigate } from "../router";
import { useCrm } from "../state/CrmContext";
import { PipelineError, pipelineApi } from "./api";
import { useErrorText, useTeamNames } from "./hooks";

const COUNTRIES = Object.entries(COUNTRY_NAME).sort((a, b) => a[1].localeCompare(b[1], "tr"));

/** Manuel lead ekleme formu. Doğrulama sunucuda; alan hataları koddan alana eşlenir. */
export function NewLeadDialog({ onClose }: { onClose: () => void }) {
  const { t } = useLang();
  const { toast, isAdmin } = useCrm();
  const { team } = useTeamNames();
  const errText = useErrorText();
  const [f, setF] = useState({
    fullName: "",
    email: "",
    phone: "",
    country: "",
    city: "",
    company: "",
    productInterest: "",
    notes: "",
    assignedUserId: "",
    isTest: false,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ field: string; text: string } | null>(null);
  const set =
    (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setF((s) => ({
        ...s,
        [k]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value,
      }));
  const fieldErr = (k: string) => (err?.field === k ? err.text : "");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (!f.fullName.trim()) return setErr({ field: "fullName", text: t("err.lead.name_required") });
    if (!f.email.trim() && !f.phone.trim()) return setErr({ field: "email", text: t("new.contactErr") });
    setBusy(true);
    try {
      const r = await pipelineApi.create({
        fullName: f.fullName,
        email: f.email,
        phone: f.phone,
        country: f.country,
        city: f.city,
        company: f.company,
        productInterest: f.productInterest,
        notes: f.notes,
        isTest: f.isTest,
        ...(isAdmin ? { assignedUserId: f.assignedUserId || null } : {}),
      });
      toast(r.personMatched ? `${t("new.created")} · ${t("new.personMatched")}` : t("new.created"));
      onClose();
      navigate("lead", undefined, r.lead.id);
    } catch (ex) {
      const field =
        ex instanceof PipelineError
          ? ex.code.startsWith("email")
            ? "email"
            : ex.code.startsWith("phone")
              ? "phone"
              : ex.code.includes("country")
                ? "country"
                : ex.code.includes("name")
                  ? "fullName"
                  : ""
          : "";
      if (field) setErr({ field, text: errText(ex) });
      else toast(errText(ex), { bad: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={t("new.title")} onClose={onClose} width={560}>
      <form onSubmit={submit} noValidate className="new-lead">
        <Field label={t("new.fullName")} error={fieldErr("fullName")}>
          <input value={f.fullName} onChange={set("fullName")} autoComplete="off" required />
        </Field>
        <div className="form-2">
          <Field label={t("new.email")} error={fieldErr("email")}>
            <input type="email" inputMode="email" value={f.email} onChange={set("email")} />
          </Field>
          <Field label={t("new.phone")} hint={t("new.phoneHint")} error={fieldErr("phone")}>
            <input type="tel" inputMode="tel" value={f.phone} onChange={set("phone")} />
          </Field>
        </div>
        <div className="form-2">
          <Field label={t("new.country")} error={fieldErr("country")}>
            <select value={f.country} onChange={set("country")}>
              <option value="">—</option>
              {COUNTRIES.map(([code, name]) => (
                <option key={code} value={code}>
                  {name} ({code})
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("new.city")}>
            <input value={f.city} onChange={set("city")} />
          </Field>
        </div>
        <div className="form-2">
          <Field label={t("new.company")}>
            <input value={f.company} onChange={set("company")} />
          </Field>
          <Field label={t("new.product")}>
            <input list="court-models" value={f.productInterest} onChange={set("productInterest")} />
            <datalist id="court-models">
              {COURT_MODELS.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </Field>
        </div>
        <Field label={t("new.notes")}>
          <textarea rows={2} value={f.notes} onChange={set("notes")} />
        </Field>
        {isAdmin && (
          <Field label={t("new.assign")}>
            <select value={f.assignedUserId} onChange={set("assignedUserId")}>
              <option value="">{t("common.pool")}</option>
              {team.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        {isAdmin && (
          <label className="check">
            <input type="checkbox" checked={f.isTest} onChange={set("isTest")} /> {t("new.isTest")}
          </label>
        )}
        <div className="modal-actions">
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="pri" type="submit" loading={busy} icon="plus">
            {t("new.create")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
