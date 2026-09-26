import { animate, useMotionValue, useReducedMotion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { motionOff } from './Presence.js';

/**
 * Tweens between numeric values; `format` renders the current number. Numbers are passed as
 * plain floats (already scaled from base units by the caller).
 */
export function CountUp({ value, format, duration = 0.6, className }: { value: number; format: (n: number) => string; duration?: number; className?: string }) {
  const reduce = useReducedMotion() || motionOff();
  const mv = useMotionValue(value);
  const [text, setText] = useState(() => format(value));
  useEffect(() => {
    if (reduce) {
      mv.set(value);
      setText(format(value));
      return;
    }
    const controls = animate(mv, value, { duration, ease: [0.22, 1, 0.36, 1], onUpdate: (v) => setText(format(v)) });
    return () => controls.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, reduce]);
  return <span className={className}>{text}</span>;
}
