type DotFieldOptions = {
  word: string;
  /** "r,g,b" for the bars; defaults to the diamonds' navy. */
  color?: string;
  /** False under reduced motion: one still frame, no breathing, no pointer. */
  live: boolean;
  /** Called after the first frame has been painted, so the caller can hide the plain text. */
  onReady?: () => void;
};

export type DotFieldController = {
  destroy(): void;
};

const CELL = 6;
const BLEED = 16;
const SIGMA = 72;
const COVERAGE_TAPS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [3, 0],
  [-3, 0],
  [0, 3],
  [0, -3],
];

const hash = (i: number, j: number) => {
  const s = Math.sin(i * 12.9898 + j * 78.233) * 43758.5453;
  return s - Math.floor(s);
};

/**
 * Draws `word` out of the same breathing, cursor-reactive bars as the hero diamonds (packages/ui Dots),
 * sampled from the span's own font so it sits exactly where the text does. Returns null when the
 * canvas cannot paint (jsdom), so the caller keeps the plain text visible.
 */
export function mountDotField(span: HTMLSpanElement, canvas: HTMLCanvasElement, opts: DotFieldOptions): DotFieldController | null {
  const ctx = canvas.getContext("2d");
  const sampleCanvas = document.createElement("canvas");
  const sampleCtx = sampleCanvas.getContext("2d");
  if (!ctx || !sampleCtx) return null;

  const color = opts.color ?? "30,58,95";
  // pointer: target from events, current eased toward it; strength fades when the pointer leaves
  const target = { x: -9999, y: -9999, on: false };
  const cur = { x: -9999, y: -9999, k: 0 };
  // Glyph raster at 2x; the grid samples it every frame so the shape can swell like the diamond ring.
  let pixels: Uint8ClampedArray | null = null;
  let rasterWidth = 0;
  let rasterHeight = 0;
  let width = 0;
  let height = 0;
  let destroyed = false;
  let ready = false;
  let visible = true;
  let raf = 0;
  let lastPaint = 0;

  // Soft glyph coverage at a point, averaged over a small cross so edges fade like the ring's band.
  const coverage = (x: number, y: number) => {
    if (!pixels) return 0;
    let sum = 0;
    for (const [dx, dy] of COVERAGE_TAPS) {
      const px = Math.round((x + dx) * 2);
      const py = Math.round((y + dy) * 2);
      if (px < 0 || py < 0 || px >= rasterWidth || py >= rasterHeight) continue;
      sum += pixels[(py * rasterWidth + px) * 4 + 3] ?? 0;
    }
    return sum / (255 * COVERAGE_TAPS.length);
  };

  const paint = (t: number) => {
    if (!width || !height || !pixels) return;
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    ctx.clearRect(0, 0, width + BLEED * 2, height + BLEED * 2);
    const hover = opts.live && cur.k > 0.01;
    // The glyphs swell 6% over ~14 s under a fixed grid (same as the diamond ring), so edge dots flicker in and out.
    const breath = opts.live ? 1 + 0.06 * Math.sin(t / 2200) : 1;
    const cx = width / 2;
    const cy = height / 2;
    let drawn = 0;
    for (let i = 0; i < width; i += CELL) {
      for (let j = 0; j < height; j += CELL) {
        const a = coverage(cx + (i - cx) / breath, cy + (j - cy) / breath);
        if (a <= 0.02) continue;
        const h = hash(i, j);
        if (h > a * 0.9) continue;
        // slow per-dot pulse, period 10 to 18 s, phase from the hash (same as Dots)
        const p = opts.live ? 0.5 + 0.5 * Math.sin(t / (10000 + 8000 * h) + h * Math.PI * 2) : 0.5;
        let alpha = 0.22 + 0.7 * h * (0.45 + 1.1 * p);
        let len = 2 + h * 7 * (0.45 + 1.1 * p);
        let ox = 0;
        let oy = 0;
        if (hover) {
          const dx = i - cur.x;
          const dy = j - cur.y;
          const dist = Math.hypot(dx, dy) || 1;
          const inf = Math.exp(-(dist * dist) / (2 * SIGMA * SIGMA)) * cur.k;
          if (inf > 0.01) {
            alpha += 0.55 * inf;
            len *= 1 + 1.6 * inf;
            const push = 10 * inf;
            ox = (dx / dist) * push;
            oy = (dy / dist) * push;
          }
        }
        const length = Math.max(2, Math.round(len));
        ctx.fillStyle = `rgba(${color},${Math.min(0.96, alpha).toFixed(2)})`;
        ctx.fillRect(BLEED + i + ox, BLEED + j + oy - (length - 2) / 2, 2, length);
        drawn += 1;
      }
    }
    if (!ready && drawn) {
      ready = true;
      opts.onReady?.();
    }
  };

  // Rasterise the word with the span's computed font; paint() then reads it through the 6px grid.
  const sample = () => {
    if (destroyed) return;
    const nextWidth = span.offsetWidth;
    const nextHeight = span.offsetHeight;
    if (!nextWidth || !nextHeight) return;
    width = nextWidth;
    height = nextHeight;
    canvas.width = (width + BLEED * 2) * 2;
    canvas.height = (height + BLEED * 2) * 2;
    sampleCanvas.width = width * 2;
    sampleCanvas.height = height * 2;

    const style = getComputedStyle(span);
    const letterSpacing = Number.parseFloat(style.letterSpacing) || 0;
    sampleCtx.setTransform(2, 0, 0, 2, 0, 0);
    sampleCtx.clearRect(0, 0, width, height);
    sampleCtx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    sampleCtx.textBaseline = "alphabetic";
    sampleCtx.fillStyle = "#000";
    // The inline box is 0.98em tall; the baseline sits near 80% of it for Plex Sans at this weight.
    const baseline = height * 0.8;
    let x = 0;
    for (const character of opts.word) {
      sampleCtx.fillText(character, x, baseline);
      x += sampleCtx.measureText(character).width + letterSpacing;
    }

    pixels = sampleCtx.getImageData(0, 0, sampleCanvas.width, sampleCanvas.height).data;
    rasterWidth = sampleCanvas.width;
    rasterHeight = sampleCanvas.height;
    paint(opts.live ? performance.now() : 0);
  };

  const frame = (t: number) => {
    if (destroyed) return;
    if (!document.hidden && visible) {
      if (cur.k === 0 && target.on) {
        cur.x = target.x;
        cur.y = target.y;
      }
      cur.x += (target.x - cur.x) * 0.18;
      cur.y += (target.y - cur.y) * 0.18;
      cur.k += ((target.on ? 1 : 0) - cur.k) * 0.08;
      if (t - lastPaint >= 33) {
        lastPaint = t;
        paint(t);
      }
    }
    raf = requestAnimationFrame(frame);
  };

  const onMove = (event: MouseEvent) => {
    const rect = span.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const inside = x >= -40 && y >= -40 && x <= rect.width + 40 && y <= rect.height + 40;
    target.on = inside;
    if (inside) {
      target.x = x;
      target.y = y;
    }
  };
  const onLeave = () => {
    target.on = false;
  };

  // Fonts decide the glyph shapes, so sampling waits for them (jsdom has no document.fonts).
  const fontsReady: Promise<unknown> = document.fonts?.ready ?? Promise.resolve();
  const resizeObserver = new ResizeObserver(() => {
    void fontsReady.then(sample);
  });
  resizeObserver.observe(span);
  void fontsReady.then(sample);
  // Off-screen, the frame loop idles (the hero scrolls away on a long page).
  const io =
    opts.live && typeof IntersectionObserver !== "undefined"
      ? new IntersectionObserver((entries) => {
          for (const entry of entries) visible = entry.isIntersecting;
        })
      : null;
  io?.observe(canvas);
  if (opts.live) {
    raf = requestAnimationFrame(frame);
    window.addEventListener("mousemove", onMove, { passive: true });
    window.addEventListener("mouseleave", onLeave);
    document.addEventListener("mouseleave", onLeave);
  }

  return {
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      io?.disconnect();
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseleave", onLeave);
      document.removeEventListener("mouseleave", onLeave);
    },
  };
}
