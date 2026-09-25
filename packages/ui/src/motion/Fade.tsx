import { motion, type MotionStyle } from 'framer-motion';
import type { ReactNode } from 'react';
import { motionOff } from './Presence.js';

/** Fade + small slide on mount/unmount. Plain div when motion is off. Use inside Presence for exits. */
export function Fade({
  children,
  x = 0,
  y = 0,
  duration = 0.2,
  className,
  style,
}: {
  children: ReactNode;
  x?: number;
  y?: number;
  duration?: number;
  className?: string;
  style?: MotionStyle;
}) {
  if (motionOff()) {
    return (
      <div {...(className ? { className } : {})} {...(style ? { style: style as React.CSSProperties } : {})}>
        {children}
      </div>
    );
  }
  return (
    <motion.div
      initial={{ opacity: 0, x, y }}
      animate={{ opacity: 1, x: 0, y: 0 }}
      exit={{ opacity: 0, x: x ? x / 2 : 0, y: y ? -y / 2 : 0 }}
      transition={{ duration, ease: [0.22, 1, 0.36, 1] }}
      {...(className ? { className } : {})}
      {...(style ? { style } : {})}
    >
      {children}
    </motion.div>
  );
}
