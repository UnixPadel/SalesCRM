import { useEffect, useId, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import type { Currency } from "../domain/types";

/* ---------------- formatting ---------------- */

const SYMBOL: Record<Currency, string> = { EUR: "€", USD: "$", GBP: "£", TRY: "₺" };
export function money(v: number, cur: Currency = "EUR", compact = false) {
  if (compact && Math.abs(v) >= 1000) {
    const [n, unit] = Math.abs(v) >= 1e6 ? [v / 1e6, "M"] : [v / 1e3, "K"];
    const s = n >= 100 ? String(Math.round(n)) : n.toFixed(1).replace(/\.0$/, "").replace(".", ",");
    return `${SYMBOL[cur]}${s}${unit}`;
  }
  return `${SYMBOL[cur]}${Math.round(v).toLocaleString("tr-TR")}`;
}
export const eur = (v: number, compact = false) => money(v, "EUR", compact);

const parse = (iso: string) => new Date(iso.length === 10 ? iso + "T00:00:00" : iso);
export function fmtDate(iso: string | null | undefined, withTime = false) {
  if (!iso) return "—";
  const d = parse(iso);
  const date = d.toLocaleDateString("tr-TR", { day: "numeric", month: "short", year: "numeric" });
  if (!withTime || iso.length === 10) return date;
  return `${date}, ${fmtTime(iso)}`;
}
export function fmtTime(iso: string) {
  return parse(iso).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
}
/** Calendar-day distance in local time ("bugün", "yarın", "3 gün önce"). */
export function relDays(iso: string) {
  const d = parse(iso);
  const a = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const n = new Date();
  const b = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
  const diff = Math.round((a - b) / 86_400_000);
  if (diff === 0) return "bugün";
  if (diff === 1) return "yarın";
  if (diff === -1) return "dün";
  return diff > 0 ? `${diff} gün sonra` : `${-diff} gün önce`;
}

/* ---------------- icons ---------------- */

const PATHS: Record<string, string> = {
  pipeline: "M3 4h4v16H3zM10 4h4v11h-4zM17 4h4v7h-4z",
  inbox: "M3 13l3-8h12l3 8v6H3zM3 13h5l1 3h6l1-3h5",
  calendar: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4",
  chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-4 4-6 8-6s8 2 8 6",
  building: "M4 21V5l8-3v19M12 9h8v12M7 8h2M7 12h2M7 16h2M15 13h2M15 17h2M2 21h20",
  phone: "M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2",
  mail: "M3 6h18v12H3zM3 7l9 6 9-6",
  users:
    "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2 20c0-3.5 3-5.5 7-5.5s7 2 7 5.5M16 4a3.5 3.5 0 0 1 0 7M18 14.5c2.4.6 4 2.4 4 5.5",
  file: "M6 2h8l5 5v15H6zM14 2v5h5M9 13h7M9 17h7",
  pin: "M12 22s7-7.5 7-13a7 7 0 0 0-14 0c0 5.5 7 13 7 13zM12 11.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5",
  search: "M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15zM16 16l5 5",
  plus: "M12 5v14M5 12h14",
  x: "M6 6l12 12M18 6L6 18",
  warn: "M12 3l10 18H2zM12 10v5M12 18h.01",
  check: "M5 12.5l4.5 4.5L19 7",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2",
  alarm: "M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM12 9v4l2.5 1.5M3 5l3-2M21 5l-3-2",
  sun: "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4",
  moon: "M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z",
  auto: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 3v18M12 7l4.5-2M12 12h9M12 17l4.5 2",
  trophy: "M7 4h10v5a5 5 0 0 1-10 0zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4M12 14v4M8 21h8M9 18h6",
  ban: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM5.6 5.6l12.8 12.8",
  arrow: "M5 12h14M13 6l6 6-6 6",
  arrowL: "M19 12H5M11 6l-6 6 6 6",
  arrowIn: "M19 5L5 19M5 9v10h10",
  arrowOut: "M5 19L19 5M9 5h10v10",
  chevron: "M6 9l6 6 6-6",
  move: "M5 9l-3 3 3 3M19 9l3 3-3 3M2 12h20",
  edit: "M4 20h4L19 9l-4-4L4 16zM14 6l4 4",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
  reset: "M4 4v6h6M20 20v-6h-6M5 15a8 8 0 0 0 14 2M19 9A8 8 0 0 0 5 7",
  refresh: "M20 11A8 8 0 0 0 6 6L4 8M4 4v4h4M4 13a8 8 0 0 0 14 5l2-2M20 20v-4h-4",
  globe: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18",
  flame: "M12 22c4 0 7-3 7-7 0-4-3-6-4-10-2 2-3 4-3 6-1-1-2-2-2-4-2 2-5 5-5 8 0 4 3 7 7 7z",
  filter: "M3 5h18l-7 8v6l-4 2v-8z",
  note: "M5 3h14v18H5zM9 8h6M9 12h6M9 16h4",
  lock: "M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4",
  logout: "M10 4H4v16h6M15 8l5 4-5 4M9 12h11",
  hand: "M8 13V5a1.5 1.5 0 0 1 3 0v6M11 11V4a1.5 1.5 0 0 1 3 0v7M14 11V5.5a1.5 1.5 0 0 1 3 0V13M17 13V9.5a1.5 1.5 0 0 1 3 0V15a7 7 0 0 1-7 7h-1a7 7 0 0 1-6-3.5L3 13a1.5 1.5 0 0 1 2.6-1.5L8 14",
  tag: "M3 12V3h9l9 9-9 9zM7.5 7.5h.01",
  paperclip: "M21 11.5l-8.5 8.5a5 5 0 0 1-7-7l9-9a3.5 3.5 0 0 1 5 5l-9 9a2 2 0 0 1-3-3l8-8",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6",
  eyeOff:
    "M3 3l18 18M10.5 10.6A3 3 0 0 0 13.4 13.5M7.5 7.7C4.5 9.3 2 12 2 12s4 7 10 7c1.8 0 3.4-.5 4.8-1.2M10 5.2C10.6 5.1 11.3 5 12 5c6 0 10 7 10 7s-1 1.8-2.9 3.6",
  money: "M3 7h18v10H3zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6M6 10h.01M18 14h.01",
  court: "M3 5h18v14H3zM12 5v14M3 12h18",
  route: "M5 18h6a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6M5 18a2 2 0 1 0-.01 0M19 6a2 2 0 1 0-.01 0",
  columns: "M3 4h5v16H3zM9.5 4h5v16h-5zM16 4h5v16h-5z",
};
export function Icon({ name, size = 16, className }: { name: string; size?: number; className?: string }) {
  return (
    <svg
      className={"ic " + (className ?? "")}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name] ?? PATHS.file} />
    </svg>
  );
}

/* ---------------- button ---------------- */

type Variant = "pri" | "sec" | "ghost" | "danger" | "won";
export function Button({
  variant = "sec",
  size = "md",
  loading,
  icon,
  children,
  className,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  icon?: string;
}) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`btn btn-${variant} btn-${size}` + (className ? " " + className : "")}
    >
      {loading ? <span className="spinner" aria-hidden="true" /> : icon ? <Icon name={icon} /> : null}
      {children}
    </button>
  );
}

export function IconButton({
  icon,
  label,
  size = "md",
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon: string; label: string; size?: "sm" | "md" }) {
  return (
    <button
      type="button"
      {...rest}
      aria-label={label}
      title={label}
      className={`icon-btn icon-${size} ${className ?? ""}`}
    >
      <Icon name={icon} size={size === "sm" ? 16 : 18} />
    </button>
  );
}

/* ---------------- avatar ---------------- */

const HUES = [190, 150, 28, 262, 340, 210, 95, 12];
/** Stable hue for a person's name; shared by avatars and the line map so a rep's colour matches everywhere. */
export const hueOf = (name: string) => HUES[[...(name || "?")].reduce((a, c) => a + c.charCodeAt(0), 0) % HUES.length];
export function Avatar({ name, size = 24, label = true }: { name: string; size?: number; label?: boolean }) {
  const n = name || "?";
  const hue = hueOf(n);
  const initials = n
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toLocaleUpperCase("tr");
  return (
    <span
      className="avatar"
      role={label ? "img" : undefined}
      aria-label={label ? n : undefined}
      aria-hidden={label ? undefined : true}
      title={n}
      style={{ width: size, height: size, fontSize: Math.max(10, size * 0.42), ["--h" as string]: hue }}
    >
      {initials}
    </span>
  );
}

/* ---------------- status tag: icon + text, never colour alone ---------------- */

export type Tone = "bad" | "warn" | "ok" | "info" | "neutral";
export function StatusTag({
  tone,
  icon,
  children,
  title,
}: {
  tone: Tone;
  icon: string;
  children: ReactNode;
  title?: string;
}) {
  return (
    <span className={"status status-" + tone} title={title}>
      <Icon name={icon} size={14} />
      <span>{children}</span>
    </span>
  );
}

/* ---------------- modal: native <dialog> (focus trap + inert background) ---------------- */

export function Modal({
  title,
  onClose,
  children,
  footer,
  width = 520,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const dlg = ref.current!;
    const opener = document.activeElement as HTMLElement | null;
    if (!dlg.open) dlg.showModal();
    // Focus the first form control rather than the close button.
    const first = dlg.querySelector<HTMLElement>(".modal-body input, .modal-body select, .modal-body textarea");
    first?.focus();
    return () => {
      if (dlg.open) dlg.close();
      opener?.focus?.();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby={titleId}
      style={{ inlineSize: `min(${width}px, calc(100vw - 32px))` }}
      onCancel={(e) => {
        e.preventDefault();
        closeRef.current();
      }}
      onMouseDown={(e) => e.target === e.currentTarget && closeRef.current()}
    >
      <div className="modal-inner">
        <header className="modal-head">
          <h2 id={titleId}>{title}</h2>
          <IconButton icon="x" label="Kapat" onClick={onClose} />
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </dialog>
  );
}

/* ---------------- form field: label above, inline error below ---------------- */

export function Field({
  label,
  children,
  hint,
  error,
  errorId,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  error?: string;
  errorId?: string;
}) {
  return (
    <label className={"field" + (error ? " has-error" : "")}>
      <span className="field-l">{label}</span>
      {children}
      {error ? (
        <span className="field-err" id={errorId} role="alert">
          <Icon name="warn" size={14} /> {error}
        </span>
      ) : (
        hint && <span className="field-h">{hint}</span>
      )}
    </label>
  );
}

/* ---------------- empty / skeleton ---------------- */

export function Empty({ title, children, tone }: { title: string; children?: ReactNode; tone?: "ok" }) {
  return (
    <div className={"empty" + (tone ? " empty-" + tone : "")}>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
    </div>
  );
}

export function Skeleton({ h = 16, w = "100%" }: { h?: number; w?: number | string }) {
  return <span className="skel" style={{ blockSize: h, inlineSize: w }} aria-hidden="true" />;
}

/* ---------------- zone: a collapsible, colour-coded region of a page/drawer ---------------- */

export type ZoneTone = "slate" | "green" | "blue" | "amber" | "red";
/**
 * Each zone has its own tone (left bar + icon chip + tinted header) so neighbouring
 * regions read as different things at a glance. Built on <details>, so it collapses natively.
 */
export function Zone({
  tone,
  icon,
  title,
  count,
  meta,
  extra,
  defaultOpen = true,
  id,
  children,
}: {
  tone: ZoneTone;
  icon: string;
  title: string;
  count?: number;
  meta?: ReactNode;
  /** Controls rendered inside the header (they stop the click from toggling the zone). */
  extra?: ReactNode;
  defaultOpen?: boolean;
  id?: string;
  children: ReactNode;
}) {
  return (
    <details className="zone" data-tone={tone} open={defaultOpen} id={id}>
      <summary className="zone-h">
        <span className="zone-ic" aria-hidden="true">
          <Icon name={icon} size={18} />
        </span>
        <span className="zone-t">
          {title}
          {count != null && <span className="count">{count}</span>}
        </span>
        {meta && <span className="zone-m">{meta}</span>}
        {extra && (
          <span className="zone-x" onClick={(e) => e.preventDefault()}>
            {extra}
          </span>
        )}
        <Icon name="chevron" size={16} className="zone-chev" />
      </summary>
      <div className="zone-b">{children}</div>
    </details>
  );
}
