import { useState } from "react";
import { Button, Field, Modal } from "../components/ui";
import { COUNTRY_NAME } from "../domain/constants";
import { useLang } from "../i18n";
import { navigate } from "../router";
import { useCrm } from "../state/CrmContext";
import { PipelineError, pipelineApi } from "./api";
import type {
  CourtCountBandDto,
  CustomerProfileDto,
  CustomerStatusDto,
  InstallSiteDto,
  InstallTimelineDto,
  ProductPrefsDto,
} from "../modules/sales-pipeline/api/dto";
import { ProductPrefsForm } from "./contact/LeadSections";
import { useErrorText, useReference, useTeamNames } from "./hooks";

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
    expectedCloseDate: "",
    notes: "",
    customerStatus: "",
    installSite: "",
    installTimeline: "",
    customerProfile: "",
    courtCountBand: "",
    // Faz 7g (§5.7): varsayılan "Otomatik (ülke kuralına göre)" → sorumlu gönderilmez.
    assignedUserId: "auto",
    isTest: false,
  });
  const [products, setProducts] = useState<ProductPrefsDto>({
    standard: null,
    panoramic: null,
    fullPanoramic: null,
    roof: { wanted: false, widthM: null, lengthM: null },
  });
  const { ref } = useReference();
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
        ...(f.customerStatus ? { customerStatus: f.customerStatus as CustomerStatusDto } : {}),
        // Fırsat alanları, ürünler, form cevapları ve sorumlu yalnız yöneticide (sunucu kuralıyla aynı).
        ...(isAdmin
          ? {
              expectedCloseDate: f.expectedCloseDate || null,
              products,
              installSite: (f.installSite || null) as InstallSiteDto | null,
              installTimeline: (f.installTimeline || null) as InstallTimelineDto | null,
              customerProfile: (f.customerProfile || null) as CustomerProfileDto | null,
              courtCountBand: (f.courtCountBand || null) as CourtCountBandDto | null,
              ...(f.assignedUserId === "auto" ? {} : { assignedUserId: f.assignedUserId || null }),
            }
          : {}),
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
                  : ex.code.includes("court_count")
                    ? "courtCount"
                    : ex.code.includes("expected_close")
                      ? "expectedCloseDate"
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
            <input value={f.productInterest} onChange={set("productInterest")} maxLength={200} />
          </Field>
        </div>
        <Field label={t("new.notes")}>
          <textarea rows={2} value={f.notes} onChange={set("notes")} />
        </Field>
        <Field label={t("customerStatus.label")} hint={t("customerStatus.help")}>
          <select value={f.customerStatus} onChange={set("customerStatus")}>
            <option value="">{t("customerStatus.none")}</option>
            {(ref?.customerStatuses ?? []).map((x) => (
              <option key={x.code} value={x.code}>
                {t(`customerStatus.${x.code}`)}
              </option>
            ))}
          </select>
        </Field>
        {isAdmin && (
          <details className="new-more">
            <summary>{t("new.more")}</summary>
            <div className="field">
              <span className="field-l">{t("product.title")}</span>
              <ProductPrefsForm value={products} onChange={setProducts} />
            </div>
            <div className="form-2">
              {(
                [
                  ["installSite", "answer.installSite", "answer.site", ref?.installSites ?? []],
                  [
                    "installTimeline",
                    "answer.installTimeline",
                    "answer.timeline",
                    (ref?.installTimelines ?? []).map((x) => x.code),
                  ],
                  ["customerProfile", "answer.customerProfile", "answer.profile", ref?.customerProfiles ?? []],
                  ["courtCountBand", "answer.courtCountBand", "answer.band", ref?.courtCountBands ?? []],
                ] as const
              ).map(([key, label, prefix, codes]) => (
                <Field key={key} label={t(label)}>
                  <select value={f[key]} onChange={set(key)}>
                    <option value="">—</option>
                    {codes.map((c) => (
                      <option key={c} value={c}>
                        {t(`${prefix}.${c}`)}
                      </option>
                    ))}
                  </select>
                </Field>
              ))}
            </div>
            <Field label={t("lead.expectedClose")} error={fieldErr("expectedCloseDate")}>
              <input type="date" value={f.expectedCloseDate} onChange={set("expectedCloseDate")} />
            </Field>
          </details>
        )}
        {isAdmin && (
          <Field label={t("new.assign")}>
            <select value={f.assignedUserId} onChange={set("assignedUserId")}>
              <option value="auto">{t("new.assignAuto")}</option>
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
