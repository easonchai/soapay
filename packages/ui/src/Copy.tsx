import { useState } from 'react';

export function Copy({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [state, setState] = useState<'idle' | 'done' | 'failed'>('idle');
  return (
    <button
      type="button"
      className="btn-text btn-inline"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setState('done');
        } catch {
          setState('failed');
        }
        setTimeout(() => setState('idle'), 1400);
      }}
    >
      {state === 'done' ? 'Copied' : state === 'failed' ? 'Copy failed' : label}
    </button>
  );
}
