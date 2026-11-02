import { useState, type FormEvent } from "react";
import { Button, Field } from "../components/ui";
import { useLang } from "../i18n";
import type { LeadDto, UpdateContactBody } from "../modules/sales-pipeline/api/dto";
import { useCrm } from "../state/CrmContext";
import { PipelineError, pipelineApi } from "./api";
import { useErrorText } from "./hooks";

/**
 * Kimlik alanları (Faz 6d): ad, e-posta, telefon. Lead ve bağlı kişi kaydı sunucuda birlikte güncellenir;
 * e-posta ya da telefondan biri kalmalı; başka kişiye kayıtlı e-posta/telefon reddedilir.
 */
export function LeadContactForm({
  lead,
  onSaved,
  onCancel,
}: {
  lead: LeadDto;
  onSaved: (lead: LeadDto) => void;
  onCancel: () => void;
}) {
  const { t } = useLang();
  const { toast } = useCrm();
  const errText = useErrorText();
  const [f, setF] = useState({ fullName: lead.fullName, email: lead.email ?? "", phone: lead.phoneE164 ?? "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ field: string; text: string } | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF((s) => ({ ...s, [k]: e.target.value }));
  const fieldErr = (k: string) => (err?.field === k ? err.text : "");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (!f.fullName.trim()) return setErr({ field: "fullName", text: t("err.lead.name_required") });
    if (!f.email.trim() && !f.phone.trim()) return setErr({ field: "email", text: t("new.contactErr") });
    setBusy(true);
    try {
      const body: UpdateContactBody = {
        fullName: f.fullName,
        email: f.email.trim() || null,
        phone: f.phone.trim() || null,
      };
      const saved = await pipelineApi.updateContact(lead.id, body);
      toast(t("lead.saved"));
      onSaved(saved);
    } catch (ex) {
      const code = ex instanceof PipelineError ? ex.code : "";
      const field =
        code.startsWith("email") || code === "person.email_taken" || code === "lead.contact_required"
          ? "email"
          : code.startsWith("phone") || code === "person.phone_taken"
            ? "phone"
            : code.includes("name")
              ? "fullName"
              : "";
      if (field) setErr({ field, text: errText(ex) });
      else toast(errText(ex), { bad: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="act-form lead-edit" onSubmit={submit} noValidate aria-label={t("lead.editContact")}>
      <div className="wide">
        <Field label={t("new.fullName")} error={fieldErr("fullName")}>
          <input value={f.fullName} onChange={set("fullName")} maxLength={200} required autoComplete="off" />
        </Field>
      </div>
      <Field label={t("new.email")} error={fieldErr("email")}>
        <input type="email" inputMode="email" value={f.email} onChange={set("email")} />
      </Field>
      <Field label={t("new.phone")} hint={t("new.phoneHint")} error={fieldErr("phone")}>
        <input type="tel" inputMode="tel" value={f.phone} onChange={set("phone")} />
      </Field>
      <div className="modal-actions wide">
        <Button onClick={onCancel}>{t("common.cancel")}</Button>
        <Button variant="pri" type="submit" loading={busy} icon="check">
          {t("common.save")}
        </Button>
      </div>
    </form>
  );
}
