import { useEffect, useId, useMemo, useRef, useState } from "react";
import { STAGE, countryName } from "../domain/constants";
import { activityBucket, isRotting } from "../domain/rules";
import { useLang, type Lang } from "../i18n";
import { navigate, type Route } from "../router";
import { NotificationsBell } from "../pipeline/NotificationsBell";
import { useCrm, type Theme } from "../state/CrmContext";
import { Avatar, Button, Icon, money } from "./ui";

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
  const { data, user, me, isAdmin, isViewer, inView, theme, setTheme, logout, resetDemo } = useCrm();
  const { t, lang, setLang } = useLang();

  const dealOwner = new Map(data.deals.map((d) => [d.id, d.owner]));
  const dueCount = data.activities.filter(
    (a) => !a.done && dealOwner.get(a.deal_id) === me && activityBucket(a) !== "planned",
  ).length;
  const rotting = data.deals.filter((d) => inView(d.owner) && isRotting(d, data.activities)).length;
  void rotting;

  // Faz 1: Gelen kutusu ve Pano yeni pipeline; Bugün / Kişiler / Raporlar eski veriyle çalışır.
  const NAV: { r: Route; icon: string; label: string; badge?: number; badgeLabel?: string; bad?: boolean }[] = [
    { r: "inbox", icon: "inbox", label: t("nav.inbox") },
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
  ];

  return (
    <header className="hdr">
      <a className="wordmark" href="#/inbox" aria-label="Unixpadel satış panosu, ana sayfa">
        <b>unixpadel</b>
        <span>satış panosu</span>
      </a>
      <nav className="nav" aria-label="Ana menü">
        {NAV.map((n) => (
          <a
            key={n.r}
            href={`#/${n.r}`}
            className="nav-link"
            aria-current={route === n.r || (n.r === "inbox" && route === "lead") ? "page" : undefined}
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
          onReset={() => {
            if (confirm("Ekibin tüm verisi silinip örnek veri yeniden yüklensin mi? Bu işlem herkesi etkiler."))
              resetDemo();
          }}
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
  onReset,
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
  onReset: () => void;
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
        {isAdmin && (
          <button className="menu-item" onClick={onReset}>
            <Icon name="reset" /> Örnek veriyi sıfırla (admin)
          </button>
        )}
        <button className="menu-item danger" onClick={onLogout}>
          <Icon name="logout" /> Çıkış yap
        </button>
      </div>
    </details>
  );
}

function GlobalSearch() {
  const { data, orgById, contactById, openDeal } = useCrm();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();

  // Ctrl/Cmd+K — the conventional "jump to anything" shortcut.
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

  const opts = useMemo<Opt[]>(() => {
    const s = q.trim().toLocaleLowerCase("tr");
    if (s.length < 2) return [];
    const has = (t: string) => t.toLocaleLowerCase("tr").includes(s);
    const deals = data.deals
      .filter((d) => {
        const org = d.organization_id ? orgById.get(d.organization_id)?.name : "";
        const con = d.contact_id ? contactById.get(d.contact_id) : undefined;
        return has(`${d.title} ${org} ${con?.name ?? ""} ${con?.email ?? ""}`);
      })
      .slice(0, 6)
      .map((d) => ({
        id: d.id,
        group: "Müşteriler",
        icon: "pipeline",
        title: d.title,
        meta: `${STAGE[d.stage].no}. ${STAGE[d.stage].label}${d.value ? " · " + money(d.value, d.currency, true) : ""}`,
        go: () => openDeal(d.id),
      }));
    const orgs = data.organizations
      .filter((o) => has(o.name))
      .slice(0, 4)
      .map((o) => ({
        id: o.id,
        group: "Organizasyonlar",
        icon: "building",
        title: o.name,
        meta: countryName(o.country),
        go: () => navigate("contacts", o.name),
      }));
    const leads = data.leads
      .filter((l) => {
        const c = contactById.get(l.contact_id);
        return c && has(`${c.name} ${c.email} ${c.phone}`);
      })
      .slice(0, 6)
      .map((l) => {
        const c = contactById.get(l.contact_id)!;
        return {
          id: l.id,
          group: "Formlar",
          icon: "inbox",
          title: c.name,
          meta: c.email || c.phone,
          go: () => navigate("leads", c.email || c.name),
        };
      });
    return [...deals, ...orgs, ...leads];
  }, [q, data, orgById, contactById, openDeal]);

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
