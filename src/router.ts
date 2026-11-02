export type Route = "inbox" | "lead" | "pipeline" | "activities" | "reports" | "contacts" | "leads";
export const ROUTES: Route[] = ["inbox", "lead", "pipeline", "activities", "reports", "contacts", "leads"];

export interface Location {
  route: Route;
  /** `?q=` arama metni (gelen kutusu, kişiler). */
  q: string;
  id: string;
  /** Sorgu parametrelerinin tamamı (pano filtreleri: owner, country, rotting). */
  params: URLSearchParams;
}

/** `#/inbox`, `#/lead/<id>`, `#/contacts?q=…`, `#/pipeline?owner=me&country=TR&rotting=1` */
export function parseHash(): Location {
  const [path, query] = location.hash.replace(/^#\/?/, "").split("?");
  const [seg, id = ""] = (path ?? "").split("/");
  const route = (ROUTES.includes(seg as Route) ? seg : "inbox") as Route;
  const params = new URLSearchParams(query || "");
  return { route, q: params.get("q") || "", id: decodeURIComponent(id), params };
}

export function navigate(route: Route, q?: string, id?: string) {
  location.hash = `/${route}${id ? "/" + encodeURIComponent(id) : ""}${q ? "?q=" + encodeURIComponent(q) : ""}`;
}

/** Aynı sayfada sorgu parametrelerini değiştirir; `replace` ile geçmişe kayıt eklemez (filtre değişiklikleri). */
export function setHashParams(route: Route, params: URLSearchParams, replace = false) {
  const s = params.toString();
  const hash = `#/${route}${s ? "?" + s : ""}`;
  if (replace) history.replaceState(null, "", hash);
  else location.hash = hash.slice(1);
  if (replace) window.dispatchEvent(new HashChangeEvent("hashchange"));
}
