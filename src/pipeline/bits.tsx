import { Icon } from "../components/ui";
import { countryName, flagOf } from "../domain/constants";
import { useLang } from "../i18n";
import type { LeadDto, StageCodeDto } from "../modules/sales-pipeline/api/dto";
import { ageTone, useReference, useSince } from "./hooks";

/** Küçük, paylaşılan parçalar: kaynak rozeti, ülke, aşama etiketi, "geleli" sayacı. */

const SOURCE_ICON: Record<LeadDto["source"], string> = {
  meta_form: "tag",
  google_form: "globe",
  web_form: "mail",
  manual: "edit",
  import: "file",
};

export function SourceBadge({ source }: { source: LeadDto["source"] }) {
  const { t } = useLang();
  return (
    <span className={"src-badge src-" + source}>
      <Icon name={SOURCE_ICON[source]} size={13} />
      {t(`source.${source}`)}
    </span>
  );
}

export function Country({ code }: { code: string | null }) {
  const { t } = useLang();
  if (!code) return <span className="muted">{t("common.unknown")}</span>;
  return (
    <span className="country" title={countryName(code)}>
      <span className="flag" aria-hidden="true">
        {flagOf(code)}
      </span>
      {code}
    </span>
  );
}

export const STAGE_TONE: Record<StageCodeDto, string> = {
  NEW: "slate",
  CONTACTED: "slate",
  QUALIFIED: "green",
  PROPOSAL: "blue",
  WON: "amber",
  LOST: "red",
};

export function StageTag({ code }: { code: StageCodeDto }) {
  const { stageName } = useReference();
  return <span className={"stage-tag tone-" + STAGE_TONE[code]}>{stageName(code)}</span>;
}

export function Age({ lead, now }: { lead: LeadDto; now: number }) {
  const since = useSince();
  const { t } = useLang();
  const tone = ageTone(lead, now);
  const title = tone === "bad" ? t("inbox.untouched24h") : tone === "warn" ? t("inbox.untouched1h") : undefined;
  return (
    <span className={"age" + (tone ? " age-" + tone : "")} title={title}>
      {tone && <Icon name={tone === "bad" ? "flame" : "clock"} size={13} />}
      {since(lead.createdAt, now)}
    </span>
  );
}
