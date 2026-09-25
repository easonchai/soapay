import { motion, useInView, useReducedMotion, type MotionStyle } from 'framer-motion';
import { useRef, type ReactNode } from 'react';

/** Fade + rise once when scrolled into view, as in the brief. Off under reduced motion. */
export function Reveal({
  children,
  y = 40,
  x = 0,
  delay = 0,
  duration = 0.8,
  className,
  style,
}: {
  children: ReactNode;
  y?: number;
  x?: number;
  delay?: number;
  duration?: number;
  className?: string | undefined;
  style?: MotionStyle | undefined;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-100px' });
  const reduce = useReducedMotion();
  const hidden = reduce ? { opacity: 1, x: 0, y: 0 } : { opacity: 0, x, y };
  return (
    <motion.div
      ref={ref}
      {...(className ? { className } : {})}
      {...(style ? { style } : {})}
      initial={hidden}
      animate={inView ? { opacity: 1, x: 0, y: 0 } : hidden}
      transition={{ duration, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}
