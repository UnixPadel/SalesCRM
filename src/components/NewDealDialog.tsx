import { useEffect, useMemo, useRef, useState } from "react";
import { COURT_MODELS, CURRENCIES, ORG_TYPES, STAGES, COUNTRY_NAME, LOST_REASONS } from "../domain/constants";
import type { Currency, OrgType, StageKey } from "../domain/types";
import { createDeal } from "../services/crmService";
import { useCrm } from "../state/CrmContext";
import { Button, Field, Modal } from "./ui";

const NEW = "__new";
type Touched = Partial<Record<"orgName" | "title" | "value" | "lostReason", boolean>>;

/** Single-column form in three groups; secondary fields appear only when they apply. */
export function NewDealDialog({ onClose }: { onClose: () => void }) {
  const { data, run, me, openDeal, owners } = useCrm();
  const [orgId, setOrgId] = useState(NEW);
  const [orgName, setOrgName] = useState("");
  const [orgCountry, setOrgCountry] = useState("TR");
  const [orgType, setOrgType] = useState<OrgType>("club");
  const [contactId, setContactId] = useState(NEW);
  const [person, setPerson] = useState({ name: "", email: "", phone: "", role: "" });
  const [title, setTitle] = useState("");
  const [value, setValue] = useState("");
  const [currency, setCurrency] = useState<Currency>("EUR");
  const [courts, setCourts] = useState("");
  const [model, setModel] = useState(COURT_MODELS[0]);
  const [stage, setStage] = useState<StageKey>("contacted");
  const [owner, setOwner] = useState(me);
  const [close, setClose] = useState("");
  const [lostReason, setLostReason] = useState("");
  const [touched, setTouched] = useState<Touched>({});
  const [saving, setSaving] = useState(false);
  const [focusInvalid, setFocusInvalid] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);
  // Focus the first invalid field once the error state has rendered.
  useEffect(() => {
    if (focusInvalid) formRef.current?.querySelector<HTMLElement>("[aria-invalid='true']")?.focus();
  }, [focusInvalid]);

  const orgs = useMemo(() => [...data.organizations].sort((a, b) => a.name.localeCompare(b.name, "tr")), [data.organizations]);
  const people = data.contacts.filter((c) => orgId !== NEW && c.organization_id === orgId);
  const orgLabel = orgId === NEW ? orgName.trim() : orgs.find((o) => o.id === orgId)?.name || "";
  const autoTitle = orgLabel ? `${orgLabel}${courts ? ` — ${courts} kort` : ""}` : "";

  const errors = {
    orgName: orgId === NEW && !orgName.trim() ? "Organizasyon adı girin ya da listeden seçin." : "",
    title: !title.trim() && !autoTitle ? "Müşteri adı girin." : "",
    value: value !== "" && Number(value) < 0 ? "Değer negatif olamaz." : "",
    lostReason: stage === "lost" && !lostReason ? "Red line için olumsuz sonuç nedeni seçin." : "",
  };
  const err = (k: keyof Touched) => (touched[k] ? errors[k] : "");
  const blur = (k: keyof Touched) => () => setTouched((t) => ({ ...t, [k]: true }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched({ orgName: true, title: true, value: true, lostReason: true });
    if (Object.values(errors).some(Boolean)) {
      setFocusInvalid((n) => n + 1);
      return;
    }
    setSaving(true);
    const deal = await run(
      (repo) =>
        createDeal(repo, {
          title: title.trim() || autoTitle,
          organization: orgId === NEW ? { name: orgName, country: orgCountry, type: orgType } : { id: orgId },
          contact: contactId === NEW ? person : { id: contactId },
          stage,
          value: Number(value) || 0,
          currency,
          court_count: Number(courts) || 0,
          court_model: model,
          expected_close_date: close || null,
          owner,
          lostReason,
        }),
      "Müşteri panoya eklendi",
    );
    setSaving(false);
    if (deal) {
      onClose();
      openDeal(deal.id);
    }
  };

  return (
    <Modal
      title="Yeni müşteri"
      onClose={onClose}
      width={560}
      footer={
        <>
          <Button onClick={onClose}>Vazgeç</Button>
          <Button variant="pri" type="submit" form="new-deal" loading={saving}>
            Müşteriyi ekle
          </Button>
        </>
      }
    >
      <form id="new-deal" ref={formRef} onSubmit={submit} noValidate>
        <fieldset className="form-group">
          <legend>Organizasyon</legend>
          <Field label="Organizasyon">
            <select value={orgId} onChange={(e) => (setOrgId(e.target.value), setContactId(NEW))}>
              <option value={NEW}>+ Yeni organizasyon oluştur</option>
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </Field>
          {orgId === NEW && (
            <>
              <Field label="Organizasyon adı" error={err("orgName")} errorId="e-org">
                <input
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  onBlur={blur("orgName")}
                  aria-invalid={!!err("orgName")}
                  aria-describedby={err("orgName") ? "e-org" : undefined}
                  placeholder="Ör. Padel Club Bodrum"
                />
              </Field>
              <Field label="Ülke">
                <select value={orgCountry} onChange={(e) => setOrgCountry(e.target.value)}>
                  {Object.entries(COUNTRY_NAME)
                    .sort((a, b) => a[1].localeCompare(b[1], "tr"))
                    .map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="Tip">
                <select value={orgType} onChange={(e) => setOrgType(e.target.value as OrgType)}>
                  {ORG_TYPES.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </Field>
            </>
          )}
        </fieldset>

        <fieldset className="form-group">
          <legend>İlgili kişi</legend>
          <Field label="Kişi">
            <select value={contactId} onChange={(e) => setContactId(e.target.value)}>
              <option value={NEW}>{people.length ? "+ Yeni kişi ekle" : "+ Yeni kişi ekle (isteğe bağlı)"}</option>
              {people.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          {contactId === NEW && (
            <>
              <Field label="Ad soyad">
                <input value={person.name} onChange={(e) => setPerson({ ...person, name: e.target.value })} autoComplete="off" />
              </Field>
              <Field label="E-posta">
                <input type="email" value={person.email} onChange={(e) => setPerson({ ...person, email: e.target.value })} autoComplete="off" />
              </Field>
              <Field label="Telefon" hint="Ülke koduyla: +90 532 …">
                <input type="tel" value={person.phone} onChange={(e) => setPerson({ ...person, phone: e.target.value })} autoComplete="off" />
              </Field>
            </>
          )}
        </fieldset>

        <fieldset className="form-group">
          <legend>Müşteri kartı</legend>
          <Field
            label="Müşteri adı"
            error={err("title")}
            errorId="e-title"
            hint={!title && autoTitle ? `Boş bırakılırsa: “${autoTitle}”` : undefined}
          >
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={blur("title")}
              aria-invalid={!!err("title")}
              aria-describedby={err("title") ? "e-title" : undefined}
              placeholder={autoTitle || "Ör. Padel Club Bodrum"}
            />
          </Field>
          <Field label="Tahmini değer" error={err("value")} errorId="e-value">
            <div className="pair">
              <input
                type="number"
                min={0}
                inputMode="decimal"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onBlur={blur("value")}
                aria-invalid={!!err("value")}
              />
              <select value={currency} onChange={(e) => setCurrency(e.target.value as Currency)} aria-label="Para birimi">
                {CURRENCIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </div>
          </Field>
          <Field label="Kort adedi">
            <input type="number" min={0} inputMode="numeric" value={courts} onChange={(e) => setCourts(e.target.value)} />
          </Field>
          <Field label="Kort modeli">
            <select value={model} onChange={(e) => setModel(e.target.value)}>
              {COURT_MODELS.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </Field>
          <Field label="Kolon" hint={stage === "proforma_sent" ? "Kaydedince 3 gün sonrasına takip araması planlanır." : undefined}>
            <select value={stage} onChange={(e) => setStage(e.target.value as StageKey)}>
              {STAGES.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.no}. {s.label}
                </option>
              ))}
            </select>
          </Field>
          {stage === "lost" && (
            <Field label="Olumsuz sonuç nedeni" error={err("lostReason")} errorId="e-lost">
              <select
                value={lostReason}
                onChange={(e) => setLostReason(e.target.value)}
                onBlur={blur("lostReason")}
                aria-invalid={!!err("lostReason")}
              >
                <option value="">Seçin…</option>
                {LOST_REASONS.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Sorumlu satışçı">
            <select value={owner} onChange={(e) => setOwner(e.target.value)}>
              <option value="">Ortak havuz (sahipsiz)</option>
              {owners.map((o) => (
                <option key={o} value={o}>
                  {o}
                  {o === me ? " (ben)" : ""}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Tahmini kapanış">
            <input type="date" value={close} onChange={(e) => setClose(e.target.value)} />
          </Field>
        </fieldset>
      </form>
    </Modal>
  );
}
