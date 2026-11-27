import { useEffect, useId, useRef, useState } from "react";
import { countryName } from "../domain/constants";
import { useLang } from "../i18n";
import { homeRoute, navigate, type Route } from "../router";
import { NotificationsBell } from "../pipeline/NotificationsBell";
import { pipelineApi } from "../pipeline/api";
import { useReference, useTodayCount } from "../pipeline/hooks";
import { useCrm, type Theme } from "../state/CrmContext";
import { setDisplayCurrency, useDisplayCurrency } from "../state/currency";
import { LangMenu } from "./LangMenu";
import { WhatsNewDialog, useWhatsNew } from "./WhatsNew";
import { Avatar, Button, Icon, IconButton } from "./ui";

const THEMES: { key: Theme; icon: string }[] = [
  { key: "auto", icon: "auto" },
  { key: "light", icon: "sun" },
  { key: "dark", icon: "moon" },
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
  const { user, isAdmin, isViewer, isMarketing, theme, setTheme, logout } = useCrm();
  const { t } = useLang();
  // "Neler yeni": yeni güncelleme notu varsa açılışta bir kez; menüden her zaman.
  const whatsNew = useWhatsNew();

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
      badgeLabel: t("nav.today.badge", { n: dueCount }),
      bad: true,
    },
    { r: "contacts", icon: "user", label: t("nav.contacts") },
    // Raporlar pazarlama rolüne kapalı (sunucu da 403 döner).
    ...(isMarketing ? [] : [{ r: "reports" as const, icon: "chart", label: t("nav.reports") }]),
    // Yönetim paneli (Faz 7): yöneticiye; pazarlama rolüne salt okunur.
    // İşlem günlüğünü (seesLogs) ya da mail raporunu (seesMailStats) görebilen kişi yönetici değilse de panele girer;
    // yalnız o sekmeleri görür.
    ...(isAdmin || isMarketing || user?.seesLogs === true || user?.seesMailStats === true
      ? [{ r: "admin" as const, icon: "lock", label: t("nav.admin") }]
      : []),
  ];

  return (
    <header className="hdr">
      <a className="wordmark" href={`#/${homeRoute(user?.role)}`} aria-label={t("app.home")}>
        <b>Unixpadel</b>
        <span>{t("app.name")}</span>
      </a>
      <nav className="nav" aria-label={t("nav.main")}>
        {NAV.map((n) => (
          <a
            key={n.r}
            href={`#/${n.r}`}
            className="nav-link"
            aria-current={route === n.r || (n.r === "list" && route === "lead") ? "page" : undefined}
            aria-label={n.badge ? `${n.label}, ${n.badgeLabel}` : n.label}
            title={n.label}
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
        <CurrencySwitch />
        <NotificationsBell />
        <UserMenu
          name={user?.name ?? ""}
          email={user?.email ?? ""}
          isAdmin={isAdmin}
          isViewer={isViewer}
          isMarketing={isMarketing}
          theme={theme}
          onTheme={setTheme}
          onLogout={logout}
          onWhatsNew={whatsNew.show}
        />
      </div>
      {whatsNew.open && <WhatsNewDialog onClose={whatsNew.close} />}
    </header>
  );
}

function UserMenu({
  name,
  email,
  isAdmin,
  isViewer,
  isMarketing,
  theme,
  onTheme,
  onLogout,
  onWhatsNew,
}: {
  name: string;
  email: string;
  isAdmin: boolean;
  isViewer: boolean;
  isMarketing: boolean;
  theme: Theme;
  onTheme: (t: Theme) => void;
  onLogout: () => void;
  onWhatsNew: () => void;
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
      <summary aria-label={t("user.menu", { name })}>
        <Avatar name={name} size={32} label={false} />
        <span>{name}</span>
        <Icon name="chevron" size={14} />
      </summary>
      <div className="pop">
        <div className="who-line">
          <b>
            {name} {isAdmin && <span className="tag">{t("role.admin")}</span>}
            {isMarketing ? (
              <span className="tag tag-neutral">{t("role.marketing")}</span>
            ) : (
              isViewer && <span className="tag tag-neutral">{t("role.viewer")}</span>
            )}
          </b>
          <span>{email}</span>
        </div>
        <button className="menu-item" onClick={() => onTheme(next.key)}>
          <Icon name={cur.icon} /> {t("theme.label", { name: t(`theme.${cur.key}`) })}{" "}
          <span className="muted">{t("theme.next", { name: t(`theme.${next.key}`) })}</span>
        </button>
        <LangMenu />
        <button
          className="menu-item"
          onClick={() => {
            if (ref.current) ref.current.open = false;
            onWhatsNew();
          }}
        >
          <Icon name="star" /> {t("whatsNew.menu")}
        </button>
        <button className="menu-item danger" onClick={onLogout}>
          <Icon name="logout" /> {t("auth.logout")}
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
  // Telefonda kutu başlıkta yer kaplamaz: büyüteç düğmesi tam genişlik arama şeridini açar.
  const [sheet, setSheet] = useState(false);
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

  const close = () => {
    setQ("");
    setOpen(false);
    setSheet(false);
  };
  const choose = (o: Opt) => {
    o.go();
    close();
    input.current?.blur();
  };
  const showList = open && q.trim().length >= 2;

  return (
    <div className={"gsearch" + (sheet ? " is-open" : "")}>
      <IconButton
        icon="search"
        label={t("search.aria")}
        className="gsearch-open"
        aria-expanded={sheet}
        onClick={() => {
          setSheet(true);
          // Klavye, dokunuşla aynı olayda odaklanınca açılır (iOS).
          input.current?.focus();
        }}
      />
      <div className="gsearch-box">
        <Icon name="search" />
        <input
          ref={input}
          type="search"
          role="combobox"
          aria-label={t("search.aria")}
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && opts[active] ? `gs-${opts[active].id}` : undefined}
          placeholder={t("common.search")}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => (setOpen(true), setSheet(true))}
          onBlur={() =>
            setTimeout(() => {
              setOpen(false);
              if (!input.current?.value) setSheet(false);
            }, 120)
          }
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
              close();
            }
          }}
        />
        <kbd className="kbd" aria-hidden="true">
          Ctrl K
        </kbd>
        <IconButton
          icon="x"
          label={t("common.close")}
          className="gsearch-close"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            close();
            input.current?.blur();
          }}
        />
      </div>
      {showList && (
        <ul className="gs-list" id={listId} role="listbox" aria-label={t("search.results")}>
          {!opts.length && <li className="gs-empty">{t("search.none", { q })}</li>}
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

/** Görünüm para birimi (2026-11-20): bütün tutarlar bu birimde, güncel kurla gösterilir. Çalışma para birimi olan
 * lead'in tutarları kendi biriminde kalır. Seçim tarayıcıda saklanır. */
function CurrencySwitch() {
  const { t } = useLang();
  const { ref } = useReference();
  const current = useDisplayCurrency();
  const list = ref?.currencies ?? ["EUR", "USD", "TRY", "GBP"];
  const options = list.includes(current) ? list : [current, ...list];
  return (
    <label className="hdr-cur" title={t("currency.display.hint")}>
      <span className="sr-only">{t("currency.display")}</span>
      <select value={current} onChange={(e) => setDisplayCurrency(e.target.value)} aria-label={t("currency.display")}>
        {options.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
    </label>
  );
}
