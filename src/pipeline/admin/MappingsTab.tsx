import { useCallback, useState } from "react";
import { Button, Empty, Field, Modal, Skeleton } from "../../components/ui";
import { useLang } from "../../i18n";
import type { FieldMappingDto, FieldMappingsDto, StageMappingDto } from "../../modules/integration-settings/api/dto";
import { useCrm } from "../../state/CrmContext";
import { PipelineError } from "../api";
import { useErrorText, useReference } from "../hooks";
import { adminApi } from "./adminApi";
import { ConfirmDialog, LoadError, SectionHead, useLoad, useProviderName } from "./bits";

/**
 * Eşlemeler sekmesi (Faz 7b): seçilen sağlayıcı için aşama → platform olayı ve form alanı → lead alanı. Kaydedilen
 * eşleme hemen geçerlidir. Aşama tablosu tek "Kaydet" ile yazılır (hedef seçimi satırlar arası kuraldır); alan
 * eşlemesinde hedef ve açık/kapalı değişikliği satırda hemen kaydedilir.
 */
export interface ProviderOption {
  provider: string;
  hasOutbound: boolean;
}

export function MappingsTab({ providers }: { providers: readonly ProviderOption[] }) {
  const { t } = useLang();
  const providerName = useProviderName();
  const [provider, setProvider] = useState(providers[0]?.provider ?? "");
  const current = providers.find((p) => p.provider === provider) ?? providers[0];
  if (!current) return null;
  return (
    <div className="adm-stack">
      <div className="tabs" role="tablist" aria-label={t("admin.provider")}>
        {providers.map((p) => (
          <button
            key={p.provider}
            type="button"
            role="tab"
            aria-selected={p.provider === current.provider}
            className="tab"
            onClick={() => setProvider(p.provider)}
          >
            {providerName(p.provider)}
          </button>
        ))}
      </div>
      {current.hasOutbound ? (
        <StageMappings key={`s:${current.provider}`} provider={current.provider} />
      ) : (
        <>
          <SectionHead title={t("map.stage.title")} />
          <p className="muted">{t("map.stage.noOutbound")}</p>
        </>
      )}
      <FieldMappings key={`f:${current.provider}`} provider={current.provider} />
    </div>
  );
}

function StageMappings({ provider }: { provider: string }) {
  const { t } = useLang();
  const { toast } = useCrm();
  const errText = useErrorText();
  const { stageName } = useReference();
  const load = useCallback(() => adminApi.stageMappings(provider), [provider]);
  const { data, error, reload, setData } = useLoad(load);
  // Düzenlenen satırlar taslakta durur; taslak yokken yüklenen veri gösterilir.
  const [draft, setRows] = useState<StageMappingDto[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<{ stageCode: string | null; text: string } | null>(null);

  const rows = draft ?? data?.rows ?? null;
  if (!rows) {
    return error ? <LoadError message={errText(error)} onRetry={() => void reload()} /> : <Skeleton h={220} />;
  }
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(data?.rows ?? []);
  const patch = (stageCode: string, p: Partial<StageMappingDto>) => {
    setProblem(null);
    setRows(rows.map((r) => (r.stageCode === stageCode ? { ...r, ...p } : r)));
  };
  const nameKey = `map.stage.eventName.${provider}`;
  const nameLabel = t(nameKey) === nameKey ? t("map.stage.eventName") : t(nameKey);

  const save = async () => {
    setSaving(true);
    setProblem(null);
    try {
      setData(await adminApi.saveStageMappings(provider, rows));
      setRows(null);
      toast(t("admin.saved"));
    } catch (e) {
      const stageCode = e instanceof PipelineError ? ((e.details["stageCode"] as string | undefined) ?? null) : null;
      setProblem({ stageCode, text: errText(e) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-labelledby="adm-stage-h" className="adm-stack">
      <SectionHead title={t("map.stage.title")} help={t("map.stage.help")} />
      <div className="adm-table-wrap">
        <table className="tbl" aria-labelledby="adm-stage-h">
          <thead>
            <tr>
              <th scope="col" id="adm-stage-h">
                {t("health.col.stage")}
              </th>
              <th scope="col">{nameLabel}</th>
              <th scope="col">{t("map.stage.enabled")}</th>
              <th scope="col">{t("map.stage.target")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const bad = problem?.stageCode === r.stageCode;
              return (
                <tr key={r.stageCode}>
                  <th scope="row" className="adm-rowhead">
                    {stageName(r.stageCode)}
                  </th>
                  <td>
                    <input
                      className={"adm-input" + (bad ? " is-bad" : "")}
                      value={r.platformEventName}
                      maxLength={200}
                      aria-label={`${stageName(r.stageCode)}: ${nameLabel}`}
                      aria-invalid={bad || undefined}
                      onChange={(e) => patch(r.stageCode, { platformEventName: e.target.value })}
                    />
                  </td>
                  <td>
                    <label className="cd-check">
                      <input
                        type="checkbox"
                        checked={r.enabled}
                        onChange={(e) => patch(r.stageCode, { enabled: e.target.checked })}
                      />
                      <span className="sr-only">
                        {stageName(r.stageCode)}: {t("map.stage.enabled")}
                      </span>
                    </label>
                  </td>
                  <td>
                    <label className="cd-check">
                      <input
                        type="radio"
                        name={`target-${provider}`}
                        checked={r.isOptimizationTarget}
                        onChange={() => {
                          setProblem(null);
                          setRows(rows.map((x) => ({ ...x, isOptimizationTarget: x.stageCode === r.stageCode })));
                        }}
                      />
                      <span className="sr-only">
                        {stageName(r.stageCode)}: {t("map.stage.target")}
                      </span>
                    </label>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="adm-actions">
        <Button variant="pri" disabled={!dirty} loading={saving} onClick={() => void save()}>
          {t("admin.save")}
        </Button>
        {rows.some((r) => r.isOptimizationTarget) && (
          <Button
            variant="ghost"
            onClick={() => {
              setProblem(null);
              setRows(rows.map((x) => ({ ...x, isOptimizationTarget: false })));
            }}
          >
            {t("map.stage.noTarget")}
          </Button>
        )}
        {problem && (
          <span className="field-err" role="alert">
            {problem.text}
          </span>
        )}
      </div>
    </section>
  );
}

function FieldMappings({ provider }: { provider: string }) {
  const { t } = useLang();
  const { toast } = useCrm();
  const errText = useErrorText();
  const load = useCallback(() => adminApi.fieldMappings(provider), [provider]);
  const { data, error, reload, setData } = useLoad<FieldMappingsDto>(load);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<FieldMappingDto | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const targetText = (target: string) => {
    const key = `map.target.${target}`;
    return t(key) === key ? target : t(key);
  };

  const saveRow = async (row: FieldMappingDto, p: Partial<FieldMappingDto>) => {
    setBusy(row.id);
    try {
      setData(await adminApi.saveFieldMapping(provider, { ...row, ...p }));
      toast(t("admin.saved"));
    } catch (e) {
      toast(errText(e), { bad: true });
    } finally {
      setBusy(null);
    }
  };

  const remove = async (row: FieldMappingDto) => {
    setBusy(row.id);
    try {
      setData(await adminApi.removeFieldMapping(provider, row.id));
      setRemoving(null);
      toast(t("map.field.removed"));
    } catch (e) {
      toast(errText(e), { bad: true });
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="adm-stack">
      <SectionHead title={t("map.field.title")} help={t("map.field.help")}>
        <Button size="sm" icon="plus" onClick={() => setAdding(true)} disabled={!data}>
          {t("map.field.add")}
        </Button>
      </SectionHead>
      {!data ? (
        error ? (
          <LoadError message={errText(error)} onRetry={() => void reload()} />
        ) : (
          <Skeleton h={200} />
        )
      ) : data.rows.length === 0 ? (
        <Empty title={t("map.field.empty")} />
      ) : (
        <div className="adm-table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th scope="col">{t("map.field.form")}</th>
                <th scope="col">{t("map.field.platformField")}</th>
                <th scope="col">{t("map.field.targetField")}</th>
                <th scope="col">{t("map.field.active")}</th>
                <th scope="col">
                  <span className="sr-only">{t("people.col.actions")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.id} aria-busy={busy === r.id || undefined}>
                  <td>
                    {r.formId ? <code>{r.formId}</code> : <span className="muted">{t("map.field.allForms")}</span>}
                  </td>
                  <td>
                    <code>{r.platformField}</code>
                  </td>
                  <td>
                    <select
                      className="bare"
                      value={r.target}
                      disabled={busy === r.id}
                      aria-label={`${r.platformField}: ${t("map.field.targetField")}`}
                      onChange={(e) => void saveRow(r, { target: e.target.value })}
                    >
                      {data.targets.map((k) => (
                        <option key={k} value={k}>
                          {targetText(k)}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <label className="cd-check">
                      <input
                        type="checkbox"
                        checked={r.isActive}
                        disabled={busy === r.id}
                        onChange={(e) => void saveRow(r, { isActive: e.target.checked })}
                      />
                      <span className="sr-only">
                        {r.platformField}: {t("map.field.active")}
                      </span>
                    </label>
                  </td>
                  <td>
                    <div className="row-actions">
                      <Button size="sm" variant="ghost" icon="trash" onClick={() => setRemoving(r)}>
                        {t("map.field.remove")}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {adding && data && (
        <AddFieldMapping
          provider={provider}
          targets={data.targets}
          targetText={targetText}
          onClose={() => setAdding(false)}
          onSaved={(next) => {
            setData(next);
            setAdding(false);
            toast(t("admin.saved"));
          }}
        />
      )}
      {removing && (
        <ConfirmDialog
          title={t("map.field.remove")}
          confirmLabel={t("map.field.remove")}
          danger
          busy={busy === removing.id}
          onConfirm={() => void remove(removing)}
          onClose={() => setRemoving(null)}
        >
          {t("map.field.removeConfirm", { field: removing.platformField })}
        </ConfirmDialog>
      )}
    </section>
  );
}

function AddFieldMapping({
  provider,
  targets,
  targetText,
  onClose,
  onSaved,
}: {
  provider: string;
  targets: readonly string[];
  targetText: (target: string) => string;
  onClose: () => void;
  onSaved: (next: FieldMappingsDto) => void;
}) {
  const { t } = useLang();
  const errText = useErrorText();
  const [platformField, setPlatformField] = useState("");
  const [target, setTarget] = useState(targets.includes("extra") ? "extra" : (targets[0] ?? ""));
  const [formId, setFormId] = useState("");
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const missing = touched && !platformField.trim();

  const save = async () => {
    setTouched(true);
    if (!platformField.trim()) return;
    setSaving(true);
    setProblem(null);
    try {
      onSaved(
        await adminApi.saveFieldMapping(provider, {
          platformField: platformField.trim(),
          target,
          formId: formId.trim() || null,
        }),
      );
    } catch (e) {
      setProblem(errText(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={t("map.field.addTitle")}
      onClose={onClose}
      width={460}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            {t("admin.cancel")}
          </Button>
          <Button variant="pri" loading={saving} onClick={() => void save()}>
            {t("admin.save")}
          </Button>
        </>
      }
    >
      <form
        className="adm-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field
          label={t("map.field.platformField")}
          {...(missing ? { error: t("err.mapping.field_required"), errorId: "adm-fm-field-err" } : {})}
        >
          <input
            value={platformField}
            maxLength={200}
            aria-invalid={missing || undefined}
            aria-describedby={missing ? "adm-fm-field-err" : undefined}
            onChange={(e) => setPlatformField(e.target.value)}
            onBlur={() => setTouched(true)}
          />
        </Field>
        <Field label={t("map.field.targetField")}>
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
            {targets.map((k) => (
              <option key={k} value={k}>
                {targetText(k)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("map.field.form")} hint={t("map.field.formHint")}>
          <input value={formId} maxLength={200} onChange={(e) => setFormId(e.target.value)} />
        </Field>
        {problem && (
          <span className="field-err" role="alert">
            {problem}
          </span>
        )}
      </form>
    </Modal>
  );
}
