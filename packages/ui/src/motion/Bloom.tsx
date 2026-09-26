import { motion } from 'framer-motion';
import { Dots, type DotsMode } from '../Dots.js';
import { motionOff } from './Presence.js';

export const BLOOM_IN_S = 2.4;
export const BLOOM_OUT_S = 1.1;

/**
 * A dot-matrix ring that blooms in on mount (scale 0.55 → 1 over 2.4 s) and, when `leaving`,
 * flows outward and fades. Position and size it with `className`; the canvas fills the box.
 * Static when motion is off.
 */
export function Bloom({
  className = 'halo',
  mode = 'diamond',
  opacity = 0.55,
  leaving = false,
  leaveDelay = 0,
}: {
  className?: string;
  mode?: DotsMode;
  opacity?: number;
  leaving?: boolean;
  leaveDelay?: number;
}) {
  if (motionOff()) {
    return (
      <div className={className} aria-hidden>
        <Dots mode={mode} className="dots" />
      </div>
    );
  }
  return (
    <motion.div
      className={className}
      aria-hidden
      initial={{ scale: 0.55, opacity: 0 }}
      animate={leaving ? { scale: 1.45, opacity: 0 } : { scale: 1, opacity }}
      transition={leaving ? { duration: BLOOM_OUT_S, delay: leaveDelay, ease: [0.4, 0, 0.6, 1] } : { duration: BLOOM_IN_S, ease: [0.16, 1, 0.3, 1] }}
    >
      <Dots mode={mode} animate className="dots" />
    </motion.div>
  );
}
