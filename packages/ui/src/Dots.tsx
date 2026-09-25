import { useEffect, useRef } from 'react';

export type DotsMode = 'right' | 'diamond' | 'field' | 'rule';

/** Dot-matrix texture from the design package. Static; drawn once per size. */
export function Dots({ mode = 'right', color = '30,58,95', className, style }: { mode?: DotsMode; color?: string; className?: string; style?: React.CSSProperties }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const paint = () => {
      const W = c.offsetWidth;
      const H = c.offsetHeight;
      if (!W || !H) return;
      const key = `${W}x${H}`;
      if (c.dataset.painted === key) return;
      c.dataset.painted = key;
      c.width = W * 2;
      c.height = H * 2;
      const x = c.getContext('2d');
      if (!x) return;
      x.scale(2, 2);
      const cell = 6;
      const cx = W / 2;
      const cy = H / 2;
      const R = Math.min(W, H) * 0.46;
      const hash = (i: number, j: number) => {
        const s = Math.sin(i * 12.9898 + j * 78.233) * 43758.5453;
        return s - Math.floor(s);
      };
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
          x.fillStyle = `rgba(${color},${(0.3 + 0.6 * h).toFixed(2)})`;
          x.fillRect(i, j, 2, 2 + Math.round(h * 7));
        }
      }
    };
    paint();
    const t = window.setTimeout(paint, 300);
    const ro = new ResizeObserver(paint);
    ro.observe(c);
    return () => {
      window.clearTimeout(t);
      ro.disconnect();
    };
  }, [mode, color]);
  return <canvas ref={ref} className={`dots${className ? ` ${className}` : ''}`} style={style} aria-hidden />;
}
