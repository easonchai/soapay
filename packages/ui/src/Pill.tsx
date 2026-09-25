export type Tone = 'ok' | 'warn' | 'danger' | 'muted' | 'accent';

export function Pill({ tone = 'muted', dot, children }: { tone?: Tone; dot?: boolean; children: React.ReactNode }) {
  return (
    <span className={`pill pill-${tone}`}>
      {dot && <span className="dot" aria-hidden />}
      {children}
    </span>
  );
}
