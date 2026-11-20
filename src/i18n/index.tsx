import { setCountryLang } from "../domain/constants";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { translate, type TKey } from "./dict";
import { dirOf, isLang, setActiveLang, type Lang } from "./lang";
import { watchTurkishTitleCase } from "./turkishTitleCase";

/** Arayüz dili: sağlayıcı ve `useLang`. Sözlük ve çeviri `./dict` içinde (React'siz; testler oradan okur). */
export { DICT, refName, translate, type TKey } from "./dict";
export { LANGS, dirOf, localeOf, type Lang } from "./lang";

const LANG_KEY = "unixcrm.v2.lang";

interface LangCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: TKey | string, vars?: Record<string, string | number>) => string;
}
const Ctx = createContext<LangCtx | null>(null);

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    try {
      const saved = localStorage.getItem(LANG_KEY);
      return isLang(saved) ? saved : "tr";
    } catch {
      return "tr";
    }
  });
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(LANG_KEY, l);
    } catch {
      /* per-viewer convenience only */
    }
  }, []);
  // Ülke adları ve biçimleyiciler de dili izler; çocuklar çizilmeden önce bildirilir.
  setCountryLang(lang);
  setActiveLang(lang);
  // Belge dili, yazı yönü (Arapça sağdan sola) ve sekme başlığı; ilk açılışta da uygulanır.
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = dirOf(lang);
    document.title = `Unixpadel ${translate(lang, "app.name")}`;
  }, [lang]);
  // Başlık büyütmesi Türkçede "i"yi "I" yapmasın (bkz. turkishTitleCase.ts).
  useEffect(() => (lang === "tr" ? watchTurkishTitleCase() : undefined), [lang]);
  const t = useCallback<LangCtx["t"]>((key, vars) => translate(lang, key, vars), [lang]);
  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLang(): LangCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useLang needs LangProvider");
  return c;
}
