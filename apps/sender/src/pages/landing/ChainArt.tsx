type ChainArtProps = { kind: "record" | "seen" | "hidden" };

const artProps = {
  className: "art",
  viewBox: "0 0 240 96",
  role: "img",
  fill: "none",
  stroke: "var(--accent)",
  strokeWidth: 1.25,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const textStyle = { fontFamily: "var(--mono)", fill: "var(--ink)" };
const keyStyle = { fontFamily: "var(--mono)", fill: "var(--ink2)" };
const disabledTextStyle = { fontFamily: "var(--mono)", fill: "var(--ink-disabled)" };

const RECORD_ROWS = [
  { label: "event", value: "Announcement", y: 20 },
  { label: "address", value: "0x7a3F…9c1E", y: 36, mark: true },
  { label: "amount", value: "500.00 USDC", y: 52 },
  { label: "key", value: "0x02c1…7e", y: 68 },
  { label: "recipient", value: "not present", y: 84, absent: true },
] as const;

const PUBLIC_ROWS = [
  { address: "0x7a3F…9c1E", y: 18 },
  { address: "0x12e9…b04C", y: 47 },
  { address: "0xf37a…88e1", y: 76 },
] as const;

const HIDDEN_ROWS = [
  { name: "alice", address: "0x7a3F…9c1E", top: 8 },
  { name: "bram", address: "0x12e9…b04C", top: 38 },
  { name: "chen", address: "0xf37a…88e1", top: 68 },
] as const;

/** Three views of the same public data, drawn with identity links deliberately absent. */
export function ChainArt({ kind }: ChainArtProps) {
  if (kind === "record") {
    return (
      <svg
        {...artProps}
        aria-label="One on-chain record: address, amount, one-time key, no recipient"
      >
        <rect className="art-ink" x="4" y="4" width="232" height="88" rx="2" />
        {RECORD_ROWS.map((row) => (
          <g key={row.label}>
            <text x="14" y={row.y} fontSize="9" stroke="none" style={keyStyle}>
              {row.label}
            </text>
            {"mark" in row && row.mark && (
              <rect className="art-payoff" x="110" y={row.y - 7} width="8" height="8" fill="var(--accent)" stroke="none" />
            )}
            <text
              x={"mark" in row && row.mark ? 122 : 110}
              y={row.y}
              fontSize="9"
              stroke="none"
              style={"absent" in row && row.absent ? disabledTextStyle : textStyle}
            >
              {row.value}
            </text>
          </g>
        ))}
      </svg>
    );
  }

  if (kind === "seen") {
    return (
      <svg
        {...artProps}
        aria-label="The payer and three addresses with their amounts, all public"
      >
        <rect className="art-ink" x="4" y="36" width="64" height="22" rx="2" />
        <text x="12" y="50.5" fontSize="10" stroke="none" style={textStyle}>
          Meridian
        </text>
        {PUBLIC_ROWS.map((row) => (
          <g key={row.address}>
            <line className="art-ink" x1="72" y1="47" x2="120" y2={row.y} />
            <rect className="art-payoff" x="124" y={row.y - 4} width="8" height="8" fill="var(--accent)" stroke="none" />
            <text x="136" y={row.y + 3} fontSize="9" stroke="none" style={textStyle}>
              {row.address}
            </text>
            <text x="206" y={row.y + 3} fontSize="9" stroke="none" style={textStyle}>
              500.00
            </text>
          </g>
        ))}
      </svg>
    );
  }

  return (
    <svg
      {...artProps}
      aria-label="Names on one side, addresses on the other, no line between them"
    >
      {HIDDEN_ROWS.map((row) => {
        const cy = row.top + 10;
        return (
          <g key={row.name}>
            <rect className="art-ink" x="4" y={row.top} width="64" height="20" rx="2" />
            <text x="12" y={row.top + 13} fontSize="9" stroke="none" style={textStyle}>
              {row.name}
            </text>
            <line className="art-ink" x1="76" y1={cy} x2="164" y2={cy} strokeDasharray="2 4" />
            <line className="art-ink" x1="116" y1={cy - 6} x2="124" y2={cy + 6} />
            <rect className="art-payoff" x="172" y={cy - 4} width="8" height="8" fill="var(--accent)" stroke="none" />
            <text x="184" y={cy + 3} fontSize="9" stroke="none" style={textStyle}>
              {row.address}
            </text>
          </g>
        );
      })}
      <text x="120" y="52" textAnchor="middle" fontSize="10" stroke="none" style={disabledTextStyle}>
        ?
      </text>
    </svg>
  );
}
