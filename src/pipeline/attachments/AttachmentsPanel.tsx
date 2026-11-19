import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Icon, Modal, fmtDate } from "../../components/ui";
import { localeOf, useLang } from "../../i18n";
import type { AttachmentDto } from "../../modules/sales-pipeline/api/dto.attachment";
import { useCrm } from "../../state/CrmContext";
import { useErrorText, useReference } from "../hooks";
import { attachmentApi, fileSize, uploadAll } from "./attachmentApi";
import { FilePicker } from "./FilePicker";

/** Lead'in ekleri; `reload` temas ya da aşama penceresi kapandıktan sonra çağrılır. */
export function useAttachments(leadId: string) {
  const [items, setItems] = useState<AttachmentDto[] | null>(null);
  const seq = useRef(0);
  const reload = useCallback(() => {
    const n = ++seq.current;
    attachmentApi
      .list(leadId)
      .then((r) => n === seq.current && setItems(r))
      .catch(() => n === seq.current && setItems((prev) => prev ?? []));
  }, [leadId]);
  useEffect(reload, [reload]);
  return { items, reload };
}

/** Tek ek satırı: küçük önizleme ya da dosya ikonu, ad (indirir), boyut, yükleme tarihi ve yükleyen. */
function AttachmentRow({
  a,
  who,
  stageName,
  onDelete,
}: {
  a: AttachmentDto;
  who: (id: string | null) => string;
  stageName?: ((code: string) => string) | undefined;
  onDelete?: (() => void) | undefined;
}) {
  const { t, lang } = useLang();
  if (a.deletedAt) {
    return (
      <li className="att att-deleted">
        <Icon name="trash" size={16} />
        <div className="att-main">
          <span className="att-name">{a.fileName}</span>
          <small className="muted">
            {t("attach.uploadedAt", { when: fmtDate(a.uploadedAt, true), who: who(a.uploadedBy) })}
          </small>
          <small className="att-reason">
            {t("attach.deletedAt", { when: fmtDate(a.deletedAt, true), who: who(a.deletedBy) })} ·{" "}
            {t("attach.reasonIs", { reason: a.deleteReason ?? "" })}
          </small>
        </div>
      </li>
    );
  }
  const url = attachmentApi.url(a.id);
  return (
    <li className="att">
      {a.isImage ? (
        <a href={url} download={a.fileName} className="att-thumb" aria-hidden="true" tabIndex={-1}>
          <img src={url} alt="" loading="lazy" />
        </a>
      ) : (
        <Icon name="file" size={16} />
      )}
      <div className="att-main">
        <a href={url} download={a.fileName} className="att-name">
          {a.fileName}
        </a>
        <small className="muted">
          {fileSize(a.sizeBytes, localeOf(lang))} ·{" "}
          {t("attach.uploadedAt", { when: fmtDate(a.uploadedAt, true), who: who(a.uploadedBy) })}
          {stageName ? ` · ${stageName(a.stageCode)}` : ""}
        </small>
      </div>
      {onDelete && (
        <button
          type="button"
          className="link-btn danger"
          onClick={onDelete}
          aria-label={t("attach.deleteNamed", { name: a.fileName })}
        >
          {t("attach.delete")}
        </button>
      )}
    </li>
  );
}

/** Zaman çizelgesinde görüşme notunun altındaki ekler (yalnız o görüşmeye eklenenler). */
export function AttachmentChips({ items, who }: { items: AttachmentDto[]; who: (id: string | null) => string }) {
  if (!items.length) return null;
  return (
    <ul className="att-list att-inline">
      {items.map((a) => (
        <AttachmentRow key={a.id} a={a} who={who} />
      ))}
    </ul>
  );
}

/**
 * Lead sayfasındaki "Dosya ekleri" paneli: bütün ekler yükleme tarihiyle, silinenler nedeniyle listelenir. Yükleme ve
 * silme yetkisi: lead üzerinde işlem yapabilen ekler; yükleyen ya da yönetici siler (sunucu da denetler).
 */
export function AttachmentsPanel({
  leadId,
  items,
  canAdd,
  who,
  onChanged,
}: {
  leadId: string;
  items: AttachmentDto[] | null;
  canAdd: boolean;
  who: (id: string | null) => string;
  onChanged: () => void;
}) {
  const { t } = useLang();
  const { toast, user, isAdmin } = useCrm();
  const { ref, stageName } = useReference();
  const errText = useErrorText();
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<AttachmentDto | null>(null);
  const live = (items ?? []).filter((a) => !a.deletedAt);

  const upload = async () => {
    setBusy(true);
    const failed = await uploadAll(leadId, files);
    setBusy(false);
    setFiles([]);
    if (failed.length) toast(t("attach.failed", { names: failed.join(", ") }), { bad: true });
    else toast(t("attach.uploaded"));
    onChanged();
  };

  return (
    <div className="panel" aria-labelledby="att-h">
      <h2 className="sec-h" id="att-h">
        {t("attach.title")} <span className="count">{live.length}</span>
      </h2>
      {items && items.length === 0 && <p className="muted">{t("attach.none")}</p>}
      {items && items.length > 0 && (
        <ul className="att-list">
          {items.map((a) => (
            <AttachmentRow
              key={a.id}
              a={a}
              who={who}
              stageName={stageName}
              onDelete={canAdd && (isAdmin || a.uploadedBy === user?.id) ? () => setDeleting(a) : undefined}
            />
          ))}
        </ul>
      )}
      {canAdd && ref && (
        <div className="att-add">
          <FilePicker files={files} onChange={setFiles} rules={ref.attachments} disabled={busy} />
          {files.length > 0 && (
            <Button variant="pri" size="sm" icon="upload" loading={busy} onClick={upload}>
              {t("attach.upload")}
            </Button>
          )}
        </div>
      )}
      {deleting && ref && (
        <DeleteAttachmentDialog
          a={deleting}
          reasonMin={ref.attachments.reasonMin}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            setDeleting(null);
            toast(t("attach.deleted"));
            onChanged();
          }}
          errText={errText}
        />
      )}
    </div>
  );
}

/** Silme penceresi: neden yazılmadan silinemez. */
function DeleteAttachmentDialog({
  a,
  reasonMin,
  onClose,
  onDeleted,
  errText,
}: {
  a: AttachmentDto;
  reasonMin: number;
  onClose: () => void;
  onDeleted: () => void;
  errText: (e: unknown) => string;
}) {
  const { t } = useLang();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ok = reason.trim().length >= reasonMin;
  const submit = async () => {
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      await attachmentApi.remove(a.id, reason.trim());
      onDeleted();
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  };
  return (
    <Modal
      title={t("attach.deleteTitle")}
      onClose={onClose}
      width={440}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="pri" loading={busy} disabled={!ok} onClick={submit}>
            {t("attach.delete")}
          </Button>
        </>
      }
    >
      <p className="lede">{t("attach.deleteLede", { name: a.fileName })}</p>
      <label className="field">
        <span className="field-l">{t("attach.reason")}</span>
        <textarea
          rows={3}
          maxLength={500}
          value={reason}
          aria-required="true"
          placeholder={t("attach.reasonPh")}
          onChange={(e) => setReason(e.target.value)}
        />
        <span className="field-h">{t("attach.reasonHelp")}</span>
      </label>
      {error && (
        <p className="field-err" role="alert">
          <Icon name="warn" size={14} /> {error}
        </p>
      )}
    </Modal>
  );
}
