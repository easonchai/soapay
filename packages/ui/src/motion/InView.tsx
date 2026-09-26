import { motion, type HTMLMotionProps, type MotionStyle } from 'framer-motion';
import type { ReactNode } from 'react';
import { motionOff } from './Presence.js';

/** Fade + rise the first time the element scrolls into view. `delay` in seconds; `amount` is the visible fraction that triggers it. */
export function InView({
  children,
  delay = 0,
  y = 12,
  amount = 0.3,
  duration = 0.7,
  className,
  style,
  as = 'div',
}: {
  children: ReactNode;
  delay?: number;
  y?: number;
  amount?: number;
  duration?: number;
  className?: string;
  style?: MotionStyle;
  as?: 'div' | 'section' | 'span' | 'p' | 'li';
}) {
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
    whileInView: { opacity: 1, y: 0 },
    viewport: { once: true, amount },
    transition: { duration, delay, ease: [0.16, 1, 0.3, 1] },
  };
  if (className) props.className = className;
  if (style) props.style = style;
  return <M {...props}>{children}</M>;
}
