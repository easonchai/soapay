import { motion } from 'framer-motion';
import type { ReactNode } from 'react';

const CAP = 24;
const parent = { show: { transition: { staggerChildren: 0.02, delayChildren: 0.04 } } };
const item = { hidden: { opacity: 0, y: 6 }, show: { opacity: 1, y: 0, transition: { duration: 0.24, ease: [0.22, 1, 0.36, 1] } } };

/** Wrap a list; children rendered with StaggerItem rise in 20 ms apart (first 24 only). */
export function Stagger({ children, className, style, keyed }: { children: ReactNode; className?: string; style?: React.CSSProperties; keyed?: string | number }) {
  const props: Record<string, unknown> = { initial: 'hidden', animate: 'show', variants: parent };
  if (className) props.className = className;
  if (style) props.style = style;
  return (
    <motion.div key={keyed} {...(props as object)}>
      {children}
    </motion.div>
  );
}

export function StaggerItem({ children, index = 0, className, style, onClick }: { children: ReactNode; index?: number; className?: string; style?: React.CSSProperties; onClick?: () => void }) {
  const props: Record<string, unknown> = { variants: index < CAP ? item : undefined };
  if (className) props.className = className;
  if (style) props.style = style;
  if (onClick) props.onClick = onClick;
  return <motion.div {...(props as object)}>{children}</motion.div>;
}
