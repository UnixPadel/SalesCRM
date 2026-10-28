import { useState } from "react";
import { Button, Field, Modal } from "../components/ui";
import { useLang } from "../i18n";
import type { ChangeStageBody, ReferenceDto } from "../modules/sales-pipeline/api/dto";

/** Aşamaya özel pencereler (Genel plan, satışçı arayüzü 3): ek bilgi yalnız gereken aşamada istenir. */

export function QualifiedDialog({
  questions,
  saving,
  onCancel,
  onConfirm,
}: {
  questions: string[];
  saving: boolean;
  onCancel: () => void;
  onConfirm: (body: ChangeStageBody) => void;
}) {
  const { t } = useLang();
  const [answers, setAnswers] = useState<Record<string, boolean>>({});
  const [tried, setTried] = useState(false);
  const allYes = questions.every((q) => answers[q] === true);
  const anyNo = questions.some((q) => answers[q] === false);
  return (
    <Modal title={t("dialog.qualified.title")} onClose={onCancel}>
      <p className="lede">{t("dialog.qualified.lede")}</p>
      <div className="qa-list">
        {questions.map((q) => (
          <fieldset key={q} className="qa">
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
        ))}
      </div>
      {tried && !allYes && (
        <p className="field-err" role="alert">
          {t("dialog.qualified.notAll")}
        </p>
      )}
      <div className="modal-actions">
        <Button onClick={onCancel}>{t("common.cancel")}</Button>
        <Button
          variant="pri"
          loading={saving}
          disabled={anyNo}
          onClick={() => {
            setTried(true);
            if (allYes) onConfirm({ target: "QUALIFIED", qualificationAnswers: answers });
          }}
        >
          {t("dialog.qualified.confirm")}
        </Button>
      </div>
    </Modal>
  );
}

export function WonDialog({
  currencies,
  saving,
  onCancel,
  onConfirm,
}: {
  currencies: string[];
  saving: boolean;
  onCancel: () => void;
  onConfirm: (body: ChangeStageBody) => void;
}) {
  const { t } = useLang();
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState(currencies[0] ?? "EUR");
  const [tried, setTried] = useState(false);
  const n = Number(amount.replace(",", "."));
  const err = tried && !(n > 0) ? t("dialog.won.amountErr") : "";
  return (
    <Modal title={t("dialog.won.title")} onClose={onCancel} width={420}>
      <p className="lede">{t("dialog.won.lede")}</p>
      <div className="won-row">
        <Field label={t("dialog.won.amount")} error={err} errorId="won-err">
          <input
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>
        <Field label={t("dialog.won.currency")}>
          <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {currencies.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
      </div>
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
  onCancel,
  onConfirm,
}: {
  reasons: ReferenceDto["lostReasons"];
  saving: boolean;
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
            {lang === "tr" ? r.nameTr : r.nameEn}
          </label>
        ))}
      </fieldset>
      {err && (
        <p className="field-err" id="lost-err" role="alert">
          {err}
        </p>
      )}
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
