import { useEffect, useId, useRef, useState } from "react";
import { countryName } from "../domain/constants";
import { useLang, type Lang } from "../i18n";
import { navigate, type Route } from "../router";
import { NotificationsBell } from "../pipeline/NotificationsBell";
import { pipelineApi } from "../pipeline/api";
import { useReference, useTodayCount } from "../pipeline/hooks";
import { useCrm, type Theme } from "../state/CrmContext";
import { Avatar, Button, Icon } from "./ui";

const THEMES: { key: Theme; icon: string; label: string }[] = [
  { key: "auto", icon: "auto", label: "Tema: sistem" },
  { key: "light", icon: "sun", label: "Tema: açık" },
  { key: "dark", icon: "moon", label: "Tema: koyu" },
];

interface Opt {
  id: string;
  group: string;
  icon: string;
  title: string;
  meta: string;
  go: () => void;
}

export function Header({ route, onNewLead }: { route: Route; onNewLead: () => void }) {
  const { user, isAdmin, isViewer, theme, setTheme, logout } = useCrm();
  const { t, lang, setLang } = useLang();

  // Faz 6a: "Bugün" rozeti yeni aktivite ucundan (gecikmiş + bugün).
  const dueCount = useTodayCount();

  // Bütün sayfalar yeni pipeline'dan (Faz 6d'den itibaren).
  const NAV: { r: Route; icon: string; label: string; badge?: number; badgeLabel?: string; bad?: boolean }[] = [
    { r: "list", icon: "list", label: t("nav.list") },
    { r: "pipeline", icon: "columns", label: t("nav.board") },
    {
      r: "activities",
      icon: "calendar",
      label: t("nav.today"),
      badge: dueCount,
      badgeLabel: `${dueCount} gecikmiş veya bugünkü aktivite`,
      bad: true,
    },
    { r: "contacts", icon: "user", label: t("nav.contacts") },
    { r: "reports", icon: "chart", label: t("nav.reports") },
    // Yönetim paneli (Faz 7): yalnız yöneticiye görünür.
    ...(isAdmin ? [{ r: "admin" as const, icon: "lock", label: t("nav.admin") }] : []),
  ];

  return (
    <header className="hdr">
      <a className="wordmark" href="#/list" aria-label="Unixpadel satış panosu, ana sayfa">
        <b>unixpadel</b>
        <span>satış panosu</span>
      </a>
      <nav className="nav" aria-label="Ana menü">
        {NAV.map((n) => (
          <a
            key={n.r}
            href={`#/${n.r}`}
            className="nav-link"
            aria-current={route === n.r || (n.r === "list" && route === "lead") ? "page" : undefined}
            aria-label={n.badge ? `${n.label}, ${n.badgeLabel}` : n.label}
          >
            <Icon name={n.icon} size={18} />
            <span className="lbl" aria-hidden="true">
              {n.label}
            </span>
            {n.badge ? (
              <b className={"nav-badge" + (n.bad ? " bad" : "")} aria-hidden="true">
                {n.badge > 99 ? "99+" : n.badge}
              </b>
            ) : null}
          </a>
        ))}
      </nav>

      <div className="hdr-end">
        <GlobalSearch />
        {!isViewer && (
          <Button variant="pri" icon="plus" onClick={onNewLead}>
            {t("nav.newLead")}
          </Button>
        )}
        <NotificationsBell />
        <UserMenu
          name={user?.name ?? ""}
          email={user?.email ?? ""}
          isAdmin={isAdmin}
          isViewer={isViewer}
          theme={theme}
          onTheme={setTheme}
          lang={lang}
          onLang={setLang}
          onLogout={logout}
        />
      </div>
    </header>
  );
}

function UserMenu({
  name,
  email,
  isAdmin,
  isViewer,
  theme,
  onTheme,
  lang,
  onLang,
  onLogout,
}: {
  name: string;
  email: string;
  isAdmin: boolean;
  isViewer: boolean;
  theme: Theme;
  onTheme: (t: Theme) => void;
  lang: Lang;
  onLang: (l: Lang) => void;
  onLogout: () => void;
}) {
  const { t } = useLang();
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (ref.current?.open && !ref.current.contains(e.target as Node)) ref.current.open = false;
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape" && ref.current?.open) ref.current.open = false;
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, []);
  const i = THEMES.findIndex((t) => t.key === theme);
  const cur = THEMES[i];
  const next = THEMES[(i + 1) % THEMES.length];

  return (
    <details className="usermenu" ref={ref}>
      <summary aria-label={`${name} hesabı, menüyü aç`}>
        <Avatar name={name} size={32} label={false} />
        <span>{name}</span>
        <Icon name="chevron" size={14} />
      </summary>
      <div className="pop">
        <div className="who-line">
          <b>
            {name} {isAdmin && <span className="tag">Admin</span>}
            {isViewer && <span className="tag tag-neutral">Görüntüleyici</span>}
          </b>
          <span>{email}</span>
        </div>
        <button className="menu-item" onClick={() => onTheme(next.key)} title={`Şimdi: ${cur.label}`}>
          <Icon name={cur.icon} /> {cur.label} <span className="muted">→ {next.label.replace("Tema: ", "")}</span>
        </button>
        <button
          className="menu-item"
          onClick={() => onLang(lang === "tr" ? "en" : "tr")}
          lang={lang === "tr" ? "en" : "tr"}
        >
          <Icon name="globe" /> {t("lang.switch")}
        </button>
        <button className="menu-item danger" onClick={onLogout}>
          <Icon name="logout" /> Çıkış yap
        </button>
      </div>
    </details>
  );
}

function GlobalSearch() {
  const { t } = useLang();
  const { stageName } = useReference();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [opts, setOpts] = useState<Opt[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();

  // Ctrl/Cmd+K — "her şeye atla" kısayolu.
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);

  // Arama sunucuda (Faz 6d): görünür lead'ler, kişiler, kuruluşlar; 200 ms bekleyip tek istek.
  useEffect(() => {
    const s = q.trim();
    if (s.length < 2) {
      setOpts([]);
      return;
    }
    let alive = true;
    const id = setTimeout(() => {
      pipelineApi
        .search(s)
        .then((r) => {
          if (!alive) return;
          const leads: Opt[] = r.leads.map((l) => ({
            id: "l-" + l.id,
            group: t("search.leads"),
            icon: "inbox",
            title: l.fullName,
            meta: [stageName(l.currentStage), l.company].filter(Boolean).join(" · "),
            go: () => navigate("lead", undefined, l.id),
          }));
          const persons: Opt[] = r.persons.map((p) => ({
            id: "p-" + p.id,
            group: t("search.persons"),
            icon: "user",
            title: p.fullName || p.emailNormalized || p.phoneE164 || "—",
            meta: p.emailNormalized || p.phoneE164 || "",
            go: () => navigate("contacts", p.emailNormalized || p.phoneE164 || p.fullName),
          }));
          const orgs: Opt[] = r.organizations.map((o) => ({
            id: "o-" + o.id,
            group: t("search.orgs"),
            icon: "building",
            title: o.name,
            meta: o.country ? countryName(o.country) : "",
            go: () => navigate("contacts", o.name),
          }));
          setOpts([...leads, ...persons, ...orgs]);
          setActive(0);
        })
        .catch(() => alive && setOpts([]));
    }, 200);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [q, t, stageName]);

  const choose = (o: Opt) => {
    o.go();
    setQ("");
    setOpen(false);
    input.current?.blur();
  };
  const showList = open && q.trim().length >= 2;

  return (
    <div className="gsearch">
      <div className="gsearch-box">
        <Icon name="search" />
        <input
          ref={input}
          type="search"
          role="combobox"
          aria-label="Müşteri, kişi veya organizasyon ara"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && opts[active] ? `gs-${opts[active].id}` : undefined}
          placeholder="Müşteri ara…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(opts.length - 1, a + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === "Enter" && opts[active]) {
              choose(opts[active]);
            } else if (e.key === "Escape") {
              setQ("");
              setOpen(false);
            }
          }}
        />
        <kbd className="kbd" aria-hidden="true">
          Ctrl K
        </kbd>
      </div>
      {showList && (
        <ul className="gs-list" id={listId} role="listbox" aria-label="Arama sonuçları">
          {!opts.length && <li className="gs-empty">“{q}” için sonuç yok</li>}
          {opts.map((o, i) => (
            <li key={o.id} role="presentation">
              {(i === 0 || opts[i - 1].group !== o.group) && (
                <div className="gs-group" aria-hidden="true">
                  {o.group}
                </div>
              )}
              <div
                id={`gs-${o.id}`}
                role="option"
                aria-selected={i === active}
                className="gs-opt"
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(o)}
              >
                <Icon name={o.icon} />
                <span className="gs-t">{o.title}</span>
                <span className="gs-m">{o.meta}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
