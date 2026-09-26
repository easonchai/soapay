import type { ReactNode } from 'react';
import { TopBar, type TopTab } from './TopBar.js';

export type ShellTab = TopTab;

/** Page frame: TopBar + padded main. Kept for the employee app; the company app uses TopBar directly. */
export function Shell({ tabs, chainName, right, org, children }: { tabs: ShellTab[]; chainName: string; right?: ReactNode | undefined; org?: string | undefined; children: ReactNode }) {
  return (
    <div className="page">
      <TopBar
        org={org}
        tabs={tabs}
        right={
          <>
            <span className="chip">
              <span className="dot" />
              {chainName}
            </span>
            {right}
          </>
        }
      />
      <main className="app-main">{children}</main>
    </div>
  );
}
