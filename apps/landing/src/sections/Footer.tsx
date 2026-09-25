import { GITHUB } from '../links.js';

export function Footer() {
  return (
    <footer className="l-footer">
      Built on ERC-5564 and ERC-6538 on Base. Open source on{' '}
      <a href={GITHUB} target="_blank" rel="noreferrer">
        GitHub
      </a>
      .
    </footer>
  );
}
