import type { ReactNode } from 'react';
import { Lockup } from './logo/Logo.js';

export type TopTab = { label: string; active?: boolean; onSelect?: () => void; href?: string };

/** 52px app bar: Soapay / {org}, text nav, right slot for the wallet chip and Log out. */
export function TopBar({ org, tabs, right }: { org?: string | undefined; tabs: TopTab[]; right?: ReactNode }) {
  return (
    <header className="topbar">
      <div className="topbar-left">
        <div className="brand">
          <Lockup height={18} />
          {org && (
            <>
              <span className="sep">/</span>
              <span className="org">{org}</span>
            </>
          )}
        </div>
        <nav className="topnav" aria-label="Main">
          {tabs.map((t) =>
            t.href ? (
              <a key={t.label} href={t.href}>
                {t.label}
              </a>
            ) : (
              <a
                key={t.label}
                href="#"
                className={t.active ? 'active' : undefined}
                aria-current={t.active ? 'page' : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  t.onSelect?.();
                }}
              >
                {t.label}
              </a>
            ),
          )}
        </nav>
      </div>
      <div className="topbar-right">{right}</div>
    </header>
  );
}
