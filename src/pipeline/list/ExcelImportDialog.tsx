import { useEffect, useRef, useState, type DragEvent } from "react";
import { Button, Icon, Modal } from "../../components/ui";
import { LANGS, useLang, type Lang } from "../../i18n";
import type { LeadListDto, UpdateLeadBody } from "../../modules/sales-pipeline/api/dto";
import { PipelineError, pipelineApi } from "../api";
import { contactApi } from "../contact/contactApi";
import { useErrorText } from "../hooks";
import { readWorkbook } from "./excelFile";
import {
  excelHeader,
  layoutMismatch,
  planImport,
  rowLeadId,
  type ImportPlan,
  type ParseCtx,
  type PatchPart,
  type PlannedLead,
} from "./excelSync";
import type { Ctx } from "./listColumns";

const MAX_MB = 15;
/** Önizlemede gösterilen değişiklik satırı üst sınırı; kalanı sayıyla bildirilir. */
const PREVIEW_ROWS = 150;
/** `/leads` bir çağrıda en çok bu kadar lead döner; dosyadaki kalanlar tek tek istenir. */
const LIST_CAP = 2000;

interface Problem {
  text: string;
  details?: string[];
}
type Step =
  | { s: "pick"; problem?: Problem }
  | { s: "checking"; file: string }
  | { s: "review"; file: string; plan: ImportPlan }
  | { s: "applying"; file: string; plan: ImportPlan; done: number }
  | { s: "done"; ok: number; failed: { name: string; text: string }[] };

async function pool<T>(items: readonly T[], size: number, run: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await run(items[next++]!);
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
}

/**
 * Excel'den içe aktarım (yalnız yönetici). Adımlar: dosya seç → düzen denetimi → değişikliklerin önizlemesi →
 * onay → uygulama → sonuç. Dosyanın başlık satırı programdaki listeyle birebir aynı değilse hiçbir şey alınmaz.
 * Değişiklikler mevcut uç noktalardan gider (alanlar, kişi kimliği, müşteri durumu, sorumlu); kurallar ve yetki
 * sunucuda aynen işler, bir lead'in hatası diğerlerini durdurmaz.
 */
export function ExcelImportDialog({
  ctxFor,
  owners,
  refData,
  onClose,
  onApplied,
}: {
  ctxFor: (lang: Lang) => Ctx;
  owners: ParseCtx["owners"];
  refData: ParseCtx["ref"];
  onClose: () => void;
  onApplied: () => void;
}) {
  const { t, lang } = useLang();
  const errText = useErrorText();
  const [step, setStep] = useState<Step>({ s: "pick" });
  const [over, setOver] = useState(false);
  const seq = useRef(0);
  // Adım değişince tıklanan öğe DOM'dan kalkar; odak pencerenin içinde, yeni içeriğin başında kalır.
  const body = useRef<HTMLDivElement>(null);
  const shown = useRef(step.s);
  useEffect(() => {
    if (shown.current === step.s) return;
    shown.current = step.s;
    body.current?.focus();
  }, [step.s]);
  useEffect(() => () => void seq.current++, []);

  const check = async (file: File) => {
    const n = ++seq.current;
    const fail = (problem: Problem) => n === seq.current && setStep({ s: "pick", problem });
    if (!/\.xlsx$/i.test(file.name)) return fail({ text: t("xl.err.type") });
    if (file.size > MAX_MB * 1024 * 1024) return fail({ text: t("xl.err.size", { mb: MAX_MB }) });
    setStep({ s: "checking", file: file.name });
    let sheet: Awaited<ReturnType<typeof readWorkbook>>;
    try {
      sheet = await readWorkbook(await file.arrayBuffer());
    } catch {
      return fail({ text: t("xl.err.read") });
    }
    // Başlıklar hangi dilde dışa aktarıldıysa o dilin düzeniyle kelimesi kelimesine aynı olmalı.
    const langs = [lang, ...LANGS.map((l) => l.code).filter((l) => l !== lang)];
    const fileLang = langs.find((l) => !layoutMismatch(excelHeader(ctxFor(l).t), sheet.header));
    if (!fileLang) {
      const m = layoutMismatch(excelHeader(t), sheet.header)!;
      const blank = (s: string) => s || t("xl.blank");
      return fail({
        text: t("xl.err.layout"),
        details: [
          ...(m.expected !== m.actual ? [t("xl.err.count", { expected: m.expected, actual: m.actual })] : []),
          ...(m.at ? [t("xl.err.col", { n: m.at.n, expected: blank(m.at.expected), actual: blank(m.at.actual) })] : []),
        ],
      });
    }
    const leads = new Map<string, LeadListDto>();
    try {
      const all = await contactApi.leads(new URLSearchParams({ includeTest: "1", limit: String(LIST_CAP) }));
      for (const l of all) leads.set(l.id, l);
      if (all.length >= LIST_CAP) {
        const missing = [...new Set(sheet.rows.map((r) => rowLeadId(r.cells)))].filter((id) => id && !leads.has(id));
        await pool(missing, 6, async (id) => {
          try {
            leads.set(id, (await pipelineApi.get(id)).lead);
          } catch (e) {
            // Silinmiş ya da görünmeyen lead "karşılığı yok" sayılır; ağ hatası içe aktarımı durdurur.
            if (!(e instanceof PipelineError) || (e.status !== 404 && e.status !== 403)) throw e;
          }
        });
      }
    } catch {
      return fail({ text: t("xl.err.load") });
    }
    if (n !== seq.current) return;
    const plan = planImport(sheet.rows, leads, {
      ctx: ctxFor(fileLang),
      owners,
      ref: refData,
      baseline: sheet.snapshot && new Map(sheet.snapshot.map((cells) => [rowLeadId(cells), cells])),
      exportedAt: sheet.createdAt,
    });
    setStep({ s: "review", file: file.name, plan });
  };

  const applyLead = async (l: PlannedLead): Promise<string[]> => {
    const { patch } = l;
    const calls: [PatchPart, () => Promise<unknown>][] = [];
    // Ülke telefonun okunmasını etkiler: önce alanlar, sonra kişi kimliği.
    if (Object.keys(patch.fields).length)
      calls.push(["fields", () => pipelineApi.update(l.id, patch.fields as UpdateLeadBody)]);
    if (Object.keys(patch.contact).length)
      calls.push(["contact", () => pipelineApi.updateContact(l.id, patch.contact)]);
    if (patch.status !== undefined) calls.push(["status", () => contactApi.setStatus(l.id, patch.status ?? null)]);
    if (patch.owner !== undefined)
      calls.push(["owner", () => pipelineApi.assign(l.id, { toUserId: patch.owner ?? null })]);
    const errors: string[] = [];
    for (const [part, run] of calls) {
      try {
        await run();
      } catch (e) {
        const cols = l.changes.filter((c) => c.part === part).map((c) => c.label);
        errors.push(`${cols.join(", ")}: ${errText(e)}`);
      }
    }
    return errors;
  };

  const apply = async (file: string, plan: ImportPlan) => {
    setStep({ s: "applying", file, plan, done: 0 });
    const failed: { name: string; text: string }[] = [];
    let ok = 0;
    let done = 0;
    await pool(plan.leads, 4, async (l) => {
      const errors = await applyLead(l);
      if (errors.length) failed.push({ name: l.name, text: errors.join(" ") });
      else ok++;
      done++;
      setStep((cur) => (cur.s === "applying" ? { ...cur, done } : cur));
    });
    setStep({ s: "done", ok, failed });
    onApplied();
  };

  const pick = (files: FileList | null) => {
    const file = files?.[0];
    if (file) void check(file);
  };
  const onDrop = (e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setOver(false);
    pick(e.dataTransfer.files);
  };
  const busy = step.s === "applying";
  const value = (s: string) => (s ? s : <span className="xl-blank">{t("xl.blank")}</span>);

  const review = (file: string, plan: ImportPlan, applying: number | null) => {
    const visible: PlannedLead[] = [];
    let listed = 0;
    for (const l of plan.leads) {
      if (listed >= PREVIEW_ROWS) break;
      visible.push(l);
      listed += l.changes.length;
    }
    const hiddenChanges = plan.changeCount - listed;
    const skips: [number, string][] = [
      [plan.noId, "xl.skip.noId"],
      [plan.unknown, "xl.skip.unknown"],
      [plan.duplicate, "xl.skip.duplicate"],
    ];
    return (
      <>
        <p className="xl-file">
          <Icon name="file" size={16} /> <span>{file}</span>
          {applying === null && (
            <button type="button" className="link-btn" onClick={() => setStep({ s: "pick" })}>
              {t("xl.pickOther")}
            </button>
          )}
        </p>
        {plan.changeCount === 0 ? (
          <div className="xl-none">
            <h3>{t("xl.none.title")}</h3>
            <p>{t("xl.none.text")}</p>
          </div>
        ) : (
          <>
            <h3 className="xl-sum">{t("xl.summary", { n: plan.changeCount, leads: plan.leads.length })}</h3>
            {plan.staleCount > 0 && (
              <p className="xl-note warn">
                <Icon name="warn" size={16} /> <span>{t("xl.stale", { n: plan.staleCount })}</span>
              </p>
            )}
            <div className="xl-table-wrap" tabIndex={0} role="region" aria-label={t("xl.changes")}>
              <table className="xl-table">
                <caption className="sr-only">{t("xl.changes")}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t("xl.th.lead")}</th>
                    <th scope="col">{t("xl.th.col")}</th>
                    <th scope="col">{t("xl.th.from")}</th>
                    <th scope="col">{t("xl.th.to")}</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((l) =>
                    l.changes.map((c, i) => (
                      <tr key={`${l.id}-${c.colId}`} className={i === 0 ? "first" : undefined}>
                        {i === 0 && (
                          <th scope="rowgroup" rowSpan={l.changes.length}>
                            {l.name}
                            {l.stale && (
                              <span className="xl-stale" title={t("xl.staleRow")}>
                                <Icon name="warn" size={14} />
                                <span className="sr-only">{t("xl.staleRow")}</span>
                              </span>
                            )}
                          </th>
                        )}
                        <td>{c.label}</td>
                        <td className="xl-from">{value(c.from)}</td>
                        <td className="xl-to">{value(c.to)}</td>
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
            </div>
            {hiddenChanges > 0 && <p className="muted">{t("xl.more", { n: hiddenChanges })}</p>}
          </>
        )}
        {skips.map(
          ([n, key]) =>
            n > 0 && (
              <p key={key} className="xl-note info">
                <Icon name="info" size={16} /> <span>{t(key, { n })}</span>
              </p>
            ),
        )}
        {plan.invalid.length > 0 && (
          <details className="xl-note warn xl-invalid">
            <summary>
              <Icon name="warn" size={16} /> {t("xl.invalid.title", { n: plan.invalid.length })}
            </summary>
            <ul>
              {plan.invalid.slice(0, 50).map((x, i) => (
                <li key={i}>
                  {t("xl.invalid.row", { row: x.row, col: x.label, value: x.value, reason: t(x.reason, x.vars) })}
                </li>
              ))}
            </ul>
          </details>
        )}
        {applying !== null && (
          <div className="xl-progress" role="status">
            <progress max={plan.leads.length} value={applying} aria-label={t("xl.changes")} />
            <span>{t("xl.applying", { done: applying, total: plan.leads.length })}</span>
          </div>
        )}
      </>
    );
  };

  return (
    <Modal
      title={t("list.import")}
      onClose={busy ? () => undefined : onClose}
      width={720}
      footer={
        step.s === "done" || (step.s === "review" && step.plan.changeCount === 0) ? (
          <Button variant="pri" onClick={onClose}>
            {t("common.close")}
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              {t("common.cancel")}
            </Button>
            {(step.s === "review" || step.s === "applying") && (
              <Button
                variant="pri"
                loading={busy}
                onClick={() => step.s === "review" && void apply(step.file, step.plan)}
              >
                {t("xl.apply", { n: step.plan.changeCount })}
              </Button>
            )}
          </>
        )
      }
    >
      <div className="xl" ref={body} tabIndex={-1}>
        {(step.s === "pick" || step.s === "checking") && (
          <>
            <p>{t("xl.intro")}</p>
            <ul className="xl-rules">
              <li>{t("xl.rule.layout")}</li>
              <li>{t("xl.rule.scope")}</li>
            </ul>
            {step.s === "checking" ? (
              <div className="xl-busy" role="status">
                <span className="spinner" aria-hidden="true" /> {t("xl.checking")}{" "}
                <span className="muted">{step.file}</span>
              </div>
            ) : (
              <label
                className={"xl-drop" + (over ? " over" : "")}
                onDragOver={(e) => (e.preventDefault(), setOver(true))}
                onDragLeave={() => setOver(false)}
                onDrop={onDrop}
              >
                <input
                  className="sr-only"
                  type="file"
                  accept=".xlsx"
                  aria-describedby={step.problem ? "xl-problem" : undefined}
                  onChange={(e) => (pick(e.target.files), (e.target.value = ""))}
                />
                <Icon name="upload" size={24} />
                <span className="xl-drop-t">{t("xl.pick")}</span>
                <span className="xl-drop-h">{t("xl.pickHint")}</span>
              </label>
            )}
            {step.s === "pick" && step.problem && (
              <div className="xl-alert" role="alert" id="xl-problem">
                <Icon name="warn" size={20} />
                <div>
                  <p>{step.problem.text}</p>
                  {!!step.problem.details?.length && (
                    <ul>
                      {step.problem.details.map((d) => (
                        <li key={d}>{d}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </>
        )}
        {step.s === "review" && review(step.file, step.plan, null)}
        {step.s === "applying" && review(step.file, step.plan, step.done)}
        {step.s === "done" && (
          <>
            <h3 className="xl-done">
              <Icon name="checkCircle" size={20} /> {t("xl.done.title")}
            </h3>
            <p>{t("xl.done.ok", { n: step.ok })}</p>
            {step.failed.length > 0 && (
              <div className="xl-alert" role="alert">
                <Icon name="warn" size={20} />
                <div>
                  <p>{t("xl.done.failed", { n: step.failed.length })}</p>
                  <ul>
                    {step.failed.map((f, i) => (
                      <li key={i}>
                        <b>{f.name}</b> · {f.text}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
