import { useCallback, useState } from "react";
import { Button, Field, IconButton, Skeleton, fmtDate } from "../../components/ui";
import { useLang } from "../../i18n";
import type { EurRatesDto, ProviderSettingsDto } from "../../modules/integration-settings/api/dto";
import { useCrm } from "../../state/CrmContext";
import { useErrorText } from "../hooks";
import { adminApi } from "./adminApi";
import { LoadError, SecretList, SectionHead, useLoad, useProviderName } from "./bits";
import type { ProviderOption } from "./MappingsTab";

/**
 * Ayarlar sekmesi (Faz 7b): sağlayıcıların secret olmayan ayarları ve EUR kurları. Gizli anahtarlar gösterilmez ve
 * girilmez; yalnız ortam değişkeninin adı ve tanımlı olup olmadığı görünür.
 */
export function SettingsTab({
  providers,
  generalSecrets,
}: {
  providers: readonly ProviderOption[];
  generalSecrets: readonly { name: string; set: boolean }[];
}) {
  const { t } = useLang();
  return (
    <div className="adm-stack">
      <EurRates />
      {providers.map((p) => (
        <ProviderSettings key={p.provider} provider={p.provider} />
      ))}
      <section className="panel">
        <SectionHead title={t("set.general")} help={t("set.secrets.help")} />
        <SecretList secrets={generalSecrets} />
      </section>
    </div>
  );
}

function ProviderSettings({ provider }: { provider: string }) {
  const { t } = useLang();
  const { toast } = useCrm();
  const errText = useErrorText();
  const providerName = useProviderName();
  const load = useCallback(() => adminApi.settings(provider), [provider]);
  const { data, error, reload, setData } = useLoad<ProviderSettingsDto>(load);
  // Yalnız değiştirilen anahtarlar taslakta durur; diğerleri yüklenen değerden okunur.
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const values: Record<string, string> = {
    ...Object.fromEntries((data?.settings ?? []).map((s) => [s.key, s.value])),
    ...draft,
  };
  const setValues = (next: Record<string, string>) => setDraft(next);

  const label = (key: string) => {
    const k = `set.key.${key}`;
    return t(k) === k ? key : t(k);
  };
  const hint = (key: string) => {
    const k = `set.hint.${key}`;
    return t(k) === k ? undefined : t(k);
  };
  const dirty = data ? data.settings.some((s) => (values[s.key] ?? "") !== s.value) : false;

  const save = async () => {
    if (!data) return;
    setSaving(true);
    setProblem(null);
    try {
      const changed = Object.fromEntries(
        data.settings.filter((s) => (values[s.key] ?? "") !== s.value).map((s) => [s.key, values[s.key] ?? ""]),
      );
      setData(await adminApi.saveSettings(provider, changed));
      setDraft({});
      toast(t("admin.saved"));
    } catch (e) {
      setProblem(errText(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="panel">
      <SectionHead title={t("set.provider.title", { provider: providerName(provider) })} />
      {!data ? (
        error ? (
          <LoadError message={errText(error)} onRetry={() => void reload()} />
        ) : (
          <Skeleton h={120} />
        )
      ) : (
        <>
          {data.settings.length === 0 ? (
            <p className="muted">{t("set.noSettings")}</p>
          ) : (
            <form
              className="adm-form"
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
            >
              {data.settings.map((s) => {
                const h = hint(s.key);
                return (
                  <Field key={s.key} label={label(s.key)} {...(h ? { hint: h } : {})}>
                    <input
                      value={values[s.key] ?? ""}
                      maxLength={500}
                      autoComplete="off"
                      onChange={(e) => setValues({ ...values, [s.key]: e.target.value })}
                    />
                  </Field>
                );
              })}
              <div className="adm-actions">
                <Button type="submit" variant="pri" disabled={!dirty} loading={saving}>
                  {t("admin.save")}
                </Button>
                {problem && (
                  <span className="field-err" role="alert">
                    {problem}
                  </span>
                )}
              </div>
            </form>
          )}
          <h3 className="adm-sub">{t("health.secrets")}</h3>
          <SecretList secrets={data.secrets} />
        </>
      )}
    </section>
  );
}

interface RateRow {
  cur: string;
  rate: string;
}

function EurRates() {
  const { t } = useLang();
  const { toast } = useCrm();
  const errText = useErrorText();
  const load = useCallback(() => adminApi.eurRates(), []);
  const { data, error, reload, setData } = useLoad<EurRatesDto>(load);
  // Düzenlenen tablo taslakta durur; taslak yokken yüklenen kurlar gösterilir.
  const [draft, setRows] = useState<RateRow[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const toRows = (d: EurRatesDto): RateRow[] =>
    Object.entries(d.rates)
      .filter(([cur]) => cur !== "EUR")
      .map(([cur, rate]) => ({ cur, rate: String(rate) }));
  const rows = draft ?? (data ? toRows(data) : []);

  const valid = (r: RateRow) => /^[A-Za-z]{3}$/.test(r.cur.trim()) && Number(r.rate.replace(",", ".")) > 0;
  const dirty = data && draft ? JSON.stringify(draft) !== JSON.stringify(toRows(data)) : false;
  const patch = (i: number, p: Partial<RateRow>) => {
    setProblem(null);
    setRows(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  };

  const save = async () => {
    if (rows.some((r) => !valid(r))) {
      setProblem(t("set.eur.invalid"));
      return;
    }
    setSaving(true);
    setProblem(null);
    try {
      const rates = Object.fromEntries(rows.map((r) => [r.cur.trim().toUpperCase(), Number(r.rate.replace(",", "."))]));
      setData(await adminApi.saveEurRates(rates));
      setRows(null);
      toast(t("admin.saved"));
    } catch (e) {
      setProblem(errText(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="panel">
      <SectionHead title={t("set.eur.title")} help={t("set.eur.help")} />
      {!data ? (
        error ? (
          <LoadError message={errText(error)} onRetry={() => void reload()} />
        ) : (
          <Skeleton h={140} />
        )
      ) : (
        <form
          className="adm-form"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <table className="tbl adm-rates">
            <thead>
              <tr>
                <th scope="col">{t("set.eur.currency")}</th>
                <th scope="col">{t("set.eur.rate")}</th>
                <th scope="col">
                  <span className="sr-only">{t("people.col.actions")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const bad = problem !== null && !valid(r);
                return (
                  <tr key={i}>
                    <td>
                      <input
                        className={"adm-input adm-cur" + (bad ? " is-bad" : "")}
                        value={r.cur}
                        maxLength={3}
                        aria-label={t("set.eur.currency")}
                        aria-invalid={bad || undefined}
                        onChange={(e) => patch(i, { cur: e.target.value.toUpperCase() })}
                      />
                    </td>
                    <td>
                      <input
                        className={"adm-input adm-rate" + (bad ? " is-bad" : "")}
                        value={r.rate}
                        inputMode="decimal"
                        aria-label={`${r.cur || t("set.eur.currency")}: ${t("set.eur.rate")}`}
                        aria-invalid={bad || undefined}
                        onChange={(e) => patch(i, { rate: e.target.value })}
                      />
                    </td>
                    <td>
                      <IconButton
                        icon="trash"
                        size="sm"
                        label={t("set.eur.remove", { cur: r.cur || "?" })}
                        onClick={() => {
                          setProblem(null);
                          setRows(rows.filter((_, j) => j !== i));
                        }}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="adm-actions">
            <Button type="submit" variant="pri" disabled={!dirty} loading={saving}>
              {t("admin.save")}
            </Button>
            <Button icon="plus" onClick={() => setRows([...rows, { cur: "", rate: "" }])}>
              {t("set.eur.add")}
            </Button>
            {problem && (
              <span className="field-err" role="alert">
                {problem}
              </span>
            )}
          </div>
          <p className="muted">
            {data.source === "setting"
              ? t("set.eur.source.setting", { when: data.updatedAt ? fmtDate(data.updatedAt, true) : "" })
              : t(`set.eur.source.${data.source}`)}
          </p>
        </form>
      )}
    </section>
  );
}
