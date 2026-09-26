type CompareArtProps = { kind: "without" | "with" };

const artProps = {
  className: "art",
  viewBox: "0 0 320 96",
  role: "img",
  fill: "none",
  stroke: "var(--accent)",
  strokeWidth: 1.25,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const textStyle = { fontFamily: "var(--mono)", fill: "var(--ink)" };

const WITHOUT_ROWS = [
  { name: "alice.eth", amount: "4,200.00", y: 18 },
  { name: "bram.eth", amount: "3,850.00", y: 48 },
  { name: "chen.eth", amount: "5,100.00", y: 78 },
] as const;

const WITH_ROWS = [
  { address: "0x7a3F…9c1E", y: 18 },
  { address: "0x12e9…b04C", y: 48 },
  { address: "0xf37a…88e1", y: 78 },
] as const;

/** Compact line art that makes the public difference visible without a data table. */
export function CompareArt({ kind }: CompareArtProps) {
  if (kind === "without") {
    return (
      <svg
        {...artProps}
        aria-label="Three salaries to the same wallets, names and amounts in the open"
      >
        {WITHOUT_ROWS.map((row) => (
          <g key={row.name}>
            <rect className="art-ink" x="4" y={row.y - 11} width="92" height="22" rx="2" />
            <text x="12" y={row.y + 3.5} fontSize="10" stroke="none" style={textStyle}>
              {row.name}
            </text>
            <line className="art-ink" x1="104" y1={row.y} x2="188" y2={row.y} />
            <text x="196" y={row.y + 3.5} fontSize="11" stroke="none" style={textStyle}>
              {row.amount}
            </text>
          </g>
        ))}
        <ellipse className="art-ink" cx="292" cy="48" rx="16" ry="9" />
        <circle className="art-payoff" cx="292" cy="48" r="3.5" fill="var(--accent)" stroke="none" />
      </svg>
    );
  }

  return (
    <svg {...artProps} aria-label="Three fresh addresses paid the same amount, no names">
      {WITH_ROWS.map((row) => (
        <g key={row.address}>
          <rect className="art-payoff" x="4" y={row.y - 4} width="8" height="8" fill="var(--accent)" stroke="none" />
          <text x="18" y={row.y + 3.5} fontSize="10" stroke="none" style={textStyle}>
            {row.address}
          </text>
          <line className="art-ink" x1="104" y1={row.y} x2="188" y2={row.y} />
          <text x="196" y={row.y + 3.5} fontSize="11" stroke="none" style={textStyle}>
            500.00
          </text>
        </g>
      ))}
      <rect className="art-ink" x="282" y="46" width="20" height="15" rx="2" />
      <path className="art-ink" d="M286 46 v-6 a6 6 0 0 1 12 0 v6" />
      <rect className="art-payoff" x="289" y="50.5" width="6" height="6" fill="var(--accent)" stroke="none" />
    </svg>
  );
}
