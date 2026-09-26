import { useEffect, useRef, useState, type RefObject } from 'react';
import { motionOff } from './Presence.js';

/** True while `ref` is at least `amount` visible. Always true when IntersectionObserver is missing (tests, old browsers). */
export function useVisible(ref: RefObject<Element | null>, amount = 0.25): boolean {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setSeen(true);
      return;
    }
    const io = new IntersectionObserver(([e]) => setSeen(Boolean(e?.isIntersecting)), { threshold: amount });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, amount]);
  return seen;
}

/**
 * Run `tick` every `periodMs` while `ref` is on screen and `enabled`. Off when motion is off.
 * `tick` is read through a ref, so callers may pass a fresh closure each render.
 */
export function useInViewLoop(ref: RefObject<Element | null>, periodMs: number, tick: () => void, enabled = true): boolean {
  const visible = useVisible(ref);
  const fn = useRef(tick);
  fn.current = tick;
  const on = visible && enabled && !motionOff();
  useEffect(() => {
    if (!on) return;
    const id = window.setInterval(() => fn.current(), periodMs);
    return () => window.clearInterval(id);
  }, [on, periodMs]);
  return visible;
}
