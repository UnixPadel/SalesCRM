import { useEffect, useState, type FormEvent } from "react";
import { Button, Field } from "../components/ui";
import { COURT_MODELS } from "../domain/constants";
import { useLang } from "../i18n";
import type { LeadDto, OrganizationDto, UpdateLeadBody } from "../modules/sales-pipeline/api/dto";
import { useCrm } from "../state/CrmContext";
import { PipelineError, pipelineApi } from "./api";
import { useErrorText } from "./hooks";
import { OrganizationDialog } from "./OrganizationDialog";

/**
 * Lead detayında fırsat ve serbest metin alanlarını düzenleme (Faz 6b). Doğrulama sunucuda (parseLeadFields);
 * alan hatası koddan ilgili alana eşlenir. Kuruluş bağı da burada (6d); e-posta ve telefon LeadContactForm'da.
 */
export function LeadFieldsForm({
  lead,
  onSaved,
  onCancel,
  notesOnly = false,
}: {
  lead: LeadDto;
  onSaved: (lead: LeadDto) => void;
  onCancel: () => void;
  /** Satışçı görünümü (Faz 7e): yalnız not alanı gönderilir; diğer alanlar yöneticiye ait. */
  notesOnly?: boolean;
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
    organizationId: lead.organizationId ?? "",
  });
  const [orgs, setOrgs] = useState<OrganizationDto[]>([]);
  const [newOrg, setNewOrg] = useState(false);
  useEffect(() => {
    if (notesOnly) return;
    pipelineApi
      .organizations()
      .then((rows) => setOrgs(rows.map((r) => r.organization)))
      .catch(() => setOrgs([]));
  }, [notesOnly]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ field: string; text: string } | null>(null);
  const set =
    (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setF((s) => ({ ...s, [k]: e.target.value }));
  const fieldErr = (k: string) => (err?.field === k ? err.text : "");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const body: UpdateLeadBody = notesOnly
        ? { notes: f.notes }
        : {
            courtCount: f.courtCount.trim() === "" ? null : f.courtCount.trim(),
            courtModel: f.courtModel,
            expectedCloseDate: f.expectedCloseDate || null,
            company: f.company,
            city: f.city,
            productInterest: f.productInterest,
            notes: f.notes,
            organizationId: f.organizationId || null,
          };
      const saved = await pipelineApi.update(lead.id, body);
      toast(t("lead.saved"));
      onSaved(saved);
    } catch (ex) {
      const code = ex instanceof PipelineError ? ex.code : "";
      const field = code.includes("organization")
        ? "organizationId"
        : code.includes("court_count")
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
    <form
      className="act-form lead-edit"
      onSubmit={submit}
      noValidate
      aria-label={notesOnly ? t("lead.editNotes") : t("lead.editTitle")}
    >
      {notesOnly && <p className="muted wide">{t("lead.adminOnlyHint")}</p>}
      {!notesOnly && (
        <>
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
          <div className="wide org-pick">
            <Field label={t("lead.organization")} error={fieldErr("organizationId")}>
              <select value={f.organizationId} onChange={set("organizationId")}>
                <option value="">—</option>
                {orgs.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                    {o.country ? ` (${o.country})` : ""}
                  </option>
                ))}
              </select>
            </Field>
            <Button size="sm" icon="plus" onClick={() => setNewOrg(true)}>
              {t("org.new")}
            </Button>
          </div>
          {newOrg && (
            <OrganizationDialog
              onClose={() => setNewOrg(false)}
              onSaved={(o) => {
                setNewOrg(false);
                setOrgs((list) =>
                  [...list.filter((x) => x.id !== o.id), o].sort((a, b) => a.name.localeCompare(b.name, "tr")),
                );
                setF((s) => ({ ...s, organizationId: o.id }));
              }}
            />
          )}
        </>
      )}
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
