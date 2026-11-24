import { useState } from "react";
import { Button, Icon, Modal } from "../components/ui";
import { useLang } from "../i18n";
import type { LeadDto } from "../modules/sales-pipeline/api/dto";
import { pipelineApi } from "./api";

/** Sunucudaki alt sınırla aynı (application/deleteLead.ts `LEAD_DELETE_REASON_MIN`). */
const REASON_MIN = 3;

/**
 * Lead silme penceresi (2026-11-24): yalnız yönetici açar. Neden yazılmadan silinemez; lead çöp kutusuna gider,
 * Yönetim > Silinenler'den geri alınır.
 */
export function DeleteLeadDialog({
  lead,
  onClose,
  onDeleted,
  errText,
}: {
  lead: LeadDto;
  onClose: () => void;
  onDeleted: () => void;
  errText: (e: unknown) => string;
}) {
  const { t } = useLang();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ok = reason.trim().length >= REASON_MIN;
  const submit = async () => {
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      await pipelineApi.deleteLead(lead.id, reason.trim());
      onDeleted();
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  };
  return (
    <Modal
      title={t("lead.delete.title")}
      onClose={() => !busy && onClose()}
      width={460}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button variant="danger" icon="trash" loading={busy} disabled={!ok} onClick={submit}>
            {t("lead.delete.confirm")}
          </Button>
        </>
      }
    >
      <p className="lede">{t("lead.delete.lede", { name: lead.fullName })}</p>
      <label className="field">
        <span className="field-l">{t("lead.delete.reason")}</span>
        <textarea
          rows={3}
          maxLength={500}
          value={reason}
          aria-required="true"
          placeholder={t("lead.delete.reasonPh")}
          onChange={(e) => setReason(e.target.value)}
        />
        <span className="field-h">{t("lead.delete.reasonHelp")}</span>
      </label>
      {error && (
        <p className="field-err" role="alert">
          <Icon name="warn" size={14} /> {error}
        </p>
      )}
    </Modal>
  );
}
