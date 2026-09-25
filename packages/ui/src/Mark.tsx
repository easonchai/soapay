/** Soapay mark: outlined square with a navy inset. */
export function Mark({ large }: { large?: boolean }) {
  return <span className={large ? 'mark mark-lg' : 'mark'} aria-hidden />;
}
