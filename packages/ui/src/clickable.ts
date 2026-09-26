import type { KeyboardEvent } from 'react';

/** Props that make a non-button element (a grid row, a panel) work as a button for keyboard and screen-reader users. */
export function clickable(onClick: () => void, expanded?: boolean) {
  return {
    role: 'button' as const,
    tabIndex: 0,
    onClick,
    onKeyDown: (e: KeyboardEvent) => {
      if (e.target !== e.currentTarget) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onClick();
      }
    },
    ...(expanded === undefined ? {} : { 'aria-expanded': expanded }),
  };
}
