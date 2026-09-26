// Test USDC for the connected wallet. Demo mode: a button that credits the in-memory ledger. A real
// testnet: Soapay's welcome drop (D-52) sends test USDC on first login, so this only explains it and
// links a Base Sepolia ETH faucet for the wallet's own gas. Mainnet: nothing. Props-only.
import { toast } from "@soapay/ui";
import { isTestnetChain } from "@soapay/sdk";
import { DEMO_FAUCET_USDC } from "../lib/demoChain.js";
import { WELCOME_DROP_USDC } from "../lib/testnet.js";
import { usdc } from "../ui/kit.js";

export const CIRCLE_FAUCET_URL = "https://faucet.circle.com/";
export const BASE_SEPOLIA_ETH_FAUCET_URL = "https://www.alchemy.com/faucets/base-sepolia";
/** "10,000": the demo drip without cents. */
const DRIP = usdc(DEMO_FAUCET_USDC).replace(/\.00$/, "");

export type FaucetProps = {
  chainId: number;
  demo: boolean;
  /** The wallet's USDC balance, when known. */
  usdcBalance?: bigint | null | undefined;
  /** Demo only: credits the demo wallet. */
  onFaucet?: (() => void) | undefined;
  /** One line (Pay run rail): "Test USDC · balance · action", no panel and no explainer. */
  compact?: boolean | undefined;
};

export function Faucet({ chainId, demo, usdcBalance = null, onFaucet, compact = false }: FaucetProps) {
  if (!demo && !isTestnetChain(chainId)) return null;
  if (compact) {
    return (
      <div className="faucet-line" data-testid="faucet">
        <span style={{ fontWeight: 500 }}>Test USDC</span>
        {(demo || usdcBalance !== null) && <span className="mono num">{usdcBalance === null ? "…" : `${usdc(usdcBalance)} USDC`}</span>}
        {demo ? (
          <button
            className="btn-text"
            style={{ fontSize: 12 }}
            onClick={() => {
              onFaucet?.();
              toast.success(`${DRIP} USDC added`);
            }}
          >
            Get {DRIP} test USDC
          </button>
        ) : (
          <a href={BASE_SEPOLIA_ETH_FAUCET_URL} target="_blank" rel="noreferrer">
            Base Sepolia ETH for gas ↗
          </a>
        )}
      </div>
    );
  }
  if (demo) {
    return (
      <div className="panel panel-pad between" style={{ gap: 12, flexWrap: "wrap" }} data-testid="faucet">
        <span className="stack-sm" style={{ gap: 2 }}>
          <span style={{ fontWeight: 500 }}>Test USDC</span>
          <span className="ink2" style={{ fontSize: 12 }}>
            Demo wallet balance: <span className="mono num">{usdcBalance === null ? "…" : `${usdc(usdcBalance)} USDC`}</span>
          </span>
        </span>
        <button
          onClick={() => {
            onFaucet?.();
            toast.success(`${DRIP} USDC added`);
          }}
        >
          Get {DRIP} test USDC
        </button>
      </div>
    );
  }
  return (
    <div className="panel panel-pad stack-sm" style={{ gap: 6 }} data-testid="faucet">
      <span style={{ fontWeight: 500 }}>Test USDC</span>
      {usdcBalance !== null && (
        <span className="ink2" style={{ fontSize: 12 }}>
          Wallet balance: <span className="mono num">{usdc(usdcBalance)} USDC</span>
        </span>
      )}
      <span className="ink2" style={{ fontSize: 12 }}>
        Every wallet gets {WELCOME_DROP_USDC.toLocaleString("en-US")} test USDC from Soapay on its first login. Smart wallets pay
        no gas here; a regular wallet needs a little{" "}
        <a href={BASE_SEPOLIA_ETH_FAUCET_URL} target="_blank" rel="noreferrer">
          Base Sepolia ETH for gas ↗
        </a>
      </span>
    </div>
  );
}
