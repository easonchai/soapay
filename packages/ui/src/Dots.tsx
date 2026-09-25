import { useEffect, useRef } from 'react';

export type DotsMode = 'right' | 'diamond' | 'field' | 'rule';

const hash = (i: number, j: number) => {
  const s = Math.sin(i * 12.9898 + j * 78.233) * 43758.5453;
  return s - Math.floor(s);
};

/**
 * Dot-matrix texture from the design package. Static by default. With `animate`, each dot
 * breathes on its own slow cycle and the diamond ring swells a few percent, paused while the
 * tab is hidden and disabled under prefers-reduced-motion.
 */
export function Dots({
  mode = 'right',
  color = '30,58,95',
  animate = false,
  className,
  style,
}: {
  mode?: DotsMode;
  color?: string;
  animate?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const live = animate && !reduce;
    let raf = 0;
    let last = 0;
    let size = '';

    const paint = (t: number) => {
      const W = c.offsetWidth;
      const H = c.offsetHeight;
      if (!W || !H) return;
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
      const cell = 6;
      const cx = W / 2;
      const cy = H / 2;
      // ring breathes ±3% over ~9s
      const breath = live ? 1 + 0.03 * Math.sin(t / 1400) : 1;
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
          // per-dot slow pulse: phase from the hash, period 4–7s
          const p = live ? 0.5 + 0.5 * Math.sin(t / (4000 + 3000 * h) + h * Math.PI * 2) : 0.5;
          const alpha = 0.3 + 0.6 * h * (0.7 + 0.6 * p);
          const len = 2 + Math.round(h * 7 * (0.75 + 0.5 * p));
          x.fillStyle = `rgba(${color},${Math.min(0.95, alpha).toFixed(2)})`;
          x.fillRect(i, j - (len - (2 + Math.round(h * 7))) / 2, 2, len);
        }
      }
    };

    const frame = (t: number) => {
      if (document.hidden) {
        raf = requestAnimationFrame(frame);
        return;
      }
      if (t - last >= 33) {
        last = t;
        paint(t);
      }
      raf = requestAnimationFrame(frame);
    };

    paint(0);
    const t0 = window.setTimeout(() => paint(0), 300);
    const ro = new ResizeObserver(() => paint(live ? performance.now() : 0));
    ro.observe(c);
    if (live) raf = requestAnimationFrame(frame);
    return () => {
      window.clearTimeout(t0);
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [mode, color, animate]);
  return <canvas ref={ref} className={`dots${className ? ` ${className}` : ''}`} style={style} aria-hidden />;
}
