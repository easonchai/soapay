/**
 * Setup stepper: numbered squares joined by a track whose fill follows the current step.
 * `current` is 1-based. Done steps show a check; the current one pulses.
 */
export function Steps({ current, labels }: { current: number; labels: string[] }) {
  const n = labels.length;
  const fill = n > 1 ? ((Math.min(Math.max(current, 1), n) - 1) / (n - 1)) * 100 : 0;
  return (
    <ol className="steps" aria-label="Setup steps" style={{ ['--steps-fill' as string]: `${fill}%` }}>
      <span className="steps-track" aria-hidden>
        <span className="steps-fill" />
      </span>
      {labels.map((label, i) => {
        const k = i + 1;
        const cls = k === current ? 'current' : k < current ? 'done' : undefined;
        return (
          <li key={label} className={cls} aria-current={k === current ? 'step' : undefined}>
            <span className={`dot${k === current ? ' pulse' : ''}`}>{k < current ? '✓' : k}</span>
            <span className="label">{label}</span>
          </li>
        );
      })}
    </ol>
  );
}
