import { motion, type HTMLMotionProps, type MotionStyle } from 'framer-motion';
import type { ReactNode } from 'react';
import { motionOff } from './Presence.js';

/** Fade + 8 px rise, once, on mount. `delay` in seconds. */
export function Reveal({ children, delay = 0, y = 8, className, style, as = 'div' }: { children: ReactNode; delay?: number; y?: number; className?: string; style?: MotionStyle; as?: 'div' | 'section' | 'span' | 'p' }) {
  if (motionOff()) {
    const T = as;
    return (
      <T {...(className ? { className } : {})} {...(style ? { style: style as React.CSSProperties } : {})}>
        {children}
      </T>
    );
  }
  const M = motion[as] as typeof motion.div;
  const props: HTMLMotionProps<'div'> = {
    initial: { opacity: 0, y },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.32, delay, ease: [0.22, 1, 0.36, 1] },
  };
  if (className) props.className = className;
  if (style) props.style = style;
  return <M {...props}>{children}</M>;
}
