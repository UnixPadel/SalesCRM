import { useEffect, useState } from "react";

/** Telefon düzeni: CSS'teki `@media (max-width: 768px)` kırılımıyla aynı sınır. */
export const PHONE_QUERY = "(max-width: 768px)";

/** Bir medya sorgusunu izler; pencere döndürülünce ya da boyutlanınca yeniden çizer. */
export function useMediaQuery(query: string): boolean {
  const get = () => typeof window !== "undefined" && window.matchMedia(query).matches;
  const [match, setMatch] = useState(get);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return match;
}

export const usePhone = () => useMediaQuery(PHONE_QUERY);
