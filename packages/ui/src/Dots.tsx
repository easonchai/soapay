import { useEffect, useRef } from 'react';
import { hash, motionReduced, prepare, runDots } from './dots/shared.js';

export type DotsMode = 'right' | 'diamond' | 'field' | 'rule' | 'wave';

/**
 * Dot-matrix texture from the design package. Static by default. With `animate`, dots breathe
 * slowly (10–18 s cycles), the diamond ring swells ±6 %, the wave rolls like an audio level
 * meter, and the pointer pushes dots aside and lights them up within ~90 px. ~30 fps, paused
 * while the tab is hidden, off under prefers-reduced-motion.
 */
export function Dots({
  mode = 'right',
  color = '30,58,95',
  animate = false,
  minWidth = 0,
  className,
  style,
}: {
  mode?: DotsMode;
  color?: string;
  animate?: boolean;
  /** Draw nothing when the canvas is narrower than this (avoids a stray blob in tight headers). */
  minWidth?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const live = animate && !motionReduced();
    const sized = { key: '' };
    const sigma = 90;

    return runDots(c, live, (t, cur, hover) => {
      if (c.offsetWidth < minWidth) {
        c.getContext('2d')?.clearRect(0, 0, c.width, c.height);
        sized.key = '';
        return;
      }
      const p = prepare(c, sized);
      if (!p) return;
      const { x, W, H } = p;
      const cell = 6;
      const cx = W / 2;
      const cy = H / 2;
      const tt = live ? t : 0;
      // ring breathes ±6% over ~14s
      const breath = live ? 1 + 0.06 * Math.sin(t / 2200) : 1;
      const R = Math.min(W, H) * 0.46 * breath;
      for (let i = 0; i < W; i += cell) {
        // wave: one level per column, like an audio meter. Two slow travelling bands set the
        // swell, a per-column spike flickers at its own rate, and the whole thing thins out
        // toward the sides.
        let env = 0;
        let horiz = 0;
        if (mode === 'wave') {
          const u = (i - cx) / cx;
          horiz = Math.pow(Math.max(0, 1 - u * u), 1.4);
          const col = hash(i, 1);
          const col2 = hash(i, 2);
          const w1 = 0.5 + 0.5 * Math.sin(i / 30 - tt / 650);
          const w2 = 0.5 + 0.5 * Math.sin(i / 9 + tt / 900 + col * 6.3);
          const flick = 0.5 + 0.5 * Math.sin(tt / (260 + 520 * col2) + col * 25);
          const spike = Math.pow(col, 1.25) * flick;
          env = horiz * Math.min(1, 0.12 + 0.4 * w1 + 0.3 * w2 + 0.95 * spike);
        }
        for (let j = 0; j < H; j += cell) {
          let a = 0;
          let core = 0;
          if (mode === 'diamond') {
            const d = Math.abs(Math.abs(i - cx) + Math.abs(j - cy) - R);
            a = Math.max(0, 1 - d / (R * 0.4));
          } else if (mode === 'field') a = Math.max(0, 1 - Math.hypot(((i - cx) / W) * 2, ((j - cy) / H) * 2));
          else if (mode === 'right') a = Math.max(0, (i / W - 0.3) / 0.7);
          else if (mode === 'wave') {
            const v = Math.abs(j - cy) / cy;
            // the level fades with the envelope too, so a quiet column is a faint tick, not a full bar
            core = env > 0 ? Math.max(0, 1 - v / env) * Math.min(1, env / 0.14) : 0;
            const scatter = 0.3 * Math.sqrt(horiz) * Math.max(0, 1 - v * v * 0.85);
            a = Math.min(1, core + scatter);
          } else a = 0.55;
          const h = hash(i, j);
          if (h > a * (mode === 'wave' ? 1.15 : 0.9)) continue;
          // slow per-dot pulse, period 10–18 s, phase from the hash
          const pulse = live ? 0.5 + 0.5 * Math.sin(t / (10000 + 8000 * h) + h * Math.PI * 2) : 0.5;
          let alpha = 0.22 + 0.7 * h * (0.45 + 1.1 * pulse);
          let len = 2 + h * 7 * (0.45 + 1.1 * pulse);
          if (mode === 'wave') {
            // inside the envelope: bars stack into solid columns; outside: a short, faint scatter
            const inside = core > 0.02;
            alpha = inside ? 0.3 + 0.66 * core : 0.14 + 0.3 * h * (0.6 + 0.8 * pulse);
            len = inside ? 2 + core * (cell + 4) : 2;
          }
          let ox = 0;
          let oy = 0;
          if (hover) {
            const dx = i - cur.x;
            const dy = j - cur.y;
            const dist = Math.hypot(dx, dy) || 1;
            const inf = Math.exp(-(dist * dist) / (2 * sigma * sigma)) * cur.k;
            if (inf > 0.01) {
              alpha += 0.55 * inf;
              len *= 1 + 1.6 * inf;
              const push = 10 * inf;
              ox = (dx / dist) * push;
              oy = (dy / dist) * push;
            }
          }
          const L = Math.max(2, Math.round(len));
          x.fillStyle = `rgba(${color},${Math.min(0.96, alpha).toFixed(2)})`;
          x.fillRect(i + ox, j + oy - (L - 2) / 2, 2, L);
        }
      }
    });
  }, [mode, color, animate, minWidth]);
  return <canvas ref={ref} className={`dots${className ? ` ${className}` : ''}`} style={style} aria-hidden />;
}
