import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../data/api";
import type { TeamMember } from "../domain/types";
import { useLang } from "../i18n";
import type { LeadDetailDto, LeadDto, ReferenceDto, StageCodeDto } from "../modules/sales-pipeline/api/dto";
import { useCrm } from "../state/CrmContext";
import { PipelineError, pipelineApi } from "./api";

/** Hata → kullanıcı metni: önce kod çevirisi, yoksa sunucu mesajı. */
export function useErrorText() {
  const { t } = useLang();
  return useCallback(
    (e: unknown): string => {
      if (e instanceof PipelineError) {
        const translated = t(`err.${e.code}`);
        return translated === `err.${e.code}` ? e.message : translated;
      }
      return e instanceof Error ? e.message : String(e);
    },
    [t],
  );
}

let referenceCache: ReferenceDto | null = null;

/** Aşama sözlüğü, kayıp nedenleri, sorular, para birimleri: bir kez yüklenir, oturum boyunca kalır. */
export function useReference() {
  const [ref, setRef] = useState<ReferenceDto | null>(referenceCache);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (referenceCache) return;
    pipelineApi
      .reference()
      .then((r) => {
        referenceCache = r;
        setRef(r);
      })
      .catch(setError);
  }, []);
  const { lang } = useLang();
  const stageName = useCallback(
    (code: StageCodeDto | string) => {
      const s = ref?.stages.find((x) => x.code === code);
      return s ? (lang === "tr" ? s.nameTr : s.nameEn) : String(code);
    },
    [ref, lang],
  );
  const reasonName = useCallback(
    (code: string | null) => {
      if (!code) return "";
      const r = ref?.lostReasons.find((x) => x.code === code);
      return r ? (lang === "tr" ? r.nameTr : r.nameEn) : code;
    },
    [ref, lang],
  );
  return { ref, error, stageName, reasonName };
}

export interface LeadFilter {
  stage?: StageCodeDto | undefined;
  q?: string | undefined;
  includeTest?: boolean | undefined;
}

export function useLeads(filter: LeadFilter) {
  const [leads, setLeads] = useState<LeadDto[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const key = `${filter.stage ?? ""}|${filter.q ?? ""}|${filter.includeTest ? 1 : 0}`;
  const seq = useRef(0);
  const reload = useCallback(() => {
    const n = ++seq.current;
    pipelineApi
      .list({ stage: filter.stage, q: filter.q, includeTest: filter.includeTest })
      .then((r) => {
        if (n !== seq.current) return;
        setLeads(r);
        setError(null);
      })
      .catch((e) => n === seq.current && setError(e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(reload, [reload]);
  return { leads, error, reload };
}

export function useLeadDetail(id: string | null) {
  const [detail, setDetail] = useState<LeadDetailDto | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(!!id);
  const reload = useCallback(() => {
    if (!id) return;
    pipelineApi
      .get(id)
      .then((d) => {
        setDetail(d);
        setError(null);
      })
      .catch(setError)
      .finally(() => setLoading(false));
  }, [id]);
  useEffect(reload, [reload]);
  return { detail, setDetail, error, loading, reload };
}

/** Kullanıcı kimliği → görünen ad; roster mevcut /api/users ucundan. */
export function useTeamNames() {
  const { user } = useCrm();
  const [team, setTeam] = useState<TeamMember[]>([]);
  useEffect(() => {
    if (!user) return;
    api<TeamMember[]>("GET", "/api/users")
      .then(setTeam)
      .catch(() => setTeam([]));
  }, [user]);
  const { t } = useLang();
  const nameOf = useCallback(
    (userId: string | null): string => {
      if (!userId) return t("common.pool");
      if (user && userId === user.id) return user.name;
      const m = team.find((x) => x.id === userId || x.email === userId);
      return m?.name ?? userId;
    },
    [team, user, t],
  );
  const assignable = useMemo(() => team.filter((m) => m.role !== "viewer"), [team]);
  return { team: assignable, nameOf };
}

/** "geleli ne kadar oldu": dakika / saat / gün, dil sözlüğünden. */
export function useSince() {
  const { t } = useLang();
  return useCallback(
    (iso: string, now = Date.now()) => {
      const ms = Math.max(0, now - new Date(iso).getTime());
      const min = Math.floor(ms / 60_000);
      if (min < 1) return t("since.justNow");
      const unit =
        min < 60
          ? t("since.min", { n: min })
          : min < 1440
            ? t("since.hour", { n: Math.floor(min / 60) })
            : t("since.day", { n: Math.floor(min / 1440) });
      return t("since.ago", { t: unit });
    },
    [t],
  );
}

/** Dokunulmamış (NEW) lead için renk: 1 saat → warn, 24 saat → bad. */
export function ageTone(lead: LeadDto, now = Date.now()): "warn" | "bad" | null {
  if (lead.currentStage !== "NEW") return null;
  const h = (now - new Date(lead.createdAt).getTime()) / 3_600_000;
  return h >= 24 ? "bad" : h >= 1 ? "warn" : null;
}

/** Saniyede bir yenilenen "şimdi": sayaçlar ve geri al süresi için. */
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
