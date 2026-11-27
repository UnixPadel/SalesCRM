import { useCallback, useMemo, useState } from "react";
import { Button, Empty, Modal, Skeleton, StatusTag } from "../../components/ui";
import { countryName, countryOptions } from "../../domain/constants";
import { useLang } from "../../i18n";
import type {
  NonSalesReassignResultDto,
  PoolApplyResultDto,
  TerritoriesDto,
} from "../../modules/sales-pipeline/api/dto";
import { useCrm } from "../../state/CrmContext";
import { useErrorText, useTeamNames } from "../hooks";
import { adminApi } from "./adminApi";
import { ConfirmDialog, LoadError, SectionHead, useLoad, useAdminCanWrite, Write } from "./bits";

/**
 * Bölgeler sekmesi (Faz 7b): ülke → sorumlu / yedek kuralları. Sorumlu ya da yedek seçimi satırda hemen kaydedilir.
 * Kural yalnız yeni lead'in otomatik atamasını belirler; mevcut havuz lead'leri için "Havuza uygula" önce sonucu
 * gösterir, onaydan sonra atar.
 */
type Rule = TerritoriesDto["rules"][number];

/** İlk bakışta gösterilen kuralsız ülke sayısı; kalanı "Tümünü göster" ile açılır. */
const UNCOVERED_PREVIEW = 8;

/**
 * "Fransa (FR)": uygulamanın kendi ülke adı; listede yoksa tarayıcının ülke adları (Intl.DisplayNames, arayüz
 * dilinde); o da yoksa yalnız kod.
 */
function useCountryLabel() {
  const { lang } = useLang();
  return useMemo(() => {
    let names: Intl.DisplayNames | null = null;
    try {
      names = new Intl.DisplayNames([lang], { type: "region" });
    } catch {
      names = null;
    }
    return (raw: string) => {
      const cc = raw.trim().toUpperCase();
      let name = countryName(cc);
      if (name === cc) {
        try {
          name = names?.of(cc) ?? cc;
        } catch {
          name = cc;
        }
      }
      return name === cc ? cc : `${name} (${cc})`;
    };
  }, [lang]);
}

export function TerritoriesTab() {
  const canWrite = useAdminCanWrite();
  const { t, lang } = useLang();
  const { toast } = useCrm();
  const errText = useErrorText();
  const { team, nameOf } = useTeamNames();
  const countryLabel = useCountryLabel();
  const [showAllUncovered, setShowAllUncovered] = useState(false);
  const load = useCallback(() => adminApi.territories(), []);
  const { data, error, reload } = useLoad<TerritoriesDto>(load);
  const [busy, setBusy] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Rule | null>(null);
  const [applying, setApplying] = useState<PoolApplyResultDto | "loading" | null>(null);
  // Sorumlusu satışçı olmayan lead'leri kural sahibine aktarma: önce önizleme, sonra onay.
  const [moving, setMoving] = useState<NonSalesReassignResultDto | "loading" | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [countryQuery, setCountryQuery] = useState("");

  // Tüm ülkeler: kurallı ve kuralsız ülkelerin sayıları koda göre; arama ad ya da kodda, aksan ve büyük/küçük harf
  // duyarsız ("turk" → Türkiye).
  const ruleOf = useMemo(() => new Map((data?.rules ?? []).map((r) => [r.countryCode.toUpperCase(), r])), [data]);
  const uncoveredOf = useMemo(
    () => new Map((data?.uncovered ?? []).map((u) => [u.countryCode.toUpperCase(), u])),
    [data],
  );
  const allCountries = useMemo(() => {
    const fold = (s: string) => s.toLocaleLowerCase(lang).replace(/ı/g, "i").normalize("NFD").replace(/\p{M}/gu, "");
    const q = fold(countryQuery.trim());
    const list = countryOptions(lang);
    return q ? list.filter(([code, name]) => fold(name).includes(q) || code.toLowerCase() === q) : list;
  }, [countryQuery, lang]);

  const save = async (countryCode: string, assignedUserId: string, fallbackUserId: string | null) => {
    setBusy(countryCode);
    try {
      await adminApi.saveTerritory(countryCode, { assignedUserId, fallbackUserId });
      await reload();
      toast(t("terr.saved", { country: countryLabel(countryCode.toUpperCase()), owner: nameOf(assignedUserId) }));
      return true;
    } catch (e) {
      toast(errText(e), { bad: true });
      return false;
    } finally {
      setBusy(null);
    }
  };

  const remove = async (rule: Rule) => {
    setBusy(rule.countryCode);
    try {
      await adminApi.removeTerritory(rule.countryCode);
      setRemoving(null);
      await reload();
      toast(t("terr.removed", { country: countryLabel(rule.countryCode) }));
    } catch (e) {
      toast(errText(e), { bad: true });
    } finally {
      setBusy(null);
    }
  };

  const openApply = async () => {
    setApplying("loading");
    try {
      setApplying(await adminApi.applyToPool(true));
    } catch (e) {
      setApplying(null);
      toast(errText(e), { bad: true });
    }
  };
  const confirmApply = async () => {
    setBusy("apply");
    try {
      const done = await adminApi.applyToPool(false);
      setApplying(null);
      await reload();
      toast(t("terr.apply.done", { n: done.total }));
    } catch (e) {
      toast(errText(e), { bad: true });
    } finally {
      setBusy(null);
    }
  };

  const openMove = async () => {
    setMoving("loading");
    try {
      setMoving(await adminApi.reassignNonSales(true));
    } catch (e) {
      setMoving(null);
      toast(errText(e), { bad: true });
    }
  };
  const confirmMove = async () => {
    setBusy("move");
    try {
      const done = await adminApi.reassignNonSales(false);
      setMoving(null);
      await reload();
      toast(t("terr.move.done", { n: done.total }));
    } catch (e) {
      toast(errText(e), { bad: true });
    } finally {
      setBusy(null);
    }
  };

  if (!data) {
    return error ? <LoadError message={errText(error)} onRetry={() => void reload()} /> : <Skeleton h={240} />;
  }

  /** Sorumlu seçenekleri: aktif satış ekibi + (pasif olsa da) satırdaki mevcut kullanıcı. */
  const options = (current: string | null) => {
    const ids = team.map((m) => m.id);
    return current && !ids.includes(current) ? [current, ...ids] : ids;
  };

  return (
    <div className="adm-stack">
      <SectionHead title={t("terr.title")} help={t("terr.help")}>
        <Write>
          <Button
            icon="users"
            loading={applying === "loading"}
            onClick={() => void openApply()}
            disabled={!data.rules.length}
          >
            {t("terr.apply")}
          </Button>
          <Button icon="move" loading={moving === "loading"} onClick={() => void openMove()}>
            {t("terr.move")}
          </Button>
        </Write>
      </SectionHead>

      {data.rules.length === 0 ? (
        <Empty title={t("terr.empty")}>{t("terr.emptyHint")}</Empty>
      ) : (
        <div className="adm-table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th scope="col">{t("terr.col.country")}</th>
                <th scope="col">{t("terr.col.owner")}</th>
                <th scope="col">{t("terr.col.fallback")}</th>
                <th scope="col" className="num">
                  {t("terr.col.leads")}
                </th>
                <th scope="col" className="num">
                  {t("terr.col.pool")}
                </th>
                <th scope="col">
                  <span className="sr-only">{t("people.col.actions")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.rules.map((r) => (
                <tr key={r.countryCode} aria-busy={busy === r.countryCode || undefined}>
                  <th scope="row" className="adm-rowhead">
                    {countryLabel(r.countryCode)}
                  </th>
                  <td>
                    <div className="adm-inline">
                      <select
                        className="bare"
                        value={r.assignedUserId}
                        disabled={!canWrite || busy === r.countryCode}
                        aria-label={`${countryLabel(r.countryCode)}: ${t("terr.col.owner")}`}
                        onChange={(e) => void save(r.countryCode, e.target.value, r.fallbackUserId)}
                      >
                        {options(r.assignedUserId).map((id) => (
                          <option key={id} value={id}>
                            {nameOf(id)}
                          </option>
                        ))}
                      </select>
                      {r.assignedInactive && (
                        <StatusTag tone="warn" icon="warn">
                          {t("terr.inactive")}
                        </StatusTag>
                      )}
                    </div>
                  </td>
                  <td>
                    <div className="adm-inline">
                      <select
                        className="bare"
                        value={r.fallbackUserId ?? ""}
                        disabled={!canWrite || busy === r.countryCode}
                        aria-label={`${countryLabel(r.countryCode)}: ${t("terr.col.fallback")}`}
                        onChange={(e) => void save(r.countryCode, r.assignedUserId, e.target.value || null)}
                      >
                        <option value="">{t("terr.noFallback")}</option>
                        {options(r.fallbackUserId)
                          .filter((id) => id !== r.assignedUserId)
                          .map((id) => (
                            <option key={id} value={id}>
                              {nameOf(id)}
                            </option>
                          ))}
                      </select>
                      {r.fallbackInactive && (
                        <StatusTag tone="warn" icon="warn">
                          {t("terr.inactive")}
                        </StatusTag>
                      )}
                    </div>
                  </td>
                  <td className="num">{r.leadCount}</td>
                  <td className="num">{r.poolCount}</td>
                  <td>
                    <div className="row-actions">
                      <Write>
                        <Button size="sm" variant="ghost" icon="trash" onClick={() => setRemoving(r)}>
                          {t("terr.remove")}
                        </Button>
                      </Write>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <SectionHead title={t("terr.uncovered")} />
      {data.uncovered.length === 0 ? (
        <p className="muted">{t("terr.uncovered.none")}</p>
      ) : (
        <div className="adm-table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th scope="col">{t("terr.col.country")}</th>
                <th scope="col" className="num">
                  {t("terr.col.leads")}
                </th>
                <th scope="col" className="num">
                  {t("terr.col.pool")}
                </th>
                <th scope="col">{t("terr.col.owner")}</th>
              </tr>
            </thead>
            <tbody>
              {(showAllUncovered ? data.uncovered : data.uncovered.slice(0, UNCOVERED_PREVIEW)).map((u) => (
                <tr key={u.countryCode}>
                  <th scope="row" className="adm-rowhead">
                    {countryLabel(u.countryCode)}
                  </th>
                  <td className="num">{u.leadCount}</td>
                  <td className="num">{u.poolCount}</td>
                  <td>
                    <div className="adm-inline">
                      <select
                        value={draft[u.countryCode] ?? ""}
                        disabled={!canWrite}
                        aria-label={`${countryLabel(u.countryCode)}: ${t("terr.col.owner")}`}
                        onChange={(e) => setDraft({ ...draft, [u.countryCode]: e.target.value })}
                      >
                        <option value="">{t("terr.chooseOwner")}</option>
                        {team.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                          </option>
                        ))}
                      </select>
                      <Write>
                        <Button
                          size="sm"
                          icon="plus"
                          disabled={!draft[u.countryCode]}
                          loading={busy === u.countryCode}
                          onClick={() => void save(u.countryCode, draft[u.countryCode]!, null)}
                        >
                          {t("terr.addRule")}
                        </Button>
                      </Write>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data.uncovered.length > UNCOVERED_PREVIEW && (
        <div>
          <Button
            size="sm"
            variant="ghost"
            aria-expanded={showAllUncovered}
            onClick={() => setShowAllUncovered(!showAllUncovered)}
          >
            {showAllUncovered ? t("terr.uncovered.less") : t("terr.uncovered.all", { n: data.uncovered.length })}
          </Button>
        </div>
      )}

      <SectionHead title={t("terr.all")} help={t("terr.all.help")} />
      <div className="adm-inline">
        <input
          type="search"
          className="adm-allc-search"
          value={countryQuery}
          placeholder={t("terr.all.search")}
          aria-label={t("terr.all.search")}
          autoComplete="off"
          onChange={(e) => setCountryQuery(e.target.value)}
        />
        <span className="muted" aria-live="polite">
          {t("terr.all.count", { n: allCountries.length })}
        </span>
      </div>
      {allCountries.length === 0 ? (
        <p className="muted">{t("terr.all.none")}</p>
      ) : (
        <div className="adm-table-wrap adm-allc">
          <table className="tbl">
            <thead>
              <tr>
                <th scope="col">{t("terr.col.country")}</th>
                <th scope="col" className="num">
                  {t("terr.col.leads")}
                </th>
                <th scope="col" className="num">
                  {t("terr.col.pool")}
                </th>
                <th scope="col">{t("terr.col.owner")}</th>
              </tr>
            </thead>
            <tbody>
              {allCountries.map(([code, name]) => {
                const rule = ruleOf.get(code);
                const counts = rule ?? uncoveredOf.get(code);
                return (
                  <tr key={code} aria-busy={busy === code || undefined}>
                    <th scope="row" className="adm-rowhead">
                      {`${name} (${code})`}
                    </th>
                    <td className="num">{counts?.leadCount ?? 0}</td>
                    <td className="num">{counts?.poolCount ?? 0}</td>
                    <td>
                      {rule ? (
                        nameOf(rule.assignedUserId)
                      ) : (
                        <div className="adm-inline">
                          <select
                            value={draft[code] ?? ""}
                            disabled={!canWrite}
                            aria-label={`${name}: ${t("terr.col.owner")}`}
                            onChange={(e) => setDraft({ ...draft, [code]: e.target.value })}
                          >
                            <option value="">{t("terr.chooseOwner")}</option>
                            {team.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.name}
                              </option>
                            ))}
                          </select>
                          <Write>
                            <Button
                              size="sm"
                              icon="plus"
                              disabled={!draft[code]}
                              loading={busy === code}
                              onClick={() => void save(code, draft[code]!, null)}
                            >
                              {t("terr.addRule")}
                            </Button>
                          </Write>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {removing && (
        <ConfirmDialog
          title={t("terr.remove")}
          confirmLabel={t("terr.remove")}
          danger
          busy={busy === removing.countryCode}
          onConfirm={() => void remove(removing)}
          onClose={() => setRemoving(null)}
        >
          {t("terr.removeConfirm", { country: countryLabel(removing.countryCode) })}
        </ConfirmDialog>
      )}

      {moving && moving !== "loading" && (
        <Modal
          title={t("terr.move.title")}
          onClose={() => setMoving(null)}
          width={520}
          footer={
            <>
              <Button variant="ghost" onClick={() => setMoving(null)} disabled={busy === "move"}>
                {t("admin.cancel")}
              </Button>
              {moving.total > 0 && (
                <Button variant="pri" loading={busy === "move"} onClick={() => void confirmMove()}>
                  {t("terr.move.confirm", { n: moving.total })}
                </Button>
              )}
            </>
          }
        >
          {moving.fromUsers.length === 0 ? (
            <p className="adm-confirm">{t("terr.move.none")}</p>
          ) : (
            <>
              <p className="adm-confirm">{t("terr.move.summary", { n: moving.total })}</p>
              <b>{t("terr.move.from")}</b>
              <ul className="adm-facts">
                {moving.fromUsers.map((u) => (
                  <li key={u.userId}>{t("terr.apply.row", { name: nameOf(u.userId), n: u.count })}</li>
                ))}
              </ul>
              {moving.byUser.length > 0 && (
                <>
                  <b>{t("terr.move.to")}</b>
                  <ul className="adm-facts">
                    {moving.byUser.map((u) => (
                      <li key={u.userId}>{t("terr.apply.row", { name: nameOf(u.userId), n: u.count })}</li>
                    ))}
                  </ul>
                </>
              )}
              {moving.noRule.length > 0 && (
                <>
                  <b>{t("terr.move.noRule")}</b>
                  <ul className="adm-facts">
                    {moving.noRule.map((c) => (
                      <li key={c.countryCode ?? "-"}>
                        {t("terr.apply.row", {
                          name: c.countryCode ? countryLabel(c.countryCode) : t("terr.move.noCountry"),
                          n: c.count,
                        })}
                      </li>
                    ))}
                  </ul>
                  <p className="field-h">{t("terr.move.noRuleHelp")}</p>
                </>
              )}
            </>
          )}
        </Modal>
      )}

      {applying && applying !== "loading" && (
        <Modal
          title={t("terr.apply.title")}
          onClose={() => setApplying(null)}
          width={480}
          footer={
            <>
              <Button variant="ghost" onClick={() => setApplying(null)} disabled={busy === "apply"}>
                {t("admin.cancel")}
              </Button>
              {applying.total > 0 && (
                <Button variant="pri" loading={busy === "apply"} onClick={() => void confirmApply()}>
                  {t("terr.apply.confirm", { n: applying.total })}
                </Button>
              )}
            </>
          }
        >
          {applying.total === 0 ? (
            <p className="adm-confirm">{t("terr.apply.none")}</p>
          ) : (
            <>
              <p className="adm-confirm">{t("terr.apply.summary", { n: applying.total })}</p>
              <ul className="adm-facts">
                {applying.byUser.map((u) => (
                  <li key={u.userId}>{t("terr.apply.row", { name: nameOf(u.userId), n: u.count })}</li>
                ))}
              </ul>
            </>
          )}
        </Modal>
      )}
    </div>
  );
}
