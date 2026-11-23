import { useCallback, useState } from "react";
import { Button, Empty, Skeleton, StatusTag, fmtDate } from "../../components/ui";
import { useLang } from "../../i18n";
import { useCrm } from "../../state/CrmContext";
import { useErrorText } from "../hooks";
import { adminApi, type CheckpointDto, type CheckpointPreviewDto } from "./adminApi";
import { ConfirmDialog, LoadError, SectionHead, useLoad } from "./bits";

/**
 * Yönetim > Teknik > Geri yükleme noktaları (2026-11-23). Toplu veri işlemi (Excel eşitleme) başlamadan önce dokunacağı
 * lead'lerin hali saklanır; yönetici buradan o işlemin yaptığı değişiklikleri geri alır. Yalnız `admin` rolü görür;
 * sunucu da başka rolün isteğini 403 ile reddeder. Her nokta bir kez kullanılır.
 */
export function CheckpointsTab() {
  const { t } = useLang();
  const errText = useErrorText();
  const { toast } = useCrm();
  const load = useCallback(() => adminApi.checkpoints(), []);
  const { data, error, reload } = useLoad(load);
  const [asking, setAsking] = useState<{ cp: CheckpointDto; preview: CheckpointPreviewDto } | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const ask = async (cp: CheckpointDto) => {
    setOpening(cp.id);
    try {
      setAsking({ cp, preview: await adminApi.checkpointPreview(cp.id) });
    } catch (e) {
      toast(errText(e), { bad: true });
    } finally {
      setOpening(null);
    }
  };
  const restore = async () => {
    if (!asking) return;
    setBusy(true);
    try {
      await adminApi.restoreCheckpoint(asking.cp.id);
      toast(t("checkpoint.restored"));
      setAsking(null);
      void reload();
    } catch (e) {
      toast(errText(e), { bad: true });
    } finally {
      setBusy(false);
    }
  };

  if (error && !data) return <LoadError message={errText(error)} onRetry={() => void reload()} />;
  if (!data)
    return (
      <div className="adm-stack" aria-busy="true">
        <Skeleton h={48} />
        <Skeleton h={160} />
      </div>
    );
  return (
    <div className="adm-stack">
      <SectionHead title={t("checkpoint.title")} help={t("checkpoint.help")} />
      {data.items.length === 0 ? (
        <Empty title={t("checkpoint.empty")}>{t("checkpoint.emptyHint")}</Empty>
      ) : (
        <div className="adm-table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th scope="col">{t("checkpoint.col.when")}</th>
                <th scope="col">{t("checkpoint.col.what")}</th>
                <th scope="col">{t("checkpoint.col.effect")}</th>
                <th scope="col">{t("checkpoint.col.status")}</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((cp) => (
                <tr key={cp.id}>
                  <td>{fmtDate(cp.createdAt, true)}</td>
                  <th scope="row" className="adm-rowhead">
                    {cp.label}
                  </th>
                  <td>
                    {t("checkpoint.effect", {
                      created: cp.summary.leads.created,
                      changed: cp.summary.leads.changed,
                    })}
                  </td>
                  <td>
                    {cp.restoredAt ? (
                      <StatusTag tone="neutral" icon="check">
                        {t("checkpoint.usedAt", { at: fmtDate(cp.restoredAt, true) })}
                      </StatusTag>
                    ) : (
                      <Button size="sm" variant="danger" loading={opening === cp.id} onClick={() => void ask(cp)}>
                        {t("checkpoint.restore")}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {asking && (
        <ConfirmDialog
          title={t("checkpoint.confirmTitle")}
          confirmLabel={t("checkpoint.restore")}
          danger
          busy={busy}
          onConfirm={() => void restore()}
          onClose={() => !busy && setAsking(null)}
        >
          {t("checkpoint.confirmBody", {
            label: asking.cp.label,
            remove: asking.preview.leads.toDelete,
            revert: asking.preview.leads.toRevert,
          })}
          {asking.preview.changedSince > 0 && (
            <>
              {" "}
              <strong>{t("checkpoint.changedSince", { n: asking.preview.changedSince })}</strong>
            </>
          )}
        </ConfirmDialog>
      )}
    </div>
  );
}
