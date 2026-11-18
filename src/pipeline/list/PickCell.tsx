import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useLang } from "../../i18n";

export interface PickOption {
  value: string;
  label: string;
}

/**
 * Tek değerli hücre: tıklanınca yerinde yerel `<select>` açılır, seçince kaydeder. Kutu yalnız açık hücrede vardır
 * (yüzlerce satırda DOM şişmez) ve durum burada kalır (tablo yeniden çizilmez). Yerel liste tablo kenarında kesilmez;
 * klavye, dokunmatik ve sağdan sola tarayıcıdan gelir. `showPicker` yoksa kutu odaklı kalır, kullanıcı açar.
 */
export function PickCell({
  column,
  leadName,
  state,
  value,
  options,
  onPick,
  children,
}: {
  column: string;
  leadName: string;
  /** Şu anki değerin okunur hâli. */
  state: string;
  value: string;
  /** Yalnız açılınca hesaplanır (ülke listesi uzun). */
  options: () => PickOption[];
  onPick: (value: string) => unknown;
  children: ReactNode;
}) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const select = useRef<HTMLSelectElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);

  useLayoutEffect(() => {
    if (open) {
      select.current?.focus();
      try {
        select.current?.showPicker();
      } catch {
        /* desteklemeyen tarayıcıda kutu odaklı kalır */
      }
    } else if (refocus.current) {
      refocus.current = false;
      button.current?.focus();
    }
  }, [open]);

  // Dışarı tıklama: odak kaybı her zaman gelmez (pencere odakta değilken ya da yerel liste kapanırken).
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (e.target !== select.current) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  const close = (focusBack: boolean) => {
    refocus.current = focusBack;
    setOpen(false);
  };

  // Kutu hücrenin üstüne biner, içerik yerinde kalır: sütun genişliği değişmez, büyük tablo yeniden dizilmez.
  return (
    <>
      <button
        ref={button}
        type="button"
        className="ll-cell"
        tabIndex={open ? -1 : undefined}
        title={t("list.cell.editTip", { column })}
        aria-label={t("list.cell.edit", { column, state, name: leadName })}
        aria-haspopup="listbox"
        aria-busy={busy || undefined}
        onClick={() => !busy && setOpen(true)}
      >
        {children}
      </button>
      {open && (
        <select
          ref={select}
          className="ll-pick"
          aria-label={`${column}: ${leadName}`}
          value={value}
          onBlur={() => close(false)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              close(true);
            }
          }}
          onChange={(e) => {
            const next = e.target.value;
            close(true);
            setBusy(true);
            void Promise.resolve(onPick(next)).finally(() => setBusy(false));
          }}
        >
          {options().map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </>
  );
}
