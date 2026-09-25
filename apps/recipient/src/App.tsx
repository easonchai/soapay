import { SOAPAY_CHAIN } from "@soapay/sdk";

// M1: onboarding (seed, registrant, ERC-6538 registration, subname), scanner, ledger.
export function App() {
  return (
    <main>
      <h1>Soapay</h1>
      <p>Recipient app · {SOAPAY_CHAIN.name}</p>
    </main>
  );
}
