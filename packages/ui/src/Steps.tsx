export function Steps({ current, labels }: { current: number; labels: string[] }) {
  return (
    <ol className="steps" aria-label="Setup steps">
      {labels.map((label, i) => {
        const n = i + 1;
        const cls = n === current ? 'current' : n < current ? 'done' : undefined;
        return (
          <li key={label} className={cls} aria-current={n === current ? 'step' : undefined}>
            <span className="dot">{n < current ? '✓' : n}</span>
            <span className="label">{label}</span>
          </li>
        );
      })}
    </ol>
  );
}
