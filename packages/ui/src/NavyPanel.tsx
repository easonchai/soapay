import type { ReactNode } from 'react';
import { Dots } from './Dots.js';

/** Navy block with the white dot texture at right. */
export function NavyPanel({ children, dots = true, className }: { children: ReactNode; dots?: boolean; className?: string }) {
  return (
    <div className={`navy${className ? ` ${className}` : ''}`}>
      {dots && <Dots mode="right" color="255,255,255" className="dots" />}
      {children}
    </div>
  );
}
