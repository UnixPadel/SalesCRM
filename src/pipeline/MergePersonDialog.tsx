import { useEffect, useRef, useState } from "react";
import { Button, Field, Modal, Skeleton } from "../components/ui";
import { useLang } from "../i18n";
import type { PersonSummaryDto } from "../modules/sales-pipeline/api/dto";
import { useCrm } from "../state/CrmContext";
import { adminApi } from "./admin/adminApi";
import { pipelineApi } from "./api";
import { useErrorText } from "./hooks";

/**
 * Kişi birleştirme (Faz 7d, yalnız yönetici). Açılan satırdaki kişi **kalır**; aranıp seçilen kişi ona birleşir:
 * lead'leri taşınır, kendisi silinmez ama listelerde gizlenir. İki adım: ara ve seç → ne olacağını oku ve onayla.
 */
export function MergePersonDialog({
  target,
  onClose,
  onMerged,
}: {
  target: PersonSummaryDto;
  onClose: () => void;
  onMerged: () => void;
}) {
  const { t } = useLang();
  const { toast } = useCrm();
  const errText = useErrorText();
  const [q, setQ] = useState("");
  // Sonuç, ait olduğu sorguyla saklanır: sorgu değişince "aranıyor" durumu bundan türetilir.
  const [found, setFound] = useState<{ q: string; rows: PersonSummaryDto[] } | null>(null);
  const [picked, setPicked] = useState<PersonSummaryDto | null>(null);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const seq = useRef(0);
  // Seçim yapılınca ya da geri dönülünce odak pencerenin içinde kalır (tıklanan düğme DOM'dan kalkar).
  const pickedRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const moved = useRef(false);
  useEffect(() => {
    if (!moved.current) return;
    if (picked) pickedRef.current?.focus();
    else searchRef.current?.focus();
  }, [picked]);
  const choose = (p: PersonSummaryDto | null) => {
    moved.current = true;
    setPicked(p);
  };

  const text = q.trim();
  const active = text.length >= 2;
  useEffect(() => {
    if (!active) return;
    const n = ++seq.current;
    const id = setTimeout(() => {
      pipelineApi
        .persons({ q: text })
        .then((rows) => {
          if (n !== seq.current) return;
          // Kendisi ve zaten birleştirilmiş kayıtlar seçilemez.
          setFound({
            q: text,
            rows: rows.filter((r) => r.person.id !== target.person.id && !r.person.mergedIntoId).slice(0, 20),
          });
        })
        .catch(() => n === seq.current && setFound({ q: text, rows: [] }));
    }, 250);
    return () => clearTimeout(id);
  }, [active, text, target.person.id]);
  const searching = active && found?.q !== text;
  const results = active && found?.q === text ? found.rows : null;

  const who = (p: PersonSummaryDto) => p.person.fullName || p.person.emailNormalized || p.person.phoneE164 || "—";
  const contact = (p: PersonSummaryDto) =>
    [p.person.emailNormalized, p.person.phoneE164, p.organization?.name].filter(Boolean).join(" · ");

  const merge = async () => {
    if (!picked) return;
    setSaving(true);
    setProblem(null);
    try {
      const r = await adminApi.mergePerson(target.person.id, picked.person.id);
      toast(t("merge.done", { n: r.movedLeads }));
      onMerged();
    } catch (e) {
      setProblem(errText(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={t("merge.title")}
      onClose={onClose}
      width={520}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            {t("admin.cancel")}
          </Button>
          <Button variant="pri" disabled={!picked} loading={saving} onClick={() => void merge()}>
            {t("merge.confirm")}
          </Button>
        </>
      }
    >
      <div className="adm-stack">
        <div className="merge-picked">
          <span className="field-l">{t("merge.keep")}</span>
          <div className="merge-who">
            <b>{who(target)}</b>
            <span className="muted">{contact(target) || t("merge.leadsN", { n: target.leads.length })}</span>
          </div>
        </div>

        {picked ? (
          <div className="merge-picked" ref={pickedRef} tabIndex={-1}>
            <span className="field-l">{t("merge.picked")}</span>
            <div className="merge-who">
              <b>{who(picked)}</b>
              <span className="muted">{contact(picked)}</span>
            </div>
            <p className="adm-confirm">
              {t("merge.summary", { source: who(picked), target: who(target), n: picked.leads.length })}
            </p>
            <div>
              <Button size="sm" variant="ghost" onClick={() => choose(null)} disabled={saving}>
                {t("common.back")}
              </Button>
            </div>
          </div>
        ) : (
          <>
            <Field label={t("merge.search")} hint={t("merge.searchHint")}>
              <input
                ref={searchRef}
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                autoComplete="off"
              />
            </Field>
            <div aria-live="polite">
              {searching ? (
                <Skeleton h={44} />
              ) : results === null ? null : results.length === 0 ? (
                <p className="muted">{t("merge.noResults")}</p>
              ) : (
                <ul className="merge-results">
                  {results.map((r) => (
                    <li key={r.person.id}>
                      <div className="merge-who">
                        <b>{who(r)}</b>
                        <span className="muted">
                          {[contact(r), t("merge.leadsN", { n: r.leads.length })].filter(Boolean).join(" · ")}
                        </span>
                      </div>
                      <Button size="sm" onClick={() => choose(r)}>
                        {t("merge.pick")}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
        {problem && (
          <span className="field-err" role="alert">
            {problem}
          </span>
        )}
      </div>
    </Modal>
  );
}
