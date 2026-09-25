import { motion } from 'framer-motion';

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className={`toggle${on ? ' on' : ''}`} onClick={() => onChange(!on)}>
      <motion.span layout transition={{ type: 'spring', stiffness: 700, damping: 40 }} />
    </button>
  );
}
