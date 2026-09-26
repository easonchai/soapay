export type Tone = 'ok' | 'warn' | 'danger' | 'muted' | 'accent';

/** Status pill. The system uses pills sparingly: amber for "not yet real", red for errors. */
export function Pill({ tone = 'muted', children }: { tone?: Tone; dot?: boolean; children: React.ReactNode }) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}
