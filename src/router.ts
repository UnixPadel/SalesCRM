export type Route = "inbox" | "lead" | "pipeline" | "activities" | "reports" | "contacts" | "leads";
export const ROUTES: Route[] = ["inbox", "lead", "pipeline", "activities", "reports", "contacts", "leads"];

/** `#/inbox`, `#/lead/<id>`, `#/contacts?q=…` */
export function parseHash(): { route: Route; q: string; id: string } {
  const [path, query] = location.hash.replace(/^#\/?/, "").split("?");
  const [seg, id = ""] = (path ?? "").split("/");
  const route = (ROUTES.includes(seg as Route) ? seg : "inbox") as Route;
  return { route, q: new URLSearchParams(query || "").get("q") || "", id: decodeURIComponent(id) };
}

export function navigate(route: Route, q?: string, id?: string) {
  location.hash = `/${route}${id ? "/" + encodeURIComponent(id) : ""}${q ? "?q=" + encodeURIComponent(q) : ""}`;
}
