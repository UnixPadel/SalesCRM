export type Route = "pipeline" | "leads" | "activities" | "reports" | "contacts";
export const ROUTES: Route[] = ["pipeline", "leads", "activities", "reports", "contacts"];

export function parseHash(): { route: Route; q: string } {
  const [path, query] = location.hash.replace(/^#\/?/, "").split("?");
  const route = (ROUTES.includes(path as Route) ? path : "pipeline") as Route;
  return { route, q: new URLSearchParams(query || "").get("q") || "" };
}

export function navigate(route: Route, q?: string) {
  location.hash = `/${route}${q ? "?q=" + encodeURIComponent(q) : ""}`;
}
