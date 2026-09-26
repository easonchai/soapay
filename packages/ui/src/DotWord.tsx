import { useEffect, useRef } from 'react';
import { WORD_GEOMETRY } from './logo/Logo.js';
import { hash, motionReduced, prepare, runDots } from './dots/shared.js';

type Mask = { key: string; solid: Uint8ClampedArray; halo: Uint8ClampedArray; W: number; H: number };

/** Rasterise the wordmark into `W×H`: a hard mask and a blurred one for the scatter around it. */
function buildMask(W: number, H: number): Mask | null {
  if (typeof Path2D === 'undefined') return null;
  const m = document.createElement('canvas');
  m.width = W;
  m.height = H;
  const g = m.getContext('2d');
  if (!g) return null;
  const { box, strokeWidth, strokes, circle, squares, squareAngle } = WORD_GEOMETRY;
  const s = Math.min(W / box.w, H / box.h);
  const ox = (W - box.w * s) / 2 - box.x * s;
  const oy = (H - box.h * s) / 2 - box.y * s;
  const draw = () => {
    g.setTransform(s, 0, 0, s, ox, oy);
    g.lineWidth = strokeWidth;
    g.lineCap = 'butt';
    g.lineJoin = 'miter';
    g.strokeStyle = '#000';
    g.fillStyle = '#000';
    for (const d of strokes) g.stroke(new Path2D(d));
    g.beginPath();
    g.arc(circle.cx, circle.cy, circle.r, 0, Math.PI * 2);
    g.stroke();
    for (const q of squares) {
      g.save();
      g.translate(q.x + q.s / 2, q.y + q.s / 2);
      g.rotate((squareAngle * Math.PI) / 180);
      g.fillRect(-q.s / 2, -q.s / 2, q.s, q.s);
      g.restore();
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
  };
  draw();
  const solid = g.getImageData(0, 0, W, H).data;
  g.clearRect(0, 0, W, H);
  g.filter = `blur(${Math.max(6, s * 9).toFixed(1)}px)`;
  draw();
  g.filter = 'none';
  const halo = g.getImageData(0, 0, W, H).data;
  return { key: `${W}x${H}`, solid, halo, W, H };
}

/**
 * The Soapay wordmark built from the dot texture: solid bars inside the letterforms, a sparse
 * scatter fading out around them. Same breathing and pointer response as `Dots`; static under
 * reduced motion. Give it a box with the wordmark's aspect (386:146) or it letterboxes.
 */
export function DotWord({
  color = '30,58,95',
  animate = false,
  title = 'Soapay',
  className,
  style,
}: {
  color?: string;
  animate?: boolean;
  title?: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const live = animate && !motionReduced();
    const sized = { key: '' };
    let mask: Mask | null = null;
    const sigma = 80;

    return runDots(c, live, (t, cur, hover) => {
      const p = prepare(c, sized);
      if (!p) return;
      const { x, W, H } = p;
      if (!mask || mask.key !== sized.key) mask = buildMask(W, H);
      if (!mask) return;
      // finer grid on a small canvas so the letters stay legible
      const cell = W >= 720 ? 6 : W >= 420 ? 5 : 4;
      const at = (data: Uint8ClampedArray, i: number, j: number) => {
        const px = Math.min(W - 1, i + 1);
        const py = Math.min(H - 1, j + 1);
        return data[(py * W + px) * 4 + 3]! / 255;
      };
      for (let i = 0; i < W; i += cell) {
        for (let j = 0; j < H; j += cell) {
          const h = hash(i, j);
          const inside = at(mask.solid, i, j) > 0.5;
          let alpha: number;
          let len: number;
          if (inside) {
            const pulse = live ? 0.5 + 0.5 * Math.sin(t / (9000 + 7000 * h) + h * Math.PI * 2) : 0.5;
            alpha = 0.72 + 0.26 * pulse;
            len = cell + 1;
          } else {
            const glow = at(mask.halo, i, j);
            if (glow < 0.04 || h > glow * 0.6) continue;
            const pulse = live ? 0.5 + 0.5 * Math.sin(t / (8000 + 8000 * h) + h * Math.PI * 2) : 0.5;
            alpha = 0.1 + 0.5 * glow * (0.5 + pulse);
            len = 2 + glow * 4 * (0.5 + pulse);
          }
          let ox = 0;
          let oy = 0;
          if (hover) {
            const dx = i - cur.x;
            const dy = j - cur.y;
            const dist = Math.hypot(dx, dy) || 1;
            const inf = Math.exp(-(dist * dist) / (2 * sigma * sigma)) * cur.k;
            if (inf > 0.01) {
              alpha += 0.4 * inf;
              len *= 1 + 0.9 * inf;
              const push = 8 * inf;
              ox = (dx / dist) * push;
              oy = (dy / dist) * push;
            }
          }
          const L = Math.max(2, Math.round(len));
          x.fillStyle = `rgba(${color},${Math.min(0.98, alpha).toFixed(2)})`;
          x.fillRect(i + ox, j + oy - (L - 2) / 2, 2, L);
        }
      }
    });
  }, [color, animate]);
  return <canvas ref={ref} className={`dotword${className ? ` ${className}` : ''}`} style={style} role="img" aria-label={title} />;
}
