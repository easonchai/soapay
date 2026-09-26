import { AnimatePresence, type AnimatePresenceProps } from 'framer-motion';
import type { ReactNode } from 'react';

/** True when the page was opened with ?motion=off or the OS asks for reduced motion. */
export function motionOff(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (new URLSearchParams(window.location.search).get('motion') === 'off') return true;
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  } catch {
    return false;
  }
}

/** AnimatePresence that renders children directly when motion is off, so nothing waits on a frame. */
export function Presence({ children, ...rest }: AnimatePresenceProps & { children: ReactNode }) {
  if (motionOff()) return <>{children}</>;
  return <AnimatePresence {...rest}>{children}</AnimatePresence>;
}
