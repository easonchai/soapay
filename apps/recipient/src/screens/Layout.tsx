import { Outlet, useLocation, useNavigate } from "react-router";
import { Shell, type ShellTab } from "@soapay/ui";
import { chainName, ENV, exitOffered } from "../config.js";
import { useServices } from "../services/ServicesProvider.js";
import { Badge } from "../ui/kit.js";
import { useVault } from "../vault/VaultProvider.js";

const NAV = [
  { to: "/", label: "Payments" },
  { to: "/spend", label: "Send" },
  { to: "/exit", label: "Exit" },
  { to: "/labels", label: "Labels" },
  { to: "/name", label: "Name" },
  { to: "/settings", label: "Settings" },
] as const;

/** CK's employee-app frame (@soapay/ui Shell: lockup, text nav with the sliding underline, chain chip). */
export function Layout() {
  const vault = useVault();
  const svc = useServices();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const tabs: ShellTab[] = [
    // No Exit on the Base Sepolia demo: the mock pay token can't bridge (D-52).
    ...NAV.filter((n) => n.to !== "/exit" || exitOffered(svc.settings.chainId)).map((n) => ({
      label: n.label,
      active: n.to === "/" ? pathname === "/" : pathname.startsWith(n.to),
      onSelect: () => void navigate(n.to),
    })),
    // The company app (CK's "Pay" tab).
    { label: "Pay", href: ENV.otherAppUrl },
  ];
  return (
    <Shell
      chainName={chainName(svc.settings.chainId)}
      tabs={tabs}
      right={
        <>
          {svc.mock && (
            <Badge tone="warning" title="VITE_MOCK_API=1: demo data, nothing is sent">
              Mock
            </Badge>
          )}
          <button type="button" className="btn-text" onClick={vault.lock}>
            Lock
          </button>
        </>
      }
    >
      <Outlet />
    </Shell>
  );
}
