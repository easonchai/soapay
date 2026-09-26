/** Outlined navy square: a fresh address, used once, never seen on chain before. */
export function FreshMark() {
  return <span className="fresh" title="Fresh address — used once, never seen on chain before" />;
}
export function FreshLegend() {
  return (
    <span className="legend">
      <span className="fresh" />
      fresh address, used once
    </span>
  );
}
