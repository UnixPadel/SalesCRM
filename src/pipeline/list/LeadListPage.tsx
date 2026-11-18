import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { Button, Empty, Icon, Skeleton, StatusTag } from "../../components/ui";
import { countryName, countryOptions } from "../../domain/constants";
import { dirOf, localeOf, refName, translate, useLang, type Lang } from "../../i18n";
import type { LeadDto, LeadListDto, StageCodeDto, UpdateLeadBody } from "../../modules/sales-pipeline/api/dto";
import { navigate, setHashParams } from "../../router";
import { useCrm } from "../../state/CrmContext";
import { pipelineApi } from "../api";
import { StageTag } from "../bits";
import { contactApi } from "../contact/contactApi";
import { ContactLinks } from "../contact/ContactQuickBar";
import { ANSWER_LIST, CustomerStatusTag } from "../contact/LeadSections";
import { dateText, daysAgo, openWarnings, phoneText, roofArea, sourceText, warningText } from "../contact/trackingView";
import { ageTone, useErrorText, useNow, useReference, useTeamNames } from "../hooks";
import { CellEditors, type CellEditorsApi } from "./CellEditors";
import { ColumnFilterPopover } from "./ColumnFilterPopover";
import { ExcelImportDialog } from "./ExcelImportDialog";
import { PickCell, type PickOption } from "./PickCell";
import { SheetSyncBadge } from "./SheetSyncBadge";
import { ANSWER_COLUMNS, cellAction, cellPerms, forwardStages, frozenRows, type CellAction } from "./cellEdit";
import { downloadBlob } from "./csv";
import { XLSX_MIME, buildWorkbook } from "./excelFile";
import { EXCEL_COLUMNS, excelHeader, excelRow, excelTexts, isEditable } from "./excelSync";
import {
  COLUMNS,
  GROUPS,
  PINNED_COLUMNS,
  columnRuns,
  groupSummary,
  type ColumnDef,
  type Ctx,
  type GroupId,
} from "./listColumns";
import {
  activeFilterCount,
  applyFilters,
  clearFilters,
  clientFilters,
  hasFilterParams,
  searchRows,
  serverParams,
  sortRows,
  valueCounts,
} from "./listFilter";

const COLLAPSE_KEY = "unixcrm.v2.listColumns";
const FILTER_KEY = "unixcrm.v2.listFilter";
const HIDDEN_KEY = "unixcrm.v2.listHidden";
const SIZES = [100, 200, 500] as const;

const read = <T,>(k: string, d: T): T => {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : d;
  } catch {
    return d;
  }
};
const write = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* yalnız kolaylık */
  }
};

/** Seçili değer listede yoksa (eski kullanıcı, tanınmayan ülke) kutu boş görünmesin. */
const withCurrent = (options: PickOption[], value: string, label: string): PickOption[] =>
  value && !options.some((o) => o.value === value) ? [{ value, label }, ...options] : options;

/** Düzenlemeden sonra görünüm değişene kadar korunan satır sırası (`frozenRows`). */
interface FrozenView {
  key: string;
  ids: string[];
  extra: ReadonlyMap<string, LeadListDto>;
}

/**
 * Lead listesi (Faz 7g, iş emri §5.4): Excel SATIŞ TAKİP'in karşılığı ve açılış sayfası. Sütun grupları Excel'deki
 * gibi; başlık menüleri otomatik süzgeç gibi; ✔/✘ Excel'in sembolleri. Ulaşım, dönüş, teklif ve takip sütunları temas
 * kayıtlarından türetilir (elle yazılmaz). Hücreye tıklamak o hücrenin düzenlemesini açar: temas sütunlarında ön
 * seçimli "İletişim kaydet", tek değerli alanlarda yerinde seçim, diğerlerinde küçük form (`cellEdit`).
 */
export function LeadListPage({ params }: { params: URLSearchParams }) {
  const { t, lang } = useLang();
  const { user, isAdmin, isViewer, toast } = useCrm();
  const { ref, stageName } = useReference();
  const { team, nameOf } = useTeamNames();
  const errText = useErrorText();
  const now = useNow(60_000);
  const [rows, setRows] = useState<LeadListDto[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [collapsed, setCollapsed] = useState<GroupId[]>(() =>
    read<GroupId[]>(COLLAPSE_KEY, window.innerWidth < 768 ? ["reply", "customer", "proposal", "products", "form"] : []),
  );
  const [hiddenCols, setHiddenCols] = useState<string[]>(() => read<string[]>(HIDDEN_KEY, []));
  const [search, setSearch] = useState(params.get("q") ?? "");
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [frozen, setFrozen] = useState<FrozenView | null>(null);
  const editors = useRef<CellEditorsApi>(null);
  const seq = useRef(0);
  const serverKey = serverParams(params).toString();
  const viewKey = params.toString();
  const view = useRef<{ key: string; shown: LeadListDto[]; serverFiltered: boolean }>({
    key: viewKey,
    shown: [],
    serverFiltered: false,
  });

  // Filtre hatırlama: URL'de süzgeç yoksa ve rapordan gelinmediyse son süzgeç uygulanır.
  useEffect(() => {
    if (hasFilterParams(params)) return;
    const saved = read<string>(FILTER_KEY, "");
    if (saved) setHashParams("list", new URLSearchParams(saved), true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!params.has("from")) {
      const keep = new URLSearchParams(params);
      keep.delete("page");
      write(FILTER_KEY, activeFilterCount(keep) ? keep.toString() : "");
    }
  }, [params]);

  const load = useCallback(() => {
    const n = ++seq.current;
    contactApi
      .leads(new URLSearchParams(serverKey))
      .then((r) => n === seq.current && (setRows(r), setError(null)))
      .catch((e) => n === seq.current && setError(e));
  }, [serverKey]);
  useEffect(load, [load]);
  // Süzgeç, sıralama, arama ya da sayfa değişince satırlar yeniden kurala uyar.
  useEffect(() => setFrozen((f) => (f && f.key !== viewKey ? null : f)), [viewKey]);

  // Hücre düzenlemesi kaydedildi: satırlar yerinde kalır, yanıt hemen işlenir, liste arka planda yenilenir.
  const afterEdit = useCallback(
    (leadId?: string, lead?: LeadDto) => {
      const v = view.current;
      const merge = (row: LeadListDto): LeadListDto => (lead && row.id === lead.id ? { ...row, ...lead } : row);
      setFrozen((f) => {
        const base: FrozenView = f?.key === v.key ? f : { key: v.key, ids: v.shown.map((r) => r.id), extra: new Map() };
        const row = v.serverFiltered && leadId ? v.shown.find((r) => r.id === leadId) : undefined;
        return row ? { ...base, extra: new Map(base.extra).set(row.id, merge(row)) } : base;
      });
      if (lead) setRows((cur) => cur?.map(merge) ?? cur);
      load();
      // Sunucu süzgecinin dışına düşen satır listede gelmez; güncel hâli ayrıca okunur.
      if (leadId && v.serverFiltered) {
        const setExtra = (row: LeadListDto | null) =>
          setFrozen((f) => {
            if (f?.key !== v.key) return f;
            const extra = new Map(f.extra);
            if (row) extra.set(leadId, row);
            else extra.delete(leadId);
            return { ...f, extra };
          });
        pipelineApi
          .get(leadId)
          .then((d) => setExtra(d.lead))
          .catch(() => setExtra(null));
      }
    },
    [load],
  );

  const tz = ref?.timeZone ?? "Europe/Istanbul";
  const fmtDay = useMemo(() => new Intl.DateTimeFormat("en-CA", { timeZone: tz }), [tz]);
  // Bağlam dile göre kurulur: liste arayüz diliyle çizilir, içe aktarılan Excel kendi dışa aktarıldığı dille okunur.
  const ctxFor = useCallback(
    (l: Lang): Ctx => ({
      t: (key, vars) => translate(l, key, vars),
      lang: l,
      day: (iso: string) => fmtDay.format(new Date(iso)),
      nameOf,
      stageName: (c: string) => {
        const s = ref?.stages.find((x) => x.code === c);
        return s ? refName(l, "stage", s) : c;
      },
      countryName: (c: string) => countryName(c, l),
      sourceName: (s: string) => translate(l, `source.${s}`),
      now,
    }),
    [fmtDay, nameOf, ref, now],
  );
  const ctx = useMemo(() => ctxFor(lang), [ctxFor, lang]);

  const set = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") p.delete(k);
      else p.set(k, v);
    }
    p.delete("page");
    setHashParams("list", p, true);
  };
  // Arama kutusu: yazarken 250 ms bekler.
  useEffect(() => {
    const id = setTimeout(() => {
      if ((params.get("q") ?? "") !== search) set({ q: search || null });
    }, 250);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const groups = GROUPS.filter((g) => !g.adminOnly || isAdmin);
  const visibleCols = (g: GroupId) => COLUMNS.filter((c) => c.group === g && !c.hidden);
  // Kullanıcının gizlediği sütunlar çift çizgili dar şerit olarak yerinde kalır (yan yana olanlar tek şerit).
  const runs = (g: GroupId) => columnRuns(visibleCols(g), hiddenCols);
  const nHidden = groups.reduce(
    (n, g) => n + runs(g.id).reduce((m, r) => m + (r.kind === "gap" ? r.cols.length : 0), 0),
    0,
  );
  const changeHidden = (change: (cur: string[]) => string[]) =>
    setHiddenCols((cur) => {
      const next = change(cur);
      write(HIDDEN_KEY, next);
      return next;
    });
  const showCols = (ids: readonly string[]) => changeHidden((cur) => cur.filter((id) => !ids.includes(id)));
  const hideCol = (c: ColumnDef) => {
    changeHidden((cur) => [...cur.filter((id) => id !== c.id), c.id]);
    toast(t("list.colHidden", { name: t(c.label) }), {
      action: { label: t("contact.undo"), run: () => showCols([c.id]) },
    });
  };
  // Şeridin bir hücresine gelince bütün şerit (başlık + satırlar) birlikte vurgulanır. Yeniden çizim yapmadan,
  // doğrudan sınıf ekleyerek: yüzlerce satırlık tabloda fare her geçişte React'i çalıştırmasın.
  const gapHover = (e: MouseEvent<HTMLTableElement>) => {
    const key = (e.target as HTMLElement).closest<HTMLElement>(".ll-gap")?.dataset["gap"];
    if (!key) return;
    for (const el of e.currentTarget.querySelectorAll(`.ll-gap[data-gap="${key}"]`)) {
      el.classList.toggle("hover", e.type === "mouseover");
    }
  };
  const stickyOf = (c: ColumnDef) => {
    const i = PINNED_COLUMNS.indexOf(c.id);
    return i < 0 ? "" : ` sticky s${i}`;
  };
  const filters = clientFilters(params, user?.id ?? null);
  const base = rows ? searchRows(rows, params.get("q")) : [];
  // `live` süzgece uyan satırlar (dışa aktarım bunu kullanır); `shown` ekranda duran satırlar.
  const live = rows ? sortRows(applyFilters(base, filters, ctx), params.get("sort"), ctx) : [];
  const shown = rows && frozen?.key === viewKey ? frozenRows(frozen.ids, rows, frozen.extra) : live;
  view.current = {
    key: viewKey,
    shown,
    serverFiltered: [...new URLSearchParams(serverKey).keys()].some((k) => k !== "limit"),
  };
  const size = Number(params.get("size")) || 200;
  const pages = Math.max(1, Math.ceil(shown.length / size));
  const page = Math.min(pages, Math.max(1, Number(params.get("page")) || 1));
  const pageRows = shown.slice((page - 1) * size, page * size);
  const nFilters = activeFilterCount(params);
  const sort = params.get("sort") || "-createdAt";
  const gapFiltered = (cols: readonly ColumnDef[]) => cols.some((c) => filters.has(c.id));
  const gapLabel = (cols: readonly ColumnDef[]) =>
    t("list.showCols", { names: cols.map((c) => t(c.label)).join(", ") }) +
    (gapFiltered(cols) ? ` (${t("list.filtered")})` : "");

  const toggleGroup = (g: GroupId) => {
    const next = collapsed.includes(g) ? collapsed.filter((x) => x !== g) : [...collapsed, g];
    setCollapsed(next);
    write(COLLAPSE_KEY, next);
  };
  // Excel'e aktar: süzülmüş satırlar, her zaman tam sütun düzeniyle (katlı grup ve gizli sütun dosyayı değiştirmez;
  // içe aktarım bu düzeni birebir arar). Yeşil başlık: içe alınan sütun, gri başlık: programın hesapladığı sütun.
  const exportXlsx = async () => {
    setExporting(true);
    try {
      const editable = EXCEL_COLUMNS.map((c) => isEditable(c.id));
      const data = await buildWorkbook({
        sheetName: t("list.title"),
        header: excelHeader(t),
        editable: [...editable, false],
        rows: live.map((l) => excelRow(l, ctx)),
        snapshot: live.map((l) => excelTexts(l, ctx)),
        rtl: dirOf(lang) === "rtl",
        info: {
          sheetName: t("xl.sheet.info"),
          lines: [
            t("xl.info.exported", {
              date: new Date().toLocaleString(localeOf(lang), {
                dateStyle: "medium",
                timeStyle: "short",
                timeZone: tz,
              }),
            }),
            t("xl.info.editable", {
              names: EXCEL_COLUMNS.filter((_, i) => editable[i])
                .map((c) => t(c.label))
                .join(", "),
            }),
            t("xl.info.readonly"),
            t("xl.info.layout"),
            t("xl.info.id"),
          ],
        },
      });
      downloadBlob(`satis-takip-${fmtDay.format(new Date())}.xlsx`, new Blob([data], { type: XLSX_MIME }));
      toast(t("xl.exported", { n: live.length }));
    } catch {
      toast(t("xl.exportFailed"), { bad: true });
    } finally {
      setExporting(false);
    }
  };
  const who = {
    userId: user?.id ?? null,
    isAdmin,
    isViewer,
    repsEditProducts: !!ref?.permissions?.repsEditProducts,
  };
  const saveLead = async (l: LeadListDto, run: () => Promise<LeadDto>, message: string) => {
    try {
      const saved = await run();
      toast(message);
      afterEdit(l.id, saved);
    } catch (e) {
      toast(errText(e), { bad: true });
    }
  };
  const setStatus = (l: LeadListDto, v: string) =>
    saveLead(
      l,
      () => contactApi.setStatus(l.id, v || null),
      t("customerStatus.saved") + (v === "not_interested" ? ` · ${t("customerStatus.lostHint")}` : ""),
    );
  const take = (l: LeadListDto) => saveLead(l, () => pipelineApi.assign(l.id, { toUserId: user!.id }), t("lead.taken"));
  const runAction = (a: Exclude<CellAction, { kind: "pick" }>, l: LeadListDto) =>
    a.kind === "log"
      ? editors.current?.log({ leadId: l.id, leadName: l.fullName, ...a.preset })
      : editors.current?.form(a.form, l.id);

  const chip = (key: string, value: string, label: string, icon: string) => {
    const on = params.get(key) === value;
    return (
      <button type="button" className="chip hit" aria-pressed={on} onClick={() => set({ [key]: on ? null : value })}>
        <Icon name={icon} size={14} /> {label}
      </button>
    );
  };

  const cell = (c: ColumnDef, l: LeadListDto) => {
    const ch = l.contact.channels;
    const yes = (b: boolean, extra?: string) =>
      b ? (
        <span className="yes">
          <Icon name="check" size={14} /> <span className="sr-only">{t("common.yes")}</span>
          {extra && <span>{extra}</span>}
        </span>
      ) : (
        <span className="no" aria-label={t("common.no")}>
          ✘
        </span>
      );
    const short = (iso: string) =>
      new Date(iso).toLocaleDateString(localeOf(lang), { day: "2-digit", month: "2-digit" });
    const perms = cellPerms(l, who);
    const action = cellAction(c.id, l, perms);
    const column = t(c.label);
    // Temas ve form hücreleri: hücrenin tamamı tıklanır. Eylem yoksa içerik düz metin kalır.
    const editable = (content: ReactNode, state = c.csv(l, ctx) || "—") => {
      if (!action || action.kind === "pick") return content;
      const isLog = action.kind === "log";
      return (
        <button
          type="button"
          className="ll-cell"
          title={t(isLog ? "list.cell.logTip" : "list.cell.editTip", { column })}
          aria-label={
            isLog
              ? t("list.reach.log", { channel: column, state, name: l.fullName })
              : t("list.cell.edit", { column, state, name: l.fullName })
          }
          onClick={() => runAction(action, l)}
        >
          {content}
        </button>
      );
    };
    // Tek değerli hücreler: yerinde seçim.
    const pick = (
      content: ReactNode,
      value: string,
      state: string,
      options: () => PickOption[],
      onPick: (v: string) => unknown,
    ) =>
      action?.kind === "pick" ? (
        <PickCell column={column} leadName={l.fullName} state={state} value={value} options={options} onPick={onPick}>
          {content}
        </PickCell>
      ) : (
        content
      );
    switch (c.id) {
      case "createdAt": {
        const tone = ageTone(l, now);
        return (
          <span className="ll-date">
            {dateText(l.createdAt, false, t, lang)}
            {tone && <span className={"age age-" + tone}> · {daysAgo(l.createdAt, now, lang)}</span>}
          </span>
        );
      }
      case "name":
        return (
          <span className="ll-name">
            <span className="ll-name-top">
              <a
                href={`#/lead/${encodeURIComponent(l.id)}`}
                title={l.fullName}
                onClick={(e) => (e.preventDefault(), navigate("lead", undefined, l.id))}
              >
                {l.fullName}
              </a>
              {l.hot && (
                <span className="hot" title={t("hot.label")}>
                  <Icon name="flame" size={14} />
                  <span className="sr-only">{t("hot.short")}</span>
                </span>
              )}
            </span>
            {perms.canAct && (
              <button
                type="button"
                className="ll-log"
                aria-label={t("contact.logFor", { name: l.fullName })}
                onClick={() => editors.current?.log({ leadId: l.id, leadName: l.fullName })}
              >
                <Icon name="edit" size={14} /> {t("contact.log")}
              </button>
            )}
          </span>
        );
      case "phoneNo": {
        if (!l.phoneE164) return editable("—");
        const num = <span className="num">{phoneText(l.phoneE164)}</span>;
        // Numara seçilip kopyalanabilsin diye hücrenin tamamı değil, yanındaki kalem tıklanır.
        return action?.kind === "form" ? (
          <span className="ll-with-pen">
            {num}
            <button
              type="button"
              className="ll-pen"
              title={t("lead.editContact")}
              aria-label={`${t("lead.editContact")}: ${l.fullName}`}
              onClick={() => runAction(action, l)}
            >
              <Icon name="edit" size={14} />
            </button>
          </span>
        ) : (
          num
        );
      }
      case "excelNo":
        return String(l.extraAnswers?.["excel_no"] ?? "");
      case "country": {
        const text = l.country ? `${countryName(l.country)} (${l.country})` : "—";
        return pick(
          text,
          l.country ?? "",
          text,
          () =>
            withCurrent(
              [
                { value: "", label: "—" },
                ...countryOptions(lang).map(([code, name]) => ({ value: code, label: `${name} (${code})` })),
              ],
              l.country ?? "",
              text,
            ),
          (v) => saveLead(l, () => pipelineApi.update(l.id, { country: v || null }), t("lead.saved")),
        );
      }
      case "owner": {
        const xo = typeof l.extraAnswers?.["excel_owner"] === "string" ? String(l.extraAnswers["excel_owner"]) : "";
        const owner = nameOf(l.assignedUserId);
        return pick(
          l.assignedUserId ? (
            owner
          ) : (
            <span className="ll-pool">
              {t("common.pool")}
              {xo && <small className="muted"> · Excel: {xo}</small>}
              {!isViewer && !isAdmin && (
                <Button size="sm" onClick={() => take(l)}>
                  {t("lead.take")}
                </Button>
              )}
            </span>
          ),
          l.assignedUserId ?? "",
          owner,
          () =>
            withCurrent(
              [{ value: "", label: t("common.pool") }, ...team.map((m) => ({ value: m.id, label: m.name }))],
              l.assignedUserId ?? "",
              owner,
            ),
          (v) => saveLead(l, () => pipelineApi.assign(l.id, { toUserId: v || null }), t("lead.assigned")),
        );
      }
      case "excelOwner":
        return String(l.extraAnswers?.["excel_owner"] ?? "");
      case "source":
        return sourceText(l, t, t(`source.${l.source}`));
      case "phone":
      case "email":
        // Boş hücrede yönetici bilgiyi ekler; doluysa bağlantılar ve hızlı kayıt çubuğu çalışır.
        if (action) return editable("—");
        return (
          <ContactLinks
            compact
            phone={c.id === "phone" ? l.phoneE164 : null}
            email={c.id === "email" ? l.email : null}
            canLog={perms.canAct}
            onQuick={(type, outcome) => editors.current?.quick(l.id, type, outcome)}
            onDetails={(type, outcome) => editors.current?.log({ leadId: l.id, leadName: l.fullName, type, outcome })}
          />
        );
      case "mail":
      case "wa": {
        const k = c.id === "mail" ? "email" : "whatsapp";
        if (!ch[k] && l.contact.state === "legacy") {
          const legacy = t("summary.legacyShort");
          return editable(<span className="muted">{legacy}</span>, legacy);
        }
        const n = ch[k]?.count ?? 0;
        return editable(
          yes(n > 0, n > 1 ? `${n}` : undefined),
          n > 1 ? `${t("common.yes")} (${n})` : t(n ? "common.yes" : "common.no"),
        );
      }
      case "other": {
        const parts = (["call", "meeting", "site_visit", "proposal_sent", "other"] as const)
          .filter((x) => ch[x])
          .map((x) => `${t(`activity.type.${x}`)} ${ch[x]!.count}`);
        // "Diğer kanal" en sık telefondur; Toplantı ve Diğer diyalogda yanında durur.
        return editable(yes(parts.length > 0, parts.join(" · ")), parts.length ? parts.join(" · ") : t("common.no"));
      }
      case "mailReply":
      case "waReply": {
        const f = ch[c.id === "mailReply" ? "email" : "whatsapp"];
        return editable(
          f?.firstReplyAt ? yes(true, `${f.firstReplyEstimated ? "≈ " : ""}${short(f.firstReplyAt)}`) : "—",
        );
      }
      case "otherReply": {
        const r = (["call", "meeting", "site_visit", "proposal_sent", "other"] as const)
          .map((x) => ch[x]?.firstReplyAt)
          .filter((x): x is string => !!x)
          .sort()[0];
        return editable(r ? yes(true, short(r)) : "—");
      }
      case "status":
        return pick(
          <CustomerStatusTag status={l.customerStatus} />,
          l.customerStatus ?? "",
          l.customerStatus ? t(`customerStatus.${l.customerStatus}`) : t("customerStatus.none"),
          () => [
            { value: "", label: t("customerStatus.none") },
            ...(ref?.customerStatuses ?? []).map((s) => ({ value: s.code, label: t(`customerStatus.${s.code}`) })),
          ],
          (v) => setStatus(l, v),
        );
      case "stage":
        return pick(
          <StageTag code={l.currentStage} />,
          l.currentStage,
          stageName(l.currentStage),
          () =>
            [l.currentStage, ...forwardStages(ref?.stages ?? [], l.currentStage)].map((s) => ({
              value: s,
              label: stageName(s),
            })),
          (v) => editors.current?.moveStage(l, v as StageCodeDto),
        );
      case "proposal":
        return editable(l.proposal.given ? yes(true, l.proposal.at ? short(l.proposal.at) : undefined) : yes(false));
      case "standard":
      case "panoramic":
      case "fullPanoramic":
        return editable(l.products[c.id] ? <span className="num">{l.products[c.id]}</span> : "—");
      case "roof": {
        if (!l.products.roof.wanted) return editable("—");
        const a = roofArea(l.products);
        return editable(
          a === null ? (
            <span className="inline-warn">✔ {t("product.roofNoSize")}</span>
          ) : (
            `${l.products.roof.widthM} × ${l.products.roof.lengthM} m · ${a.toLocaleString(localeOf(lang))} m²`
          ),
        );
      }
      case "last":
        return editable(
          l.contact.lastAt ? (
            `${l.contact.lastAtEstimated ? "≈ " : ""}${short(l.contact.lastAt)} · ${daysAgo(l.contact.lastAt, now, lang)}`
          ) : l.contact.state === "legacy" ? (
            <span className="muted">{t("summary.legacyShort")}</span>
          ) : (
            <StatusTag tone="bad" icon="warn">
              {t("list.never")}
            </StatusTag>
          ),
        );
      case "first":
        return editable(
          l.contact.firstAt ? `${l.contact.firstAtEstimated ? "≈ " : ""}${short(l.contact.firstAt)}` : "—",
        );
      case "count":
        return editable(<span className="num">{l.contact.count}</span>);
      case "next":
        if (l.currentStage === "WON" || l.currentStage === "LOST") return "—";
        return editable(
          l.nextActivity ? (
            `${t(`activity.type.${l.nextActivity.type}`)} · ${new Date(l.nextActivity.dueAt).toLocaleString(localeOf(lang), { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}`
          ) : (
            <StatusTag tone="bad" icon="clock">
              {t("activity.rotting")}
            </StatusTag>
          ),
        );
      case "note": {
        const text = l.notes.length > 40 ? l.notes.slice(0, 40) + "…" : l.notes;
        return editable(
          l.notes ? (
            <span className="ll-note" title={l.notes} tabIndex={action ? undefined : 0}>
              {text}
            </span>
          ) : (
            ""
          ),
          text || "—",
        );
      }
      case "warn": {
        const ws = openWarnings(l.warnings);
        return editable(
          ws.length ? (
            <span
              className="inline-warn"
              title={ws.map((w) => warningText(w, t, stageName)).join("\n")}
              tabIndex={action ? undefined : 0}
            >
              <Icon name="warn" size={14} /> {ws.length}
            </span>
          ) : (
            "—"
          ),
        );
      }
      default: {
        const v = c.values?.(l, ctx)[0];
        const text = v && v !== "none" ? (c.valueLabel ? c.valueLabel(v, ctx) : v) : "—";
        const field = ANSWER_COLUMNS[c.id as keyof typeof ANSWER_COLUMNS];
        const answer = field && ANSWER_LIST.find((a) => a.key === field);
        if (!answer) return text;
        return pick(
          text,
          l[field] ?? "",
          text,
          () => [
            { value: "", label: "—" },
            ...(ref?.[answer.ref] ?? [])
              .map((x) => (typeof x === "string" ? x : x.code))
              .map((code) => ({ value: code, label: t(`${answer.prefix}.${code}`) })),
          ],
          (next) =>
            saveLead(l, () => pipelineApi.update(l.id, { [field]: next || null } as UpdateLeadBody), t("lead.saved")),
        );
      }
    }
  };

  const fromReport = params.get("from");
  return (
    <section className="pl-page ll-page" aria-labelledby="ll-h">
      <div className="pl-toolbar ll-toolbar">
        <h1 id="ll-h">
          {t("list.title")} <span className="count">{t("list.count", { n: shown.length })}</span>
        </h1>
        <input
          className="ll-search"
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("list.search")}
          aria-label={t("list.search")}
        />
        <div className="chips" role="group" aria-label={t("list.quick")}>
          {chip("contact", "never", t("list.quick.never"), "warn")}
          {chip("hot", "1", t("hot.short"), "flame")}
          {chip("rotting", "1", t("activity.rotting"), "clock")}
          {isAdmin && chip("warning", "1", t("list.quick.warning"), "warn")}
        </div>
        <details className="menu-dd">
          <summary className="btn btn-sec btn-md">
            <Icon name="columns" size={16} /> {t("list.columns")}
            {nHidden > 0 && (
              <span className="ll-hidden-n" title={t("list.showAllCols", { n: nHidden })}>
                <span className="sr-only">{t("list.hiddenCount", { n: nHidden })}</span>
                <span aria-hidden="true">{nHidden}</span>
              </span>
            )}
          </summary>
          <div className="pop">
            {groups.map((g) => (
              <label key={g.id} className="menu-item">
                <input type="checkbox" checked={!collapsed.includes(g.id)} onChange={() => toggleGroup(g.id)} />{" "}
                {t(g.label)}
              </label>
            ))}
            {nHidden > 0 && (
              <button type="button" className="menu-item ll-show-all" onClick={() => changeHidden(() => [])}>
                <Icon name="eye" size={14} /> {t("list.showAllCols", { n: nHidden })}
              </button>
            )}
          </div>
        </details>
        {/* Dışa aktarım satışçıya da açık (gördüğü lead'ler iner); içe aktarım yalnız yöneticide. */}
        {!isViewer && (
          <Button icon="download" onClick={() => void exportXlsx()} disabled={!live.length} loading={exporting}>
            {t("list.export")}
          </Button>
        )}
        {isAdmin && (
          <>
            <Button icon="upload" onClick={() => setImporting(true)} disabled={!ref}>
              {t("list.import")}
            </Button>
            <label className="cd-check">
              <input
                type="checkbox"
                checked={params.get("includeTest") === "1"}
                onChange={(e) => set({ includeTest: e.target.checked ? "1" : null })}
              />
              {t("inbox.includeTest")}
            </label>
            <SheetSyncBadge now={now} onSynced={load} />
          </>
        )}
        {nFilters > 0 && (
          <span className="ll-active">
            {t("list.activeFilters", { n: nFilters })} ·{" "}
            <button
              type="button"
              className="link-btn"
              onClick={() => (setSearch(""), setHashParams("list", clearFilters(params), true))}
            >
              {t("board.filter.clear")}
            </button>
          </span>
        )}
      </div>
      {fromReport && (
        <div className="ll-from" role="note">
          <Icon name={fromReport === "today" ? "calendar" : "chart"} size={16} />
          <span>
            {fromReport === "today" ? t("list.fromToday") : t("list.fromReport")}
            {params.get("fromLabel") ? `: ${params.get("fromLabel")}` : ""} · {t("list.count", { n: shown.length })}
          </span>
          <a className="btn btn-sec btn-sm" href={fromReport === "today" ? "#/activities" : "#/reports?tab=summary"}>
            {fromReport === "today" ? t("list.backToday") : t("list.backReport")}
          </a>
        </div>
      )}
      {rows && rows.length >= 2000 && <p className="muted">{t("list.capped")}</p>}

      {error ? (
        <Empty title={t("list.loadError")}>
          <Button icon="refresh" onClick={load}>
            {t("common.retry")}
          </Button>
        </Empty>
      ) : !rows ? (
        <div className="ll-skel" aria-busy="true" aria-label={t("common.loading")}>
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} h={44} />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <Empty title={t("list.empty")}>
          <Button onClick={() => (setSearch(""), setHashParams("list", clearFilters(params), true))}>
            {t("board.filter.clear")}
          </Button>
        </Empty>
      ) : (
        <>
          {pages > 1 || shown.length > 100 ? (
            <div className="ll-pager">
              <label>
                {t("list.pageSize")}{" "}
                <select value={size} onChange={(e) => set({ size: e.target.value })}>
                  {SIZES.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
              {pages > 1 && (
                <span>
                  <Button size="sm" disabled={page <= 1} onClick={() => set({ page: String(page - 1) })}>
                    ‹
                  </Button>{" "}
                  {t("list.page", { p: page, n: pages })}{" "}
                  <Button size="sm" disabled={page >= pages} onClick={() => set({ page: String(page + 1) })}>
                    ›
                  </Button>
                </span>
              )}
            </div>
          ) : null}
          <div className="ll-wrap" tabIndex={0} role="region" aria-label={t("list.title")}>
            <table className="ll" onMouseOver={gapHover} onMouseOut={gapHover}>
              <caption className="sr-only">{t("list.caption", { n: shown.length })}</caption>
              {groups.map((g) => (
                <colgroup key={g.id} span={collapsed.includes(g.id) ? 1 : runs(g.id).length} className={`cg-${g.id}`} />
              ))}
              <thead>
                <tr className="ll-groups">
                  {groups.map((g) => (
                    <th
                      key={g.id}
                      scope="colgroup"
                      colSpan={collapsed.includes(g.id) ? 1 : runs(g.id).length}
                      className={`g-${g.id}`}
                    >
                      <button
                        type="button"
                        className="g-btn"
                        aria-expanded={!collapsed.includes(g.id)}
                        onClick={() => toggleGroup(g.id)}
                      >
                        <Icon name="chevron" size={12} className={collapsed.includes(g.id) ? "rot" : ""} /> {t(g.label)}
                      </button>
                    </th>
                  ))}
                </tr>
                <tr className="ll-cols">
                  {groups.map((g) =>
                    collapsed.includes(g.id) ? (
                      <th key={g.id} scope="col" className={`g-${g.id}`}>
                        <span className="muted">{t("list.summary")}</span>
                      </th>
                    ) : (
                      runs(g.id).map((r) => {
                        if (r.kind === "gap") {
                          const label = gapLabel(r.cols);
                          return (
                            <th
                              key={`gap-${r.cols[0]!.id}`}
                              scope="col"
                              className={`g-${g.id} ll-gap`}
                              data-gap={r.cols[0]!.id}
                            >
                              <button
                                type="button"
                                className="ll-gap-btn"
                                aria-label={label}
                                title={label}
                                onClick={() => showCols(r.cols.map((c) => c.id))}
                              >
                                <span className="ll-gap-knob">
                                  <Icon name="expand" size={12} />
                                  {gapFiltered(r.cols) && <span className="th-dot" aria-hidden="true" />}
                                </span>
                                {r.cols.length > 1 && (
                                  <span className="ll-gap-n" aria-hidden="true">
                                    {r.cols.length}
                                  </span>
                                )}
                              </button>
                            </th>
                          );
                        }
                        const c = r.col;
                        const dir = sort === c.id ? "asc" : sort === `-${c.id}` ? "desc" : null;
                        const f = filters.get(c.id);
                        const others = applyFilters(base, filters, ctx, c.id);
                        return (
                          <th
                            key={c.id}
                            scope="col"
                            aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : undefined}
                            className={`g-${g.id}` + stickyOf(c)}
                          >
                            <span className="th-in">
                              <span>{t(c.label)}</span>
                              <ColumnFilterPopover
                                col={c}
                                label={t(c.label)}
                                counts={c.kind === "values" ? valueCounts(others, c, ctx) : []}
                                selected={f?.values}
                                text={f?.text}
                                sort={dir}
                                onSort={(d) => set({ sort: d === "asc" ? c.id : `-${c.id}` })}
                                {...(PINNED_COLUMNS.includes(c.id) ? {} : { onHide: () => hideCol(c) })}
                                onApply={(v) =>
                                  set({
                                    [c.param]:
                                      v.text !== undefined
                                        ? v.text
                                        : v.values === null || v.values === undefined
                                          ? null
                                          : v.values.join(","),
                                  })
                                }
                              />
                            </span>
                          </th>
                        );
                      })
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {pageRows.map((l) => (
                  <tr key={l.id}>
                    {groups.map((g) =>
                      collapsed.includes(g.id) ? (
                        <td key={g.id} className={`g-${g.id}`}>
                          {groupSummary(g.id, l, ctx) || (g.id === "lead" ? l.fullName : "")}
                        </td>
                      ) : (
                        <Fragment key={g.id}>
                          {runs(g.id).map((r) =>
                            r.kind === "gap" ? (
                              <td
                                key={`gap-${r.cols[0]!.id}`}
                                className={`g-${g.id} ll-gap`}
                                data-gap={r.cols[0]!.id}
                                title={gapLabel(r.cols)}
                                onClick={() => showCols(r.cols.map((c) => c.id))}
                              />
                            ) : (
                              <td key={r.col.id} className={`g-${g.id} c-${r.col.id}` + stickyOf(r.col)}>
                                {cell(r.col, l)}
                              </td>
                            ),
                          )}
                        </Fragment>
                      ),
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <CellEditors ref={editors} onChanged={afterEdit} />
      {importing && ref && (
        <ExcelImportDialog
          ctxFor={ctxFor}
          owners={team}
          refData={{
            customerStatuses: ref.customerStatuses.map((s) => s.code),
            installSites: ref.installSites,
            installTimelines: ref.installTimelines.map((x) => x.code),
            customerProfiles: ref.customerProfiles,
            courtCountBands: ref.courtCountBands,
            productQtyMax: ref.productQtyMax,
          }}
          onClose={() => setImporting(false)}
          onApplied={load}
        />
      )}
    </section>
  );
}
