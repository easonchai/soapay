/** Deterministic 0..1 noise per grid cell, so a texture is stable between frames and renders. */
export const hash = (i: number, j: number) => {
  const s = Math.sin(i * 12.9898 + j * 78.233) * 43758.5453;
  return s - Math.floor(s);
};

/** True under prefers-reduced-motion or `?motion=off`. */
export function motionReduced(): boolean {
  return (
    typeof window !== 'undefined' &&
    (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || new URLSearchParams(window.location.search).get('motion') === 'off')
  );
}

export type Pointer = { x: number; y: number; k: number };

/** Size the backing store at 2× and return a context drawing in CSS pixels, or null when there is nothing to draw. */
export function prepare(c: HTMLCanvasElement, sized: { key: string }): { x: CanvasRenderingContext2D; W: number; H: number } | null {
  const W = c.offsetWidth;
  const H = c.offsetHeight;
  if (!W || !H) return null;
  const key = `${W}x${H}`;
  if (key !== sized.key) {
    sized.key = key;
    c.width = W * 2;
    c.height = H * 2;
  }
  const x = c.getContext('2d');
  if (!x) return null;
  x.setTransform(2, 0, 0, 2, 0, 0);
  x.clearRect(0, 0, W, H);
  return { x, W, H };
}

/**
 * Drives a dot texture: paints once, again after fonts settle, on resize, and (when `live`)
 * at ~30 fps while the canvas is on screen and the tab visible. Tracks the pointer in canvas
 * space, eased, with a strength `k` that fades after it leaves. Returns the cleanup.
 */
export function runDots(c: HTMLCanvasElement, live: boolean, paint: (t: number, ptr: Pointer, hover: boolean) => void): () => void {
  let raf = 0;
  let last = 0;
  let visible = true;
  const target = { x: -9999, y: -9999, on: false };
  const cur: Pointer = { x: -9999, y: -9999, k: 0 };

  const step = (t: number) => {
    if (cur.k === 0 && target.on) {
      cur.x = target.x;
      cur.y = target.y;
    }
    cur.x += (target.x - cur.x) * 0.18;
    cur.y += (target.y - cur.y) * 0.18;
    cur.k += ((target.on ? 1 : 0) - cur.k) * 0.08;
    paint(t, cur, live && cur.k > 0.01);
  };
  const frame = (t: number) => {
    if (!document.hidden && visible && t - last >= 33) {
      last = t;
      step(t);
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
  const now = () => (live ? performance.now() : 0);

  step(0);
  const t0 = window.setTimeout(() => step(now()), 300);
  const ro = new ResizeObserver(() => step(now()));
  ro.observe(c);
  // Off-screen canvases skip their frames (a long page can hold several animated textures).
  const io =
    live && typeof IntersectionObserver !== 'undefined'
      ? new IntersectionObserver((entries) => {
          for (const e of entries) visible = e.isIntersecting;
        })
      : null;
  io?.observe(c);
  if (live) {
    raf = requestAnimationFrame(frame);
    window.addEventListener('mousemove', onMove, { passive: true });
    window.addEventListener('mouseleave', onLeave);
    document.addEventListener('mouseleave', onLeave);
  }
  return () => {
    window.clearTimeout(t0);
    ro.disconnect();
    io?.disconnect();
    cancelAnimationFrame(raf);
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseleave', onLeave);
    document.removeEventListener('mouseleave', onLeave);
  };
}
