import { useEffect, useRef } from 'react';

export type DotsMode = 'right' | 'diamond' | 'field' | 'rule';

const hash = (i: number, j: number) => {
  const s = Math.sin(i * 12.9898 + j * 78.233) * 43758.5453;
  return s - Math.floor(s);
};

/**
 * Dot-matrix texture from the design package. Static by default. With `animate`, dots breathe
 * slowly (10–18 s cycles), the diamond ring swells ±6 %, and the pointer pushes dots aside and
 * lights them up within ~90 px. ~30 fps, paused while the tab is hidden, off under
 * prefers-reduced-motion.
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
    const reduce =
      typeof window !== 'undefined' &&
      (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || new URLSearchParams(window.location.search).get('motion') === 'off');
    const live = animate && !reduce;
    let raf = 0;
    let last = 0;
    let size = '';
    // pointer: target from events, current eased toward it; strength fades when the pointer leaves
    const target = { x: -9999, y: -9999, on: false };
    const cur = { x: -9999, y: -9999, k: 0 };

    const paint = (t: number) => {
      const W = c.offsetWidth;
      const H = c.offsetHeight;
      if (!W || !H) return;
      if (W < minWidth) {
        const ctx = c.getContext('2d');
        ctx?.clearRect(0, 0, c.width, c.height);
        size = '';
        return;
      }
      const key = `${W}x${H}`;
      if (key !== size) {
        size = key;
        c.width = W * 2;
        c.height = H * 2;
      }
      const x = c.getContext('2d');
      if (!x) return;
      x.setTransform(2, 0, 0, 2, 0, 0);
      x.clearRect(0, 0, W, H);

      // ease the pointer
      if (cur.k === 0 && target.on) {
        cur.x = target.x;
        cur.y = target.y;
      }
      cur.x += (target.x - cur.x) * 0.18;
      cur.y += (target.y - cur.y) * 0.18;
      cur.k += ((target.on ? 1 : 0) - cur.k) * 0.08;
      const sigma = 90;
      const hover = live && cur.k > 0.01;

      const cell = 6;
      const cx = W / 2;
      const cy = H / 2;
      // ring breathes ±6% over ~14s
      const breath = live ? 1 + 0.06 * Math.sin(t / 2200) : 1;
      const R = Math.min(W, H) * 0.46 * breath;
      for (let i = 0; i < W; i += cell) {
        for (let j = 0; j < H; j += cell) {
          let a = 0;
          if (mode === 'diamond') {
            const d = Math.abs(Math.abs(i - cx) + Math.abs(j - cy) - R);
            a = Math.max(0, 1 - d / (R * 0.4));
          } else if (mode === 'field') a = Math.max(0, 1 - Math.hypot(((i - cx) / W) * 2, ((j - cy) / H) * 2));
          else if (mode === 'right') a = Math.max(0, (i / W - 0.3) / 0.7);
          else a = 0.55;
          const h = hash(i, j);
          if (h > a * 0.9) continue;
          // slow per-dot pulse, period 10–18 s, phase from the hash
          const p = live ? 0.5 + 0.5 * Math.sin(t / (10000 + 8000 * h) + h * Math.PI * 2) : 0.5;
          let alpha = 0.22 + 0.7 * h * (0.45 + 1.1 * p);
          let len = 2 + h * 7 * (0.45 + 1.1 * p);
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
    };

    const frame = (t: number) => {
      if (!document.hidden && t - last >= 33) {
        last = t;
        paint(t);
      }
      raf = requestAnimationFrame(frame);
    };
    const onMove = (e: MouseEvent) => {
      const r = c.getBoundingClientRect();
      const px = e.clientX - r.left;
      const py = e.clientY - r.top;
      const inside = px >= -40 && py >= -40 && px <= r.width + 40 && py <= r.height + 40;
      target.on = inside;
      if (inside) {
        target.x = px;
        target.y = py;
      }
    };
    const onLeave = () => {
      target.on = false;
    };

    paint(0);
    const t0 = window.setTimeout(() => paint(live ? performance.now() : 0), 300);
    const ro = new ResizeObserver(() => paint(live ? performance.now() : 0));
    ro.observe(c);
    if (live) {
      raf = requestAnimationFrame(frame);
      window.addEventListener('mousemove', onMove, { passive: true });
      window.addEventListener('mouseleave', onLeave);
      document.addEventListener('mouseleave', onLeave);
    }
    return () => {
      window.clearTimeout(t0);
      ro.disconnect();
      cancelAnimationFrame(raf);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseleave', onLeave);
      document.removeEventListener('mouseleave', onLeave);
    };
  }, [mode, color, animate, minWidth]);
  return <canvas ref={ref} className={`dots${className ? ` ${className}` : ''}`} style={style} aria-hidden />;
}
