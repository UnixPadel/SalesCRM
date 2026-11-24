import { useCallback, useState } from "react";
import { Button, Empty, Skeleton, fmtDate } from "../../components/ui";
import { useLang } from "../../i18n";
import type { LeadDto } from "../../modules/sales-pipeline/api/dto";
import { useCrm } from "../../state/CrmContext";
import { pipelineApi } from "../api";
import { useErrorText, useTeamNames } from "../hooks";
import { ConfirmDialog, LoadError, SectionHead, useLoad } from "./bits";

/**
 * Yönetim > Silinenler (2026-11-24): yöneticinin sildiği lead'ler ("çöp kutusu"), son silinen üstte. Yalnız `admin`
 * rolü görür; sunucu da başka rolün isteğini 403 ile reddeder. "Geri al" lead'i bütün geçmişiyle listeye döndürür.
 */
export function DeletedLeadsTab() {
  const { t } = useLang();
  const errText = useErrorText();
  const { toast } = useCrm();
  const { nameOf } = useTeamNames();
  const load = useCallback(() => pipelineApi.deletedLeads(), []);
  const { data, error, reload } = useLoad(load);
  const [asking, setAsking] = useState<LeadDto | null>(null);
  const [busy, setBusy] = useState(false);

  const restore = async () => {
    if (!asking) return;
    setBusy(true);
    try {
      await pipelineApi.restoreLead(asking.id);
      toast(t("deleted.restored", { name: asking.fullName }));
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
      <SectionHead title={t("deleted.title")} help={t("deleted.help")} />
      {data.length === 0 ? (
        <Empty title={t("deleted.empty")}>{t("deleted.emptyHint")}</Empty>
      ) : (
        <div className="adm-table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th scope="col">{t("deleted.col.lead")}</th>
                <th scope="col">{t("deleted.col.when")}</th>
                <th scope="col">{t("deleted.col.by")}</th>
                <th scope="col">{t("deleted.col.reason")}</th>
                <th scope="col">
                  <span className="sr-only">{t("deleted.restore")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.map((l) => (
                <tr key={l.id}>
                  <th scope="row" className="adm-rowhead">
                    <bdi>{l.fullName || t("logs.unnamedLead")}</bdi>
                    {l.company && <div className="muted">{l.company}</div>}
                  </th>
                  <td>{l.deletion ? fmtDate(l.deletion.at, true) : ""}</td>
                  <td>{l.deletion?.by ? nameOf(l.deletion.by) : ""}</td>
                  <td>{l.deletion?.reason ?? ""}</td>
                  <td>
                    <Button size="sm" icon="reset" onClick={() => setAsking(l)}>
                      {t("deleted.restore")}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {asking && (
        <ConfirmDialog
          title={t("deleted.confirmTitle")}
          confirmLabel={t("deleted.restore")}
          busy={busy}
          onConfirm={() => void restore()}
          onClose={() => !busy && setAsking(null)}
        >
          {t("deleted.confirmBody", { name: asking.fullName })}
        </ConfirmDialog>
      )}
    </div>
  );
}
