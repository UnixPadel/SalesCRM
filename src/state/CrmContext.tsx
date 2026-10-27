import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, ApiError, UNAUTHORIZED_EVENT } from "../data/api";
import { createHttpRepository } from "../data/httpRepository";
import type { CrmRepository } from "../data/repository";
import { seedIfEmpty } from "../data/seed";
import { OWNERS } from "../domain/constants";
import type { Contact, Deal, ID, Organization, Snapshot, TeamMember, User } from "../domain/types";
import { RuleError } from "../services/crmService";

const repo: CrmRepository = createHttpRepository();
const EMPTY: Snapshot = { organizations: [], contacts: [], leads: [], deals: [], activities: [], stageChanges: [] };
const THEME_KEY = "unixcrm.v2.theme";
const VIEW_KEY = "unixcrm.v2.view";

export type Theme = "auto" | "light" | "dark";
/** Whose customers the board shows: mine, the untagged pool, or everyone's. */
export type View = "mine" | "pool" | "all";

export interface ToastAction {
  label: string;
  run: () => void;
}
interface Toast {
  id: number;
  msg: string;
  bad?: boolean;
  action?: ToastAction;
}
type OkMsg<T> = string | ((r: T) => string | { msg: string; action?: ToastAction });

interface CrmCtx {
  data: Snapshot;
  ready: boolean;
  orgById: Map<ID, Organization>;
  contactById: Map<ID, Contact>;
  countryOfDeal: (d: Deal) => string;
  /** Logged-in person; null while logged out. `authChecked` is false until the first /me answer. */
  user: User | null;
  authChecked: boolean;
  login: (email: string, password: string) => Promise<string | null>;
  logout: () => Promise<void>;
  /** Display name of the logged-in person (owner value on deals/leads). */
  me: string;
  /** Admins see and control everything. */
  isAdmin: boolean;
  /** Viewers (accounting, factory, logistics…) may look but not change anything. */
  isViewer: boolean;
  /** Sales team from the user table: the names a customer can be assigned to. */
  team: TeamMember[];
  owners: string[];
  /** May the logged-in person change a row with this owner? (own rows + the pool; admins: all) */
  canEdit: (owner: string) => boolean;
  view: View;
  setView: (v: View) => void;
  /** Does an owner value belong in the current view? */
  inView: (owner: string) => boolean;
  theme: Theme;
  setTheme: (t: Theme) => void;
  /** Runs a service call, refreshes the snapshot and surfaces rule errors as toasts. */
  run: <T>(fn: (repo: CrmRepository) => Promise<T>, okMsg?: OkMsg<T>) => Promise<T | undefined>;
  openDealId: ID | null;
  openDeal: (id: ID | null) => void;
  /** Customers created from a form lead in this session — the drawer shows a "first steps" checklist. */
  freshDeals: Set<ID>;
  markFresh: (id: ID) => void;
  toasts: Toast[];
  toast: (msg: string, opts?: { bad?: boolean; action?: ToastAction }) => void;
  dismissToast: (id: number) => void;
  resetDemo: () => Promise<void>;
}

const Ctx = createContext<CrmCtx | null>(null);

async function loadSnapshot(): Promise<Snapshot> {
  const [organizations, contacts, leads, deals, activities, stageChanges] = await Promise.all([
    repo.organizations.list(),
    repo.contacts.list(),
    repo.leads.list(),
    repo.deals.list(),
    repo.activities.list(),
    repo.stageChanges.list(),
  ]);
  return { organizations, contacts, leads, deals, activities, stageChanges };
}

const readPref = (k: string): string | null => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const writePref = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* per-viewer convenience only */
  }
};

export function CrmProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<Snapshot>(EMPTY);
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [openDealId, setOpenDealId] = useState<ID | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [viewPref, setViewPref] = useState<View | null>(() => readPref(VIEW_KEY) as View | null);
  // Light paper theme by default: the board is read at a glance, dark only on request.
  const [theme, setThemeState] = useState<Theme>(() => (readPref(THEME_KEY) as Theme | null) ?? "light");
  const [freshDeals, setFresh] = useState<Set<ID>>(() => new Set());
  const [team, setTeam] = useState<TeamMember[]>([]);
  const seq = useRef(0);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "auto") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
  }, [theme]);

  const dismissToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const toast = useCallback<CrmCtx["toast"]>(
    (msg, opts = {}) => {
      const id = ++seq.current;
      setToasts((t) => [...t.slice(-2), { id, msg, ...opts }]);
      // Toasts with an action stay longer so the action is reachable (WCAG 2.2.1 timing).
      setTimeout(() => dismissToast(id), opts.action ? 8000 : opts.bad ? 6000 : 3000);
    },
    [dismissToast],
  );

  const refresh = useCallback(async () => setData(await loadSnapshot()), []);

  // Session check on first load, and forced logout whenever the server answers 401.
  useEffect(() => {
    api<{ user: User }>("GET", "/api/auth/me")
      .then((r) => setUser(r.user))
      .catch(() => setUser(null))
      .finally(() => setAuthChecked(true));
    const out = () => {
      setUser(null);
      setReady(false);
      setData(EMPTY);
    };
    window.addEventListener(UNAUTHORIZED_EVENT, out);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, out);
  }, []);

  // Load (and seed once) after login.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        api<TeamMember[]>("GET", "/api/users")
          .then((t) => !cancelled && setTeam(t))
          .catch(() => {
            /* roster falls back to the static list */
          });
        await seedIfEmpty(repo);
        await refresh();
      } catch (e) {
        console.error(e);
        toast("Veri yüklenemedi: " + (e as Error).message, { bad: true });
      }
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [user, refresh, toast]);

  const login = useCallback<CrmCtx["login"]>(async (email, password) => {
    try {
      const r = await api<{ user: User }>("POST", "/api/auth/login", { email, password });
      setUser(r.user);
      return null;
    } catch (e) {
      return e instanceof ApiError ? e.message : "Giriş başarısız.";
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await api<void>("POST", "/api/auth/logout");
    } catch {
      /* already out */
    }
    setUser(null);
    setReady(false);
    setData(EMPTY);
    setOpenDealId(null);
  }, []);

  const run = useCallback<CrmCtx["run"]>(
    async (fn, okMsg) => {
      try {
        const r = await fn(repo);
        await refresh();
        if (okMsg) {
          const out = typeof okMsg === "function" ? okMsg(r) : okMsg;
          if (typeof out === "string") toast(out);
          else toast(out.msg, { action: out.action });
        }
        return r;
      } catch (e) {
        if (!(e instanceof RuleError)) console.error(e);
        toast((e as Error).message || "İşlem başarısız", { bad: true });
        return undefined;
      }
    },
    [refresh, toast],
  );

  const setView = useCallback((v: View) => {
    setViewPref(v);
    writePref(VIEW_KEY, v);
  }, []);
  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    writePref(THEME_KEY, t);
  }, []);
  const markFresh = useCallback((id: ID) => setFresh((s) => new Set(s).add(id)), []);

  const resetDemo = useCallback(async () => {
    try {
      await repo.reset();
      await seedIfEmpty(repo);
      await refresh();
      setOpenDealId(null);
      toast("Örnek veri baştan yüklendi");
    } catch (e) {
      toast((e as Error).message, { bad: true });
    }
  }, [refresh, toast]);

  const me = user?.name ?? "";
  const isAdmin = user?.role === "admin";
  const isViewer = user?.role === "viewer";
  const owners = useMemo(() => {
    const names = team.map((t) => t.name);
    // keep whoever is logged in (or already owns rows) assignable even if the roster is stale
    if (me && !isViewer && !names.includes(me) && !(user?.email.startsWith("admin@"))) names.push(me);
    return names.length ? names : OWNERS;
  }, [team, me, isViewer, user]);
  // Everyone opens on their own customers; the team view is one click away.
  const view: View = viewPref ?? "mine";
  const inView = useCallback(
    (owner: string) => (view === "all" ? true : view === "pool" ? !owner : owner === me),
    [view, me],
  );
  const canEdit = useCallback((owner: string) => isAdmin || (!isViewer && (!owner || owner === me)), [isAdmin, isViewer, me]);

  const orgById = useMemo(() => new Map(data.organizations.map((o) => [o.id, o])), [data.organizations]);
  const contactById = useMemo(() => new Map(data.contacts.map((c) => [c.id, c])), [data.contacts]);
  const countryOfDeal = useCallback(
    (d: Deal) =>
      (d.organization_id && orgById.get(d.organization_id)?.country) ||
      (d.contact_id && contactById.get(d.contact_id)?.country) ||
      "",
    [orgById, contactById],
  );

  const value: CrmCtx = {
    data, ready, orgById, contactById, countryOfDeal, user, authChecked, login, logout, me, isAdmin, isViewer, team, owners, canEdit,
    view, setView, inView, theme, setTheme, run, openDealId, openDeal: setOpenDealId, freshDeals, markFresh,
    toasts, toast, dismissToast, resetDemo,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCrm() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useCrm must be used inside <CrmProvider>");
  return c;
}
