import { useEffect, useId, useRef, useState } from "react";
import { LANGS, useLang, type Lang } from "../i18n";
import { Icon } from "./ui";

/**
 * Dil seçici. Düğme seçili dili gösterir ("Dil: Türkçe" / "Language: English" / "اللغة: العربية"); fareyle
 * üstüne gelince ya da tıklayınca yanında (satır başı tarafında: soldan sağa dillerde solda) dil listesi açılır.
 * Dil adları kendi dilinde yazılır. Klavye: Enter/Boşluk/ok açar, ↑↓ gezer, Esc yalnız listeyi kapatır.
 */
export function LangMenu({ variant = "menu" }: { variant?: "menu" | "standalone" }) {
  const { t, lang, setLang } = useLang();
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const open = hover || pinned;
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const focusOnOpen = useRef(false);
  const leaveTimer = useRef<number | undefined>(undefined);
  const listId = useId();
  const current = LANGS.find((l) => l.code === lang)!;

  const items = () => [...(wrap.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])];
  const close = () => {
    setHover(false);
    setPinned(false);
  };

  useEffect(() => {
    if (!open) return;
    if (focusOnOpen.current) {
      focusOnOpen.current = false;
      (items().find((el) => el.getAttribute("aria-checked") === "true") ?? items()[0])?.focus();
    }
    const away = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) close();
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);
  useEffect(() => () => window.clearTimeout(leaveTimer.current), []);

  const choose = (l: Lang) => {
    setLang(l);
    close();
    btn.current?.focus();
  };

  return (
    <div
      ref={wrap}
      className={"langmenu langmenu-" + variant + (open ? " open" : "")}
      onPointerEnter={(e) => {
        if (e.pointerType !== "mouse") return;
        window.clearTimeout(leaveTimer.current);
        setHover(true);
      }}
      onPointerLeave={(e) => {
        if (e.pointerType !== "mouse") return;
        leaveTimer.current = window.setTimeout(() => setHover(false), 160);
      }}
      onKeyDown={(e) => {
        if (e.key !== "Escape" || !open) return;
        // Yalnız dil listesi kapanır; kullanıcı menüsü açık kalır.
        e.stopPropagation();
        e.nativeEvent.stopImmediatePropagation();
        close();
        btn.current?.focus();
      }}
    >
      <button
        ref={btn}
        type="button"
        className="menu-item langmenu-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={listId}
        onClick={(e) => {
          // Klavyeyle (Enter/Boşluk) açılınca odak listeye geçer; fare tıklamasında düğmede kalır.
          if (e.detail === 0 && !pinned) focusOnOpen.current = true;
          setPinned((p) => !p);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "ArrowLeft" || e.key === "ArrowRight") {
            e.preventDefault();
            if (open) items()[0]?.focus();
            else {
              focusOnOpen.current = true;
              setPinned(true);
            }
          }
        }}
      >
        <Icon name="globe" />
        <span className="langmenu-label">{t("lang.label", { name: current.name })}</span>
        <Icon name="chevron" size={14} />
      </button>
      {open && (
        <div className="langmenu-pop">
          <ul className="langmenu-list" id={listId} role="menu" aria-label={t("lang.choose")}>
            {LANGS.map((l, i) => (
              <li key={l.code} role="none">
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={l.code === lang}
                  className="menu-item"
                  lang={l.code}
                  onClick={() => choose(l.code)}
                  onKeyDown={(e) => {
                    const all = items();
                    const go = (n: number) => {
                      e.preventDefault();
                      all[(n + all.length) % all.length]?.focus();
                    };
                    if (e.key === "ArrowDown") go(i + 1);
                    else if (e.key === "ArrowUp") go(i - 1);
                    else if (e.key === "Home") go(0);
                    else if (e.key === "End") go(all.length - 1);
                    else if (e.key === "Tab") close();
                  }}
                >
                  <span className="langmenu-check" aria-hidden="true">
                    {l.code === lang && <Icon name="check" size={16} />}
                  </span>
                  {l.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
