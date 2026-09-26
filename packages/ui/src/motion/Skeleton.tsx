/** Shimmer bar for a pending value. Width in px or CSS length. */
export function Skeleton({ width = 56, height = 12, className }: { width?: number | string; height?: number; className?: string }) {
  return <span className={`skeleton${className ? ` ${className}` : ''}`} style={{ width, height }} aria-hidden />;
}
