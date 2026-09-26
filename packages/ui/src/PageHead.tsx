import type { ReactNode } from 'react';
import { Dots } from './Dots.js';

/** Eyebrow, title, one line, dot texture filling the gap, actions on the right. */
export function PageHead({ eyebrow, title, line, actions }: { eyebrow: ReactNode; title: ReactNode; line?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="pagehead">
      <div className="text">
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        {line && <p className="lead">{line}</p>}
      </div>
      <Dots mode="right" animate minWidth={220} className="dots" />
      {actions && <div className="actions">{actions}</div>}
    </div>
  );
}
