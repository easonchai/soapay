import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { clearJoinLink, parseJoinLink, resolveInvite, type InviteState } from "../onboarding/invite.js";
import { useServices } from "../services/ServicesProvider.js";

export type InviteApi = {
  state: InviteState;
  /** Forget the invite (after the claim, or when the user moves on). Also cleans the URL. */
  dismiss(): void;
};

const InviteContext = createContext<InviteApi>({ state: { kind: "none" }, dismiss: () => {} });

/**
 * Reads a `#/join?code=…` link once on load and resolves it against the API. The invite survives the
 * onboarding steps (and an unlock) because it lives here, not in the URL.
 */
export function InviteProvider({ children, hash }: { children: ReactNode; hash?: string }) {
  const svc = useServices();
  const [link] = useState(() => parseJoinLink(hash ?? (typeof window !== "undefined" ? window.location.hash : "")));
  const [state, setState] = useState<InviteState>(link ? { kind: "loading", link } : { kind: "none" });

  useEffect(() => {
    if (!link) return;
    let live = true;
    void resolveInvite(svc.api, link).then((s) => live && setState(s));
    return () => {
      live = false;
    };
  }, [link, svc.api]);

  const dismiss = useCallback(() => {
    clearJoinLink();
    setState({ kind: "none" });
  }, []);

  const api = useMemo(() => ({ state, dismiss }), [state, dismiss]);
  return <InviteContext.Provider value={api}>{children}</InviteContext.Provider>;
}

export function useInvite(): InviteApi {
  return useContext(InviteContext);
}
