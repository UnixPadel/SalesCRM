import { useState, type FormEvent } from "react";
import { Button, Field } from "../components/ui";
import { COURT_MODELS } from "../domain/constants";
import { useLang } from "../i18n";
import type { LeadDto, UpdateLeadBody } from "../modules/sales-pipeline/api/dto";
import { useCrm } from "../state/CrmContext";
import { PipelineError, pipelineApi } from "./api";
import { useErrorText } from "./hooks";

/**
 * Lead detayında fırsat ve serbest metin alanlarını düzenleme (Faz 6b). Doğrulama sunucuda (parseLeadFields);
 * alan hatası koddan ilgili alana eşlenir. E-posta ve telefon burada değil (kimlik alanları, 6d).
 */
export function LeadFieldsForm({
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
  const [f, setF] = useState({
    courtCount: lead.courtCount === null ? "" : String(lead.courtCount),
    courtModel: lead.courtModel,
    expectedCloseDate: lead.expectedCloseDate ?? "",
    company: lead.company,
    city: lead.city,
    productInterest: lead.productInterest,
    notes: lead.notes,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ field: string; text: string } | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setF((s) => ({ ...s, [k]: e.target.value }));
  const fieldErr = (k: string) => (err?.field === k ? err.text : "");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const body: UpdateLeadBody = {
        courtCount: f.courtCount.trim() === "" ? null : f.courtCount.trim(),
        courtModel: f.courtModel,
        expectedCloseDate: f.expectedCloseDate || null,
        company: f.company,
        city: f.city,
        productInterest: f.productInterest,
        notes: f.notes,
      };
      const saved = await pipelineApi.update(lead.id, body);
      toast(t("lead.saved"));
      onSaved(saved);
    } catch (ex) {
      const code = ex instanceof PipelineError ? ex.code : "";
      const field = code.includes("court_count")
        ? "courtCount"
        : code.includes("court_model")
          ? "courtModel"
          : code.includes("expected_close")
            ? "expectedCloseDate"
            : code.includes("company")
              ? "company"
              : code.includes("city")
                ? "city"
                : code.includes("product_interest")
                  ? "productInterest"
                  : code.includes("notes")
                    ? "notes"
                    : "";
      if (field) setErr({ field, text: errText(ex) });
      else toast(errText(ex), { bad: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="act-form lead-edit" onSubmit={submit} noValidate aria-label={t("lead.editTitle")}>
      <Field label={t("lead.courtCount")} error={fieldErr("courtCount")}>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          max={999}
          step={1}
          value={f.courtCount}
          onChange={set("courtCount")}
        />
      </Field>
      <Field label={t("lead.courtModel")} error={fieldErr("courtModel")}>
        <input list="court-models-edit" value={f.courtModel} onChange={set("courtModel")} maxLength={64} />
        <datalist id="court-models-edit">
          {COURT_MODELS.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </Field>
      <Field label={t("lead.expectedClose")} error={fieldErr("expectedCloseDate")}>
        <input type="date" value={f.expectedCloseDate} onChange={set("expectedCloseDate")} />
      </Field>
      <Field label={t("lead.product")} error={fieldErr("productInterest")}>
        <input value={f.productInterest} onChange={set("productInterest")} maxLength={200} />
      </Field>
      <Field label={t("lead.company")} error={fieldErr("company")}>
        <input value={f.company} onChange={set("company")} maxLength={200} />
      </Field>
      <Field label={t("lead.city")} error={fieldErr("city")}>
        <input value={f.city} onChange={set("city")} maxLength={200} />
      </Field>
      <div className="wide">
        <Field label={t("lead.notes")} error={fieldErr("notes")}>
          <textarea rows={3} value={f.notes} onChange={set("notes")} maxLength={4000} />
        </Field>
      </div>
      <div className="modal-actions wide">
        <Button onClick={onCancel}>{t("common.cancel")}</Button>
        <Button variant="pri" type="submit" loading={busy} icon="check">
          {t("common.save")}
        </Button>
      </div>
    </form>
  );
}
