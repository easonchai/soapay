import { AnimatePresence, motion } from 'framer-motion';
import type { ReactNode } from 'react';

/** Height auto <-> 0 with a fade. Children unmount when closed. */
export function Collapse({ open, children, className }: { open: boolean; children: ReactNode; className?: string }) {
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          key="c"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ height: { duration: 0.28, ease: [0.22, 1, 0.36, 1] }, opacity: { duration: 0.18 } }}
          style={{ overflow: 'hidden' }}
          {...(className ? { className } : {})}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
