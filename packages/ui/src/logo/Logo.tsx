import type { CSSProperties } from 'react';

/**
 * Soapay logo, from the brand package (packages/ui/assets). Colour comes from `currentColor`,
 * so set `color` on a parent for the navy (#1E3A5F), ink (#0F1720) or white variants.
 */
const MARK = (
  <>
    <path d="M3 12 a5 5 0 0 1 5 -5 h9 v18 h-9 a5 5 0 0 1 -5 -5 z" fill="currentColor" />
    <g fill="currentColor">
      <rect x="19.5" y="8" width="4" height="4" rx="1.4" />
      <rect x="19.5" y="14" width="4" height="4" rx="1.4" />
      <rect x="19.5" y="20" width="4" height="4" rx="1.4" />
      <rect x="25.5" y="11" width="2.5" height="2.5" rx="0.9" />
      <rect x="25.5" y="18.5" width="2.5" height="2.5" rx="0.9" />
      <rect x="29.5" y="15" width="1.5" height="1.5" rx="0.55" />
    </g>
  </>
);

const WORD = (
  <>
    <g fill="none" stroke="currentColor" strokeWidth="12" strokeLinecap="butt" strokeLinejoin="miter">
      <path d="M50 14 C42 4 10 4 10 24 C10 44 50 42 50 62 C50 82 14 84 4 70" />
      <circle cx="92" cy="52" r="22" />
      <path d="M150 30 H172 V74 H150 A22 22 0 0 1 150 30 Z" />
      <path d="M192 30 V112" />
      <path d="M192 30 H214 A22 22 0 0 1 214 74 H192" />
      <path d="M278 30 H300 V74 H278 A22 22 0 0 1 278 30 Z" />
      <path d="M320 30 L342 74" />
      <path d="M366 30 L336 88" />
    </g>
    <g fill="currentColor">
      <rect x="328.8" y="91.6" width="7" height="7" transform="rotate(27 332.3 95.1)" />
      <rect x="324.55" y="102.15" width="5.5" height="5.5" transform="rotate(27 327.3 104.9)" />
      <rect x="320.7" y="111.8" width="4" height="4" transform="rotate(27 322.7 113.8)" />
      <rect x="317.1" y="120.2" width="3" height="3" transform="rotate(27 318.6 121.7)" />
      <rect x="313.9" y="127.8" width="2" height="2" transform="rotate(27 314.9 128.8)" />
    </g>
  </>
);

export function Mark({ size = 16, style, title = 'Soapay' }: { size?: number; style?: CSSProperties; title?: string }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} style={{ display: 'block', flex: '0 0 auto', ...style }} role="img" aria-label={title}>
      {MARK}
    </svg>
  );
}

/** Wordmark alone. Height in px; width follows the 386:146 box. */
export function Wordmark({ height = 16, style, title = 'Soapay' }: { height?: number; style?: CSSProperties; title?: string }) {
  return (
    <svg viewBox="-8 -8 386 146" height={height} width={(height * 386) / 146} style={{ display: 'block', ...style }} role="img" aria-label={title}>
      {WORD}
    </svg>
  );
}

/** Mark + wordmark lockup. Height in px; width follows the 552:146 box. */
export function Lockup({ height = 24, style, title = 'Soapay' }: { height?: number; style?: CSSProperties; title?: string }) {
  return (
    <svg viewBox="-8 -8 552 146" height={height} width={(height * 552) / 146} style={{ display: 'block', ...style }} role="img" aria-label={title}>
      <g transform="translate(-8,-36) scale(4.875)">{MARK}</g>
      <g transform="translate(158,0)">{WORD}</g>
    </svg>
  );
}

/**
 * The mark as a loader: its dots light up in a wave from the tab outward. CSS-driven
 * (`.logo-loader` in styles.css), so it obeys reduced-motion and data-motion=off.
 */
export function LogoLoader({ size = 40, label = 'Loading', style }: { size?: number; label?: string; style?: CSSProperties }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} className="logo-loader" role="img" aria-label={label} style={{ display: 'block', ...style }}>
      <path className="ld-tab" d="M3 12 a5 5 0 0 1 5 -5 h9 v18 h-9 a5 5 0 0 1 -5 -5 z" fill="currentColor" />
      <g fill="currentColor">
        <rect className="ld d1" x="19.5" y="8" width="4" height="4" rx="1.4" />
        <rect className="ld d1" x="19.5" y="14" width="4" height="4" rx="1.4" />
        <rect className="ld d1" x="19.5" y="20" width="4" height="4" rx="1.4" />
        <rect className="ld d2" x="25.5" y="11" width="2.5" height="2.5" rx="0.9" />
        <rect className="ld d2" x="25.5" y="18.5" width="2.5" height="2.5" rx="0.9" />
        <rect className="ld d3" x="29.5" y="15" width="1.5" height="1.5" rx="0.55" />
      </g>
    </svg>
  );
}

/** Centered loader with an optional line under it. */
export function Loading({ label = 'Loading…', size = 40 }: { label?: string; size?: number }) {
  return (
    <div className="loading" role="status" aria-live="polite">
      <LogoLoader size={size} label={label} />
      <span className="loading-label">{label}</span>
    </div>
  );
}
