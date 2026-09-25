import type { ReactNode } from 'react';
import { Pill } from './Pill.js';

export type ShellTab = { label: string; active?: boolean; onSelect?: () => void; href?: string };

/** Header + centered column. Tabs switch views inside an app; an href tab links to the other app. */
export function Shell({ tabs, chainName, children }: { tabs: ShellTab[]; chainName: string; children: ReactNode }) {
  return (
    <>
      <header className="site-header">
        <span className="wordmark">Soapay</span>
        <nav className="site-nav" aria-label="Main">
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
        <span className="spacer" />
        <Pill tone="accent" dot>
          {chainName}
        </Pill>
      </header>
      <main>{children}</main>
    </>
  );
}
