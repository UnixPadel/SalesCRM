import { useEffect, useId, useRef, useState } from "react";
import { Button, Icon } from "../../components/ui";
import { useLang } from "../../i18n";
import type { ColumnDef } from "./listColumns";
import type { ValueCount } from "./listFilter";

/**
 * Excel otomatik süzgeci gibi başlık menüsü (iş emri §5.4, [U-I11]): sırala, sayılı değer listesi ("✔ Evet (91)"),
 * 8'den çok değerde arama, Uygula / Temizle. Modal olmayan `<dialog>`; Esc ve dış tıklama kapatır, odak düğmeye döner.
 * Odaklı başlıkta Alt+↓ açar.
 */
export function ColumnFilterPopover({
  col,
  label,
  counts,
  selected,
  text,
  sort,
  onApply,
  onSort,
}: {
  col: ColumnDef;
  label: string;
  counts: ValueCount[];
  selected: ReadonlySet<string> | undefined;
  text: string | undefined;
  sort: "asc" | "desc" | null;
  onApply: (v: { values?: string[] | null; text?: string | null }) => void;
  onSort: (dir: "asc" | "desc") => void;
}) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const dlg = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [draftText, setDraftText] = useState("");
  const filtered = selected !== undefined || (text !== undefined && text !== "");

  const show = () => {
    setPicked(new Set(selected ?? counts.map((c) => c.value)));
    setDraftText(text ?? "");
    setQuery("");
    setOpen(true);
  };
  const close = () => {
    setOpen(false);
    btn.current?.focus();
  };
  useEffect(() => {
    const d = dlg.current;
    if (!d) return;
    if (open && !d.open) {
      d.show();
      d.querySelector<HTMLElement>("input, button")?.focus();
    }
    if (!open && d.open) d.close();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!dlg.current?.contains(e.target as Node) && e.target !== btn.current) close();
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && (e.preventDefault(), close());
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const visible = counts.filter(
    (c) => !query || c.label.toLocaleLowerCase("tr").includes(query.toLocaleLowerCase("tr")),
  );
  const all = counts.length > 0 && counts.every((c) => picked.has(c.value));
  const apply = () => {
    if (col.kind === "text") onApply({ text: draftText.trim() || null });
    else onApply({ values: all || picked.size === 0 ? null : [...picked] });
    close();
  };

  return (
    <span className="th-f">
      <button
        ref={btn}
        type="button"
        className={"th-btn" + (filtered ? " on" : "")}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${label}: ${t("list.filterMenu")}${filtered ? ` (${t("list.filtered")})` : ""}`}
        onClick={() => (open ? close() : show())}
        onKeyDown={(e) => {
          if (e.altKey && e.key === "ArrowDown") {
            e.preventDefault();
            show();
          }
        }}
      >
        <Icon name="chevron" size={14} />
        {filtered && <span className="th-dot" aria-hidden="true" />}
      </button>
      <dialog ref={dlg} className="th-pop" aria-labelledby={titleId}>
        <p className="sr-only" id={titleId}>
          {label}
        </p>
        <div className="th-sort">
          <button
            type="button"
            className={"menu-item" + (sort === "asc" ? " on" : "")}
            onClick={() => (onSort("asc"), close())}
          >
            {t("list.sortAsc")}
          </button>
          <button
            type="button"
            className={"menu-item" + (sort === "desc" ? " on" : "")}
            onClick={() => (onSort("desc"), close())}
          >
            {t("list.sortDesc")}
          </button>
        </div>
        {col.kind === "text" ? (
          <label className="field">
            <span className="field-l">{t("list.contains")}</span>
            <input
              value={draftText}
              onChange={(e) => setDraftText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && apply()}
            />
          </label>
        ) : (
          <>
            {counts.length > 8 && (
              <input
                className="th-search"
                type="search"
                aria-label={t("common.search")}
                placeholder={t("common.search")}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            )}
            <label className="th-opt th-all">
              <input
                type="checkbox"
                checked={all}
                onChange={(e) => setPicked(new Set(e.target.checked ? counts.map((c) => c.value) : []))}
              />
              {t("list.selectAll")}
            </label>
            <div className="th-list">
              {visible.map((c) => (
                <label key={c.value} className="th-opt">
                  <input
                    type="checkbox"
                    checked={picked.has(c.value)}
                    onChange={(e) => {
                      const n = new Set(picked);
                      if (e.target.checked) n.add(c.value);
                      else n.delete(c.value);
                      setPicked(n);
                    }}
                  />
                  <span>{c.label}</span>
                  <span className="th-n">({c.count})</span>
                </label>
              ))}
            </div>
          </>
        )}
        <div className="th-acts">
          <Button
            size="sm"
            onClick={() => {
              onApply(col.kind === "text" ? { text: null } : { values: null });
              close();
            }}
          >
            {t("list.clear")}
          </Button>
          <Button size="sm" variant="pri" onClick={apply}>
            {t("list.apply")}
          </Button>
        </div>
      </dialog>
    </span>
  );
}
