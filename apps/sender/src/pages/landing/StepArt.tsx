type StepArtProps = { step: 1 | 2 | 3 };

const artProps = {
  className: "how-art",
  viewBox: "0 0 240 72",
  role: "img",
  fill: "none",
  stroke: "var(--accent)",
  strokeWidth: 1.25,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const textStyle = { fontFamily: "var(--mono)", fill: "var(--ink)" };

/** Line-art explanation for one step in the private payment sequence. */
export function StepArt({ step }: StepArtProps) {
  if (step === 1) {
    return (
      <svg {...artProps} aria-label="A name that publishes a key">
        <rect className="how-ink" x="4" y="22" width="112" height="28" rx="2" />
        <text x="10" y="39.5" fontSize="10" stroke="none" style={textStyle}>
          alice.soapay.eth
        </text>
        <line className="how-ink" x1="124" y1="36" x2="156" y2="36" strokeDasharray="1 5" />
        <circle className="how-ink" cx="176" cy="36" r="10" />
        <line className="how-ink" x1="186" y1="36" x2="228" y2="36" />
        <line className="how-ink" x1="218" y1="36" x2="218" y2="44" />
        <line className="how-ink" x1="226" y1="36" x2="226" y2="42" />
        <rect className="how-fresh how-payoff" x="172" y="32" width="8" height="8" fill="var(--accent)" stroke="none" />
      </svg>
    );
  }

  if (step === 2) {
    return (
      <svg {...artProps} aria-label="One key, a new address for each payment">
        <circle className="how-ink" cx="14" cy="36" r="10" />
        <rect className="how-fresh" x="10" y="32" width="8" height="8" fill="var(--accent)" stroke="none" />
        <line className="how-ink" x1="24" y1="36" x2="136" y2="14" />
        <line className="how-ink" x1="24" y1="36" x2="136" y2="36" />
        <line className="how-ink" x1="24" y1="36" x2="136" y2="58" />
        <rect className="how-ink" x="136" y="6" width="96" height="16" rx="2" />
        <rect className="how-ink" x="136" y="28" width="96" height="16" rx="2" />
        <rect className="how-ink" x="136" y="50" width="96" height="16" rx="2" />
        <rect className="how-fresh how-payoff" x="142" y="10" width="8" height="8" fill="var(--accent)" stroke="none" />
        <rect className="how-fresh how-payoff" x="142" y="32" width="8" height="8" fill="var(--accent)" stroke="none" />
        <rect className="how-fresh how-payoff" x="142" y="54" width="8" height="8" fill="var(--accent)" stroke="none" />
        <text x="156" y="17" fontSize="9" stroke="none" style={textStyle}>
          0x7a3F…9c1E
        </text>
        <text x="156" y="39" fontSize="9" stroke="none" style={textStyle}>
          0x12e9…b04C
        </text>
        <text x="156" y="61" fontSize="9" stroke="none" style={textStyle}>
          0xf37a…88e1
        </text>
      </svg>
    );
  }

  return (
    <svg {...artProps} aria-label="Only the owner's key opens them">
      <rect className="how-fresh" x="6" y="32" width="8" height="8" fill="var(--accent)" stroke="none" />
      <rect className="how-fresh" x="22" y="32" width="8" height="8" fill="var(--accent)" stroke="none" />
      <rect className="how-fresh" x="38" y="32" width="8" height="8" fill="var(--accent)" stroke="none" />
      <line className="how-ink" x1="52" y1="36" x2="118" y2="36" />
      <circle className="how-ink" cx="128" cy="36" r="8" />
      <rect className="how-fresh" x="124" y="32" width="8" height="8" fill="var(--accent)" stroke="none" />
      <line className="how-ink" x1="136" y1="36" x2="160" y2="36" />
      <line className="how-ink" x1="152" y1="36" x2="152" y2="42" />
      <line className="how-ink" x1="158" y1="36" x2="158" y2="41" />
      <line className="how-ink" x1="166" y1="36" x2="194" y2="36" />
      <circle className="how-ink" cx="214" cy="36" r="12" />
      <polyline className="how-payoff" points="207,36 212,41 222,30" strokeWidth="1.75" />
    </svg>
  );
}
