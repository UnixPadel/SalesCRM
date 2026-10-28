import { useState } from "react";
import { Button, Empty, Icon, Skeleton } from "../components/ui";
import { useLang } from "../i18n";
import type { StageCodeDto } from "../modules/sales-pipeline/api/dto";
import { navigate } from "../router";
import { useCrm } from "../state/CrmContext";
import { Age, Country, SourceBadge, StageTag } from "./bits";
import { useErrorText, useLeads, useNow, useReference, useTeamNames } from "./hooks";

/** Lead gelen kutusu: yeni lead'ler en üstte; kaynak rozeti, ülke, sayaç; 1 sa turuncu, 24 sa kırmızı. */
export function InboxPage({ initialQuery = "" }: { initialQuery?: string }) {
  const { t, lang } = useLang();
  const { isAdmin } = useCrm();
  const { ref } = useReference();
  const [q, setQ] = useState(initialQuery);
  const [stage, setStage] = useState<StageCodeDto | "">("");
  const [includeTest, setIncludeTest] = useState(false);
  const { leads, error, reload } = useLeads({ stage: stage || undefined, q: q.trim() || undefined, includeTest });
  const { nameOf } = useTeamNames();
  const now = useNow(30_000);
  const errText = useErrorText();

  return (
    <section className="pl-page" aria-labelledby="inbox-h">
      <div className="toolbar">
        <h1 id="inbox-h" className="pl-title">
          {t("inbox.title")} {leads && <span className="muted">· {t("inbox.count", { n: leads.length })}</span>}
        </h1>
        <div className="filters">
          <label className="searchfield">
            <Icon name="search" />
            <input
              type="search"
              value={q}
              placeholder={t("common.search")}
              aria-label={t("common.search")}
              onChange={(e) => setQ(e.target.value)}
            />
          </label>
          <select
            aria-label={t("inbox.stageFilter")}
            value={stage}
            onChange={(e) => setStage(e.target.value as StageCodeDto | "")}
          >
            <option value="">{t("common.all")}</option>
            {ref?.stages.map((s) => (
              <option key={s.code} value={s.code}>
                {lang === "tr" ? s.nameTr : s.nameEn}
              </option>
            ))}
          </select>
          {isAdmin && (
            <label className="check">
              <input type="checkbox" checked={includeTest} onChange={(e) => setIncludeTest(e.target.checked)} />{" "}
              {t("inbox.includeTest")}
            </label>
          )}
        </div>
      </div>

      {error ? (
        <Empty title={errText(error)}>
          <Button onClick={reload} icon="refresh">
            {t("common.retry")}
          </Button>
        </Empty>
      ) : !leads ? (
        <div className="pl-list" aria-busy="true">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} h={56} />
          ))}
        </div>
      ) : leads.length === 0 ? (
        <Empty title={t("inbox.empty")}>{t("inbox.emptyHint")}</Empty>
      ) : (
        <ul className="pl-list" aria-label={t("inbox.title")}>
          <li className="pl-row pl-head" aria-hidden="true">
            <span>{t("inbox.col.lead")}</span>
            <span>{t("inbox.col.source")}</span>
            <span>{t("inbox.col.country")}</span>
            <span>{t("inbox.col.stage")}</span>
            <span>{t("inbox.col.owner")}</span>
            <span>{t("inbox.col.age")}</span>
          </li>
          {leads.map((l) => (
            <li key={l.id}>
              <a
                className="pl-row"
                href={`#/lead/${l.id}`}
                onClick={(e) => (e.preventDefault(), navigate("lead", undefined, l.id))}
              >
                <span className="pl-main">
                  <b>{l.fullName}</b>
                  <small>{[l.company, l.productInterest].filter(Boolean).join(" · ") || l.email || l.phoneE164}</small>
                </span>
                <span>
                  <SourceBadge source={l.source} />
                  {l.isTest && <span className="tag tag-neutral">TEST</span>}
                </span>
                <span>
                  <Country code={l.country} />
                </span>
                <span>
                  <StageTag code={l.currentStage} />
                </span>
                <span className="pl-owner">{nameOf(l.assignedUserId)}</span>
                <span>
                  <Age lead={l} now={now} />
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
