// Minimal hash router (#/roster, #/pay, #/history, #/runs/<id>, #/settings) so any UI
// can deep-link without pulling in a routing library.
import { useCallback, useEffect, useState } from "react";

export type Route = { page: "roster" } | { page: "pay" } | { page: "history" } | { page: "run"; id: string } | { page: "settings" };

export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  switch (parts[0]) {
    case "pay":
      return { page: "pay" };
    case "history":
      return { page: "history" };
    case "runs":
      return parts[1] ? { page: "run", id: decodeURIComponent(parts[1]) } : { page: "history" };
    case "settings":
      return { page: "settings" };
    default:
      return { page: "roster" };
  }
}

export function routeHref(r: Route): string {
  return r.page === "run" ? `#/runs/${encodeURIComponent(r.id)}` : `#/${r.page}`;
}

export function useRoute(): [Route, (r: Route) => void] {
  const [route, setRoute] = useState(() => parseRoute(location.hash));
  useEffect(() => {
    const on = () => setRoute(parseRoute(location.hash));
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  const go = useCallback((r: Route) => {
    location.hash = routeHref(r);
  }, []);
  return [route, go];
}
