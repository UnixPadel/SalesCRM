import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { api, ApiError, UNAUTHORIZED_EVENT } from "../data/api";
import type { User } from "../domain/types";

/**
 * Uygulama kabuğu durumu: oturum, tema, bildirim balonları. Veri artık burada değil; her sayfa kendi verisini
 * yeni pipeline API'sinden çeker (`src/pipeline`). Eski JSON deposu ve "snapshot" Faz 6d ile kaldırıldı.
 */

const THEME_KEY = "unixcrm.v2.theme";

export type Theme = "auto" | "light" | "dark";

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

interface CrmCtx {
  /** Oturumdaki kişi; çıkışta null. `authChecked` ilk /me yanıtına kadar false. */
  user: User | null;
  authChecked: boolean;
  login: (email: string, password: string) => Promise<string | null>;
  logout: () => Promise<void>;
  /** Admin her şeyi görür ve yapar. */
  isAdmin: boolean;
  /** Görüntüleyici (muhasebe, fabrika, lojistik…) bakar, değiştiremez. */
  isViewer: boolean;
  theme: Theme;
  setTheme: (t: Theme) => void;
  toasts: Toast[];
  toast: (msg: string, opts?: { bad?: boolean; action?: ToastAction }) => void;
  dismissToast: (id: number) => void;
}

const Ctx = createContext<CrmCtx | null>(null);

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
    /* yalnız kişisel kolaylık */
  }
};

export function CrmProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  // Açık tema varsayılan: pano bir bakışta okunur, koyu yalnız istenirse.
  const [theme, setThemeState] = useState<Theme>(() => (readPref(THEME_KEY) as Theme | null) ?? "light");
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
      // Eylemli balon daha uzun kalır ki eyleme yetişilsin (WCAG 2.2.1).
      setTimeout(() => dismissToast(id), opts.action ? 8000 : opts.bad ? 6000 : 3000);
    },
    [dismissToast],
  );

  // İlk yüklemede oturum kontrolü; sunucu 401 dediği anda çıkış.
  useEffect(() => {
    api<{ user: User }>("GET", "/api/auth/me")
      .then((r) => setUser(r.user))
      .catch(() => setUser(null))
      .finally(() => setAuthChecked(true));
    const out = () => setUser(null);
    window.addEventListener(UNAUTHORIZED_EVENT, out);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, out);
  }, []);

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
      /* zaten çıkmış */
    }
    setUser(null);
  }, []);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    writePref(THEME_KEY, t);
  }, []);

  const value: CrmCtx = {
    user,
    authChecked,
    login,
    logout,
    isAdmin: user?.role === "admin",
    isViewer: user?.role === "viewer",
    theme,
    setTheme,
    toasts,
    toast,
    dismissToast,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCrm() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useCrm must be used inside <CrmProvider>");
  return c;
}
