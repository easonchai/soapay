import { NavLink, Outlet } from "react-router";
import { ArrowLeftRight, Home, Lock, Repeat, Send, Settings as Cog, Tag, UserRound } from "lucide-react";
import { chainName } from "../config.js";
import { Logo } from "../onboarding/Onboarding.js";
import { useServices } from "../services/ServicesProvider.js";
import { Badge, Button, cn } from "../ui/kit.js";
import { useVault } from "../vault/VaultProvider.js";

const NAV = [
  { to: "/", label: "Payments", icon: Home, end: true },
  { to: "/spend", label: "Send", icon: Send },
  { to: "/convert", label: "Convert", icon: Repeat },
  { to: "/labels", label: "Labels", icon: Tag },
  { to: "/name", label: "Name", icon: UserRound },
  { to: "/settings", label: "Settings", icon: Cog },
];

export function Layout() {
  const vault = useVault();
  const svc = useServices();
  return (
    <div className="min-h-dvh">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <Logo />
            <Badge>{chainName(svc.settings.chainId)}</Badge>
            {svc.mock && (
              <Badge tone="warning" title="VITE_MOCK_API=1: demo data, nothing is sent">
                <ArrowLeftRight className="size-3" aria-hidden /> Mock
              </Badge>
            )}
          </div>
          <Button variant="ghost" size="sm" onClick={vault.lock}>
            <Lock className="size-4" aria-hidden /> Lock
          </Button>
        </div>
        <nav className="mx-auto flex max-w-4xl gap-1 overflow-x-auto px-2 pb-2" aria-label="Main">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end === true}
              className={({ isActive }) =>
                cn(
                  "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm whitespace-nowrap",
                  isActive ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/60",
                )
              }
            >
              <Icon className="size-4" aria-hidden />
              {label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
