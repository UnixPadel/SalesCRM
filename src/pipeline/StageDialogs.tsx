import { useState, type ReactNode } from "react";
import { Button, Field, Modal } from "../components/ui";
import { refName, useLang } from "../i18n";
import type { ChangeStageBody, ReferenceDto } from "../modules/sales-pipeline/api/dto";

/** Aşamaya özel pencereler (Genel plan, satışçı arayüzü 3): ek bilgi yalnız gereken aşamada istenir. */

/** Nitelikli ayrıntılarının ön denetimi (sunucu aynı kuralı uygular): eksik alanların listesi. */
export function qualificationProblems(d: {
  amount: string;
  site: string;
  months: string;
  month: string;
}): ("budget" | "site" | "install")[] {
  const out: ("budget" | "site" | "install")[] = [];
  if (!(parseAmount(d.amount) > 0)) out.push("budget");
  if (!d.site.trim()) out.push("site");
  const m = Number(d.months);
  const monthsOk = d.months.trim() !== "" && Number.isInteger(m) && m >= 1 && m <= 12;
  const monthOk = /^\d{4}-(0[1-9]|1[0-2])$/.test(d.month);
  // Tam olarak biri: ay sayısı ya da belli ay.
  if (d.months.trim() !== "" ? !monthsOk || d.month !== "" : !monthOk) out.push("install");
  return out;
}

/**
 * Üç soru; her "evet" cevabında ayrıntısı zorunludur (2026-11-19): bütçe tutarı ve para birimi, proje yeri, kurulum
 * için kaç ay içinde ya da hangi ay.
 */
export function QualifiedDialog({
  questions,
  currencies,
  saving,
  extra,
  onCancel,
  onConfirm,
}: {
  questions: string[];
  currencies: string[];
  saving: boolean;
  /** Pencerenin altına eklenen bölüm (dosya ekleme). */
  extra?: ReactNode;
  onCancel: () => void;
  onConfirm: (body: ChangeStageBody) => void;
}) {
  const { t } = useLang();
  const [answers, setAnswers] = useState<Record<string, boolean>>({});
  const [tried, setTried] = useState(false);
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState(currencies[0] ?? "EUR");
  const [site, setSite] = useState("");
  const [months, setMonths] = useState("");
  const [month, setMonth] = useState("");
  const allYes = questions.every((q) => answers[q] === true);
  const anyNo = questions.some((q) => answers[q] === false);
  const problems = qualificationProblems({ amount, site, months, month });
  const bad = (f: "budget" | "site" | "install") => tried && problems.includes(f);
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const detail = (q: string) => {
    if (answers[q] !== true) return null;
    if (q === "budget_approved")
      return (
        <MoneyFields
          currencies={currencies}
          amountLabel={t("qual.budget")}
          amount={amount}
          currency={currency}
          error={bad("budget") ? t("qual.err.budget") : ""}
          errorId="qual-budget-err"
          onAmount={setAmount}
          onCurrency={setCurrency}
        />
      );
    if (q === "site_known")
      return (
        <Field label={t("qual.site")} error={bad("site") ? t("qual.err.site") : ""} errorId="qual-site-err">
          <input
            value={site}
            maxLength={200}
            aria-required="true"
            placeholder={t("qual.sitePh")}
            onChange={(e) => setSite(e.target.value)}
          />
        </Field>
      );
    if (q === "install_within_12m")
      return (
        <>
          <div className="won-row">
            <Field label={t("qual.installMonths")}>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={12}
                step={1}
                value={months}
                onChange={(e) => {
                  setMonths(e.target.value);
                  if (e.target.value) setMonth("");
                }}
              />
            </Field>
            <Field label={t("qual.installMonth")}>
              <input
                type="month"
                min={thisMonth}
                value={month}
                onChange={(e) => {
                  setMonth(e.target.value);
                  if (e.target.value) setMonths("");
                }}
              />
            </Field>
          </div>
          {bad("install") && (
            <p className="field-err" role="alert" id="qual-install-err">
              {t("qual.err.install")}
            </p>
          )}
        </>
      );
    return null;
  };

  return (
    <Modal title={t("dialog.qualified.title")} onClose={onCancel}>
      <p className="lede">{t("dialog.qualified.lede")}</p>
      <div className="qa-list">
        {questions.map((q) => (
          <div key={q} className="qa-block">
            <fieldset className="qa">
              <legend>{t(`q.${q}`)}</legend>
              <div className="seg" role="radiogroup">
                {[true, false].map((v) => (
                  <label key={String(v)} className={"seg-opt" + (answers[q] === v ? " on" : "")}>
                    <input
                      type="radio"
                      name={q}
                      checked={answers[q] === v}
                      onChange={() => setAnswers((a) => ({ ...a, [q]: v }))}
                    />
                    {v ? t("common.yes") : t("common.no")}
                  </label>
                ))}
              </div>
            </fieldset>
            {detail(q)}
          </div>
        ))}
      </div>
      {tried && !allYes && (
        <p className="field-err" role="alert">
          {t("dialog.qualified.notAll")}
        </p>
      )}
      {extra}
      <div className="modal-actions">
        <Button onClick={onCancel}>{t("common.cancel")}</Button>
        <Button
          variant="pri"
          loading={saving}
          disabled={anyNo}
          onClick={() => {
            setTried(true);
            if (!allYes || problems.length) return;
            onConfirm({
              target: "QUALIFIED",
              qualificationAnswers: answers,
              qualificationDetails: {
                budgetAmount: parseAmount(amount),
                budgetCurrency: currency,
                site: site.trim(),
                installMonths: months.trim() ? Number(months) : null,
                installMonth: months.trim() ? null : month,
              },
            });
          }}
        >
          {t("dialog.qualified.confirm")}
        </Button>
      </div>
    </Modal>
  );
}

export type MoneyValue = { amount: number; currency: string };

/** Tutar + para birimi girişi; Teklif ve Kazanıldı pencereleri paylaşır. */
function MoneyFields({
  currencies,
  amountLabel,
  amount,
  currency,
  error,
  errorId,
  onAmount,
  onCurrency,
}: {
  currencies: string[];
  /** Tutar alanının etiketi; verilmezse "Tutar". */
  amountLabel?: string;
  amount: string;
  currency: string;
  error: string;
  errorId: string;
  onAmount: (v: string) => void;
  onCurrency: (v: string) => void;
}) {
  const { t } = useLang();
  return (
    <div className="won-row">
      <Field label={amountLabel ?? t("dialog.won.amount")} error={error} errorId={errorId}>
        <input
          type="number"
          inputMode="decimal"
          min={0}
          step="0.01"
          value={amount}
          onChange={(e) => onAmount(e.target.value)}
        />
      </Field>
      <Field label={t("dialog.won.currency")}>
        <select value={currency} onChange={(e) => onCurrency(e.target.value)}>
          {currencies.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </Field>
    </div>
  );
}

function parseAmount(s: string): number {
  return Number(s.replace(",", "."));
}

/** Teklif tutarı isteğe bağlıdır: boş geçilebilir, girildiyse sıfırdan büyük olmalı. */
export function ProposalDialog({
  currencies,
  saving,
  extra,
  onCancel,
  onConfirm,
}: {
  currencies: string[];
  saving: boolean;
  /** Pencerenin altına eklenen bölüm (dosya ekleme). */
  extra?: ReactNode;
  onCancel: () => void;
  onConfirm: (body: ChangeStageBody) => void;
}) {
  const { t } = useLang();
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState(currencies[0] ?? "EUR");
  const [tried, setTried] = useState(false);
  const empty = amount.trim() === "";
  const n = parseAmount(amount);
  const valid = empty || n > 0;
  const err = tried && !valid ? t("dialog.proposal.amountErr") : "";
  return (
    <Modal title={t("dialog.proposal.title")} onClose={onCancel} width={420}>
      <p className="lede">{t("dialog.proposal.lede")}</p>
      <MoneyFields
        currencies={currencies}
        amount={amount}
        currency={currency}
        error={err}
        errorId="proposal-err"
        onAmount={setAmount}
        onCurrency={setCurrency}
      />
      {extra}
      <div className="modal-actions">
        <Button onClick={onCancel}>{t("common.cancel")}</Button>
        <Button
          variant="pri"
          loading={saving}
          onClick={() => {
            setTried(true);
            if (valid) onConfirm({ target: "PROPOSAL", value: empty ? null : { amount: n, currency } });
          }}
        >
          {t("dialog.proposal.confirm")}
        </Button>
      </div>
    </Modal>
  );
}

export function WonDialog({
  currencies,
  initial,
  saving,
  extra,
  onCancel,
  onConfirm,
}: {
  currencies: string[];
  /** Son teklif tutarı; varsa alan dolu gelir, satışçı yalnız onaylar ya da düzeltir. */
  initial?: MoneyValue | null;
  saving: boolean;
  /** Pencerenin altına eklenen bölüm (dosya ekleme). */
  extra?: ReactNode;
  onCancel: () => void;
  onConfirm: (body: ChangeStageBody) => void;
}) {
  const { t } = useLang();
  const [amount, setAmount] = useState(initial ? String(initial.amount) : "");
  const [currency, setCurrency] = useState(initial?.currency ?? currencies[0] ?? "EUR");
  const [tried, setTried] = useState(false);
  const n = parseAmount(amount);
  const err = tried && !(n > 0) ? t("dialog.won.amountErr") : "";
  return (
    <Modal title={t("dialog.won.title")} onClose={onCancel} width={420}>
      <p className="lede">{t("dialog.won.lede")}</p>
      <MoneyFields
        currencies={currencies}
        amount={amount}
        currency={currency}
        error={err}
        errorId="won-err"
        onAmount={setAmount}
        onCurrency={setCurrency}
      />
      {extra}
      <div className="modal-actions">
        <Button onClick={onCancel}>{t("common.cancel")}</Button>
        <Button
          variant="won"
          icon="trophy"
          loading={saving}
          onClick={() => {
            setTried(true);
            if (n > 0) onConfirm({ target: "WON", value: { amount: n, currency } });
          }}
        >
          {t("dialog.won.confirm")}
        </Button>
      </div>
    </Modal>
  );
}

export function LostDialog({
  reasons,
  saving,
  extra,
  onCancel,
  onConfirm,
}: {
  reasons: ReferenceDto["lostReasons"];
  saving: boolean;
  /** Pencerenin altına eklenen bölüm (dosya ekleme). */
  extra?: ReactNode;
  onCancel: () => void;
  onConfirm: (body: ChangeStageBody) => void;
}) {
  const { t, lang } = useLang();
  const [code, setCode] = useState("");
  const [tried, setTried] = useState(false);
  const err = tried && !code ? t("dialog.lost.reasonErr") : "";
  return (
    <Modal title={t("dialog.lost.title")} onClose={onCancel}>
      <p className="lede">{t("dialog.lost.lede")}</p>
      <fieldset className="reason-list" aria-describedby={err ? "lost-err" : undefined}>
        <legend className="field-l">{t("dialog.lost.reason")}</legend>
        {reasons.map((r) => (
          <label key={r.code} className={"reason" + (code === r.code ? " on" : "")}>
            <input type="radio" name="lost-reason" checked={code === r.code} onChange={() => setCode(r.code)} />
            {refName(lang, "reason", r)}
          </label>
        ))}
      </fieldset>
      {err && (
        <p className="field-err" id="lost-err" role="alert">
          {err}
        </p>
      )}
      {extra}
      <div className="modal-actions">
        <Button onClick={onCancel}>{t("common.cancel")}</Button>
        <Button
          variant="danger"
          loading={saving}
          onClick={() => {
            setTried(true);
            if (code) onConfirm({ target: "LOST", lostReasonCode: code });
          }}
        >
          {t("dialog.lost.confirm")}
        </Button>
      </div>
    </Modal>
  );
}
