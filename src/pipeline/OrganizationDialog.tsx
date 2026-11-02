import { useState, type FormEvent } from "react";
import { Button, Field, Modal } from "../components/ui";
import { COUNTRY_NAME } from "../domain/constants";
import { useLang } from "../i18n";
import type { OrganizationBody, OrganizationDto, OrganizationTypeDto } from "../modules/sales-pipeline/api/dto";
import { useCrm } from "../state/CrmContext";
import { PipelineError, pipelineApi } from "./api";
import { useErrorText } from "./hooks";

export const ORGANIZATION_TYPES: readonly OrganizationTypeDto[] = [
  "club",
  "investor",
  "distributor",
  "contractor",
  "other",
];
const COUNTRIES = Object.entries(COUNTRY_NAME).sort((a, b) => a[1].localeCompare(b[1], "tr"));

/** Kuruluş oluşturma / düzenleme penceresi (Faz 6d). Doğrulama sunucuda; ad hatası alana, kalanı balona. */
export function OrganizationDialog({
  initial,
  onClose,
  onSaved,
}: {
  /** Verilirse düzenleme; yoksa yeni kuruluş. */
  initial?: OrganizationDto;
  onClose: () => void;
  onSaved: (o: OrganizationDto) => void;
}) {
  const { t } = useLang();
  const { toast } = useCrm();
  const errText = useErrorText();
  const [f, setF] = useState({
    name: initial?.name ?? "",
    type: (initial?.type ?? "club") as OrganizationTypeDto,
    country: initial?.country ?? "",
    website: initial?.website ?? "",
    notes: initial?.notes ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [nameErr, setNameErr] = useState("");
  const set =
    (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setF((s) => ({ ...s, [k]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setNameErr("");
    if (!f.name.trim()) return setNameErr(t("err.organization.name_required"));
    setBusy(true);
    try {
      const body: OrganizationBody = {
        name: f.name,
        type: f.type,
        country: f.country || null,
        website: f.website,
        notes: f.notes,
      };
      const saved = initial
        ? await pipelineApi.updateOrganization(initial.id, body)
        : await pipelineApi.createOrganization(body);
      toast(initial ? t("org.saved") : t("org.created"));
      onSaved(saved);
    } catch (ex) {
      if (ex instanceof PipelineError && ex.code.startsWith("organization.name")) setNameErr(errText(ex));
      else if (ex instanceof PipelineError && ex.code === "organization.duplicate") setNameErr(errText(ex));
      else toast(errText(ex), { bad: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={initial ? t("org.editTitle") : t("org.newTitle")} onClose={onClose} width={520}>
      <form onSubmit={submit} noValidate className="new-lead">
        <Field label={t("org.name")} error={nameErr}>
          <input value={f.name} onChange={set("name")} maxLength={200} required autoComplete="off" />
        </Field>
        <div className="form-2">
          <Field label={t("org.type")}>
            <select value={f.type} onChange={set("type")}>
              {ORGANIZATION_TYPES.map((k) => (
                <option key={k} value={k}>
                  {t(`org.type.${k}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("new.country")}>
            <select value={f.country} onChange={set("country")}>
              <option value="">—</option>
              {COUNTRIES.map(([code, name]) => (
                <option key={code} value={code}>
                  {name} ({code})
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label={t("org.website")}>
          <input value={f.website} onChange={set("website")} maxLength={200} inputMode="url" />
        </Field>
        <Field label={t("lead.notes")}>
          <textarea rows={2} value={f.notes} onChange={set("notes")} maxLength={4000} />
        </Field>
        <div className="modal-actions">
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="pri" type="submit" loading={busy} icon={initial ? "check" : "plus"}>
            {initial ? t("common.save") : t("org.create")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
