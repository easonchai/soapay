import { useState } from 'react';

export function Copy({ value, label = 'Copy', onCopied }: { value: string; label?: string; onCopied?: () => void }) {
  const [state, setState] = useState<'idle' | 'done' | 'failed'>('idle');
  return (
    <button
      type="button"
      className="btn-text btn-inline"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setState('done');
          onCopied?.();
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
