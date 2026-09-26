import { motion } from 'framer-motion';
import { motionOff } from './Presence.js';

/**
 * A 6px progress bar in the Ledger register. `value` is 0..1; `null` means indeterminate
 * (a short navy segment slides along the track). `label` renders under the bar in 12px.
 */
export function Progress({ value, label, className }: { value: number | null; label?: string; className?: string }) {
  const pct = value === null ? 0 : Math.max(0, Math.min(1, value)) * 100;
  const off = motionOff();
  return (
    <div className={`progress${value === null ? ' indeterminate' : ''}${className ? ` ${className}` : ''}`}>
      <div
        className="progress-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        {...(value === null ? {} : { 'aria-valuenow': Math.round(pct) })}
        {...(label ? { 'aria-label': label } : {})}
      >
        {value === null ? (
          <span className="progress-fill slide" />
        ) : off ? (
          <span className="progress-fill" style={{ width: `${pct}%` }} />
        ) : (
          <motion.span className="progress-fill" initial={false} animate={{ width: `${pct}%` }} transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }} />
        )}
      </div>
      {label && <span className="progress-label">{label}</span>}
    </div>
  );
}
