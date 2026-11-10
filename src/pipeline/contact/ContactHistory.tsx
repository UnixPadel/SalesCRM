import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Empty, Icon, Skeleton } from "../../components/ui";
import { useLang } from "../../i18n";
import type { ContactHistoryItemDto } from "../../modules/sales-pipeline/api/dto.contact";
import { navigate } from "../../router";
import { useCrm } from "../../state/CrmContext";
import { ACTIVITY_ICON } from "../activityBits";
import { useErrorText, useReference, useTeamNames } from "../hooks";
import { contactApi } from "./contactApi";

type Range = "today" | "week" | "30" | "all";

/**
 * Temas geçmişi (Faz 7g; Excel TEMAS GEÇMİŞİ sayfasının karşılığı, iş emri §5.6): görünür lead'lerin bütün temasları,
 * en yeni önce; süzgeçler sunucuda, 200 satırdan sonra "Daha eski temaslar" (anahtar kümesi).
 */
export function ContactHistory() {
  const { t, lang } = useLang();
  const { isAdmin } = useCrm();
  const { ref } = useReference();
  const { team, nameOf } = useTeamNames();
  const errText = useErrorText();
  const [range, setRange] = useState<Range>("30");
  const [type, setType] = useState("");
  const [outcome, setOutcome] = useState("");
  const [owner, setOwner] = useState("");
  const [doneBy, setDoneBy] = useState("");
  const [q, setQ] = useState("");
  const [note, setNote] = useState("");
  const [items, setItems] = useState<ContactHistoryItemDto[] | null>(null);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const seq = useRef(0);
  const tz = ref?.timeZone ?? "Europe/Istanbul";
  const day = useMemo(() => new Intl.DateTimeFormat("en-CA", { timeZone: tz }), [tz]);

  const params = useCallback(() => {
    const p = new URLSearchParams();
    const now = new Date();
    if (range !== "all") {
      const from = new Date(now.getTime() - (range === "today" ? 0 : range === "week" ? 6 : 29) * 86_400_000);
      p.set("from", day.format(from));
      p.set("to", day.format(now));
    }
    if (type) p.set("type", type);
    if (outcome) p.set("outcome", outcome);
    if (owner) p.set("owner", owner);
    if (doneBy) p.set("doneBy", doneBy);
    if (q.trim()) p.set("q", q.trim());
    if (note.trim()) p.set("note", note.trim());
    p.set("limit", "200");
    return p;
  }, [range, type, outcome, owner, doneBy, q, note, day]);

  useEffect(() => {
    const n = ++seq.current;
    const id = setTimeout(() => {
      contactApi
        .history(params())
        .then((r) => {
          if (n !== seq.current) return;
          setItems(r.items);
          setNextBefore(r.nextBefore);
          setError(null);
        })
        .catch((e) => n === seq.current && setError(e));
    }, 200);
    return () => clearTimeout(id);
  }, [params]);

  const more = async () => {
    if (!nextBefore) return;
    const p = params();
    p.set("before", nextBefore);
    try {
      const r = await contactApi.history(p);
      setItems((x) => [...(x ?? []), ...r.items]);
      setNextBefore(r.nextBefore);
    } catch (e) {
      setError(e);
    }
  };
  const when = (iso: string, est: boolean) =>
    `${est ? "≈ " : ""}${new Date(iso).toLocaleString(lang === "tr" ? "tr-TR" : "en-GB", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      ...(est ? {} : { hour: "2-digit", minute: "2-digit" }),
    })}`;

  return (
    <div className="hist">
      <div className="hist-filters">
        <div className="chips" role="group" aria-label={t("history.range")}>
          {(["today", "week", "30", "all"] as const).map((r) => (
            <button key={r} type="button" className="chip hit" aria-pressed={range === r} onClick={() => setRange(r)}>
              {t(`history.range.${r}`)}
            </button>
          ))}
        </div>
        <select aria-label={t("contact.channel")} value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">{t("history.allChannels")}</option>
          {(ref?.activityTypes ?? []).map((x) => (
            <option key={x} value={x}>
              {t(`activity.type.${x}`)}
            </option>
          ))}
        </select>
        <select aria-label={t("contact.outcome")} value={outcome} onChange={(e) => setOutcome(e.target.value)}>
          <option value="">{t("history.allOutcomes")}</option>
          {(ref?.outcomeDisplayOrder ?? []).map((x) => (
            <option key={x} value={x}>
              {t(`activity.outcome.${x}`)}
            </option>
          ))}
        </select>
        {isAdmin && (
          <select aria-label={t("lead.owner")} value={owner} onChange={(e) => setOwner(e.target.value)}>
            <option value="">{t("history.allOwners")}</option>
            <option value="pool">{t("common.pool")}</option>
            {team.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        )}
        <select aria-label={t("history.by")} value={doneBy} onChange={(e) => setDoneBy(e.target.value)}>
          <option value="">
            {t("history.by")}: {t("common.all")}
          </option>
          <option value="me">{t("common.me")}</option>
          {isAdmin &&
            team.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
        </select>
        <input
          type="search"
          placeholder={t("history.searchLead")}
          aria-label={t("history.searchLead")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <input
          type="search"
          placeholder={t("history.searchNote")}
          aria-label={t("history.searchNote")}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
      {error ? (
        <Empty title={errText(error)} />
      ) : !items ? (
        <div aria-busy="true">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} h={56} />
          ))}
        </div>
      ) : items.length === 0 ? (
        <Empty title={t("history.empty")} />
      ) : (
        <>
          <ol className="hist-list">
            {items.map((x) => (
              <li key={x.activity.id} className="hist-row">
                <span className="hist-ic" aria-hidden="true">
                  <Icon name={ACTIVITY_ICON[x.activity.type]} size={16} />
                </span>
                <div className="hist-main">
                  <div className="hist-top">
                    <time dateTime={x.activity.doneAt ?? x.activity.dueAt}>
                      {when(x.activity.doneAt ?? x.activity.dueAt, x.activity.dateEstimated)}
                    </time>
                    <a
                      href={`#/lead/${encodeURIComponent(x.lead.id)}`}
                      onClick={(e) => (e.preventDefault(), navigate("lead", undefined, x.lead.id))}
                    >
                      {x.lead.fullName}
                    </a>
                    <span>
                      {t(`activity.type.${x.activity.type}`)}
                      {x.activity.outcome && ` · ${t(`activity.outcome.${x.activity.outcome}`)}`}
                    </span>
                  </div>
                  {x.activity.resultNote && <p className="hist-note">{x.activity.resultNote}</p>}
                  <small className="muted">
                    {t("contact.by", { who: nameOf(x.activity.doneByUserId ?? x.activity.createdByUserId) })}
                    {x.next &&
                      ` · ${t("history.next")}: ${t(`activity.type.${x.next.type}`)} ${new Date(x.next.dueAt).toLocaleString(lang === "tr" ? "tr-TR" : "en-GB", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}`}
                  </small>
                </div>
              </li>
            ))}
          </ol>
          {nextBefore && (
            <Button onClick={more} icon="chevron">
              {t("history.more")}
            </Button>
          )}
        </>
      )}
    </div>
  );
}
