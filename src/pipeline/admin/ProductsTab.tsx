import { useCallback, useRef, useState } from "react";
import { Button, Empty, Modal, Skeleton, StatusTag } from "../../components/ui";
import { useLang } from "../../i18n";
import type { CatalogImportResultDto, CatalogProductDto } from "../../modules/sales-pipeline/api/dto";
import { useCrm } from "../../state/CrmContext";
import { refreshReference, useErrorText } from "../hooks";
import { adminApi } from "./adminApi";
import { LoadError, SectionHead, useLoad, Write } from "./bits";
import { parseCatalogCsv } from "./catalogCsv";

/**
 * Ürün listesi sekmesi: lead'e girilebilen ürünler. Liste dışarıdaki ürün dosyasından (CSV: KategoriID, KategoriAdi)
 * yüklenir. "Dosyadan güncelle" önce değişiklikleri gösterir (eklenecek, adı değişecek, kullanımdan kalkacak);
 * işareti kaldırılan yeni ürün listeye alınmaz. Dosyada artık olmayan ürün silinmez, kullanımdan kalkar.
 */
interface Pending {
  rows: { id: number; name: string }[];
  plan: CatalogImportResultDto;
  skip: Set<number>;
}

export function ProductsTab() {
  const { t } = useLang();
  const { toast } = useCrm();
  const errText = useErrorText();
  const load = useCallback(() => adminApi.products(), []);
  const { data, error, reload } = useLoad<CatalogProductDto[]>(load);
  const file = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);

  const pick = async (f: File | undefined) => {
    if (!f) return;
    setReading(true);
    try {
      const parsed = parseCatalogCsv(await f.text());
      if (!parsed.ok) {
        toast(t(parsed.reason === "columns" ? "catalog.badColumns" : "catalog.emptyFile"), { bad: true });
        return;
      }
      const rows = parsed.rows.map((r) => ({ id: Number(r.id), name: r.name }));
      const plan = await adminApi.importProducts({ rows, dryRun: true });
      setPending({ rows, plan, skip: new Set() });
    } catch (e) {
      toast(errText(e), { bad: true });
    } finally {
      setReading(false);
      if (file.current) file.current.value = "";
    }
  };

  const apply = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      const done = await adminApi.importProducts({ rows: pending.rows, skip: [...pending.skip], dryRun: false });
      setPending(null);
      refreshReference();
      await reload();
      toast(
        t("catalog.applied", {
          added: done.added.length,
          renamed: done.renamed.length,
          deactivated: done.deactivated.length,
        }),
      );
    } catch (e) {
      toast(errText(e), { bad: true });
    } finally {
      setBusy(false);
    }
  };

  if (!data) {
    return error ? <LoadError message={errText(error)} onRetry={() => void reload()} /> : <Skeleton h={240} />;
  }
  const active = data.filter((p) => p.active).length;

  return (
    <div className="adm-stack">
      <SectionHead title={t("catalog.title")} help={t("catalog.help")}>
        <Write>
          <input
            ref={file}
            type="file"
            accept=".csv,text/csv"
            hidden
            onChange={(e) => void pick(e.target.files?.[0])}
          />
          <Button icon="upload" loading={reading} onClick={() => file.current?.click()}>
            {t("catalog.upload")}
          </Button>
        </Write>
      </SectionHead>
      <p className="muted">{t("catalog.count", { n: active, off: data.length - active })}</p>
      {data.length === 0 ? (
        <Empty title={t("catalog.empty")}>{t("catalog.emptyHint")}</Empty>
      ) : (
        <div className="adm-table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th scope="col" className="num">
                  {t("catalog.col.id")}
                </th>
                <th scope="col">{t("catalog.col.name")}</th>
                <th scope="col">{t("catalog.col.status")}</th>
              </tr>
            </thead>
            <tbody>
              {data.map((p) => (
                <tr key={p.id}>
                  <td className="num">{p.id}</td>
                  <th scope="row" className="adm-rowhead">
                    {p.name}
                  </th>
                  <td>
                    {p.active ? (
                      <StatusTag tone="ok" icon="check">
                        {t("catalog.active")}
                      </StatusTag>
                    ) : (
                      <StatusTag tone="neutral" icon="lock">
                        {t("catalog.inactive")}
                      </StatusTag>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pending && (
        <CatalogPreview
          pending={pending}
          busy={busy}
          onToggle={(id) =>
            setPending((p) => {
              if (!p) return p;
              const skip = new Set(p.skip);
              if (skip.has(id)) skip.delete(id);
              else skip.add(id);
              return { ...p, skip };
            })
          }
          onApply={() => void apply()}
          onClose={() => setPending(null)}
        />
      )}
    </div>
  );
}

function CatalogPreview({
  pending,
  busy,
  onToggle,
  onApply,
  onClose,
}: {
  pending: Pending;
  busy: boolean;
  onToggle: (id: number) => void;
  onApply: () => void;
  onClose: () => void;
}) {
  const { t } = useLang();
  const { plan, skip } = pending;
  const changes =
    plan.added.length - skip.size + plan.renamed.length + plan.deactivated.length + plan.reactivated.length;
  return (
    <Modal
      title={t("catalog.preview.title")}
      onClose={onClose}
      width={620}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t("admin.cancel")}
          </Button>
          <Button variant="pri" onClick={onApply} loading={busy} disabled={changes === 0}>
            {t("catalog.apply")}
          </Button>
        </>
      }
    >
      <div className="cat-preview">
        {changes === 0 && <p>{t("catalog.noChange")}</p>}
        {plan.added.length > 0 && (
          <section>
            <h3>{t("catalog.added", { n: plan.added.length - skip.size })}</h3>
            <p className="field-h">{t("catalog.skipHint")}</p>
            <ul>
              {plan.added.map((r) => (
                <li key={r.id}>
                  <label className="cd-check">
                    <input type="checkbox" checked={!skip.has(r.id)} onChange={() => onToggle(r.id)} />
                    <span>
                      <span className="num">{r.id}</span> · {r.name}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </section>
        )}
        {plan.renamed.length > 0 && (
          <section>
            <h3>{t("catalog.renamed", { n: plan.renamed.length })}</h3>
            <ul>
              {plan.renamed.map((r) => (
                <li key={r.id}>
                  <span className="num">{r.id}</span> · {r.from} → <b>{r.to}</b>
                </li>
              ))}
            </ul>
          </section>
        )}
        {plan.deactivated.length > 0 && (
          <section>
            <h3>{t("catalog.deactivated", { n: plan.deactivated.length })}</h3>
            <p className="field-h">{t("catalog.deactivatedHint")}</p>
            <ul>
              {plan.deactivated.map((r) => (
                <li key={r.id}>
                  <span className="num">{r.id}</span> · {r.name}
                </li>
              ))}
            </ul>
          </section>
        )}
        {plan.reactivated.length > 0 && (
          <section>
            <h3>{t("catalog.reactivated", { n: plan.reactivated.length })}</h3>
            <ul>
              {plan.reactivated.map((r) => (
                <li key={r.id}>
                  <span className="num">{r.id}</span> · {r.name}
                </li>
              ))}
            </ul>
          </section>
        )}
        <p className="muted">{t("catalog.unchanged", { n: plan.unchanged })}</p>
      </div>
    </Modal>
  );
}
