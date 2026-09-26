import { Dots, InView } from "@soapay/ui";
import { FlowDiagram } from "./FlowDiagram.js";
import "./how.css";

type Step = { title: string; body: string };
type Column = { tag: string; title: string; steps: Step[]; foot: string };

const COLUMNS: Column[] = [
  {
    tag: "For your company",
    title: "Pay a team in one signature",
    steps: [
      { title: "Paste names and amounts", body: "From a spreadsheet. Names resolve live; failures are shown before you sign." },
      { title: "Review the batch", body: "How many fresh addresses, total, gas. Optionally split into equal chunks." },
      { title: "Sign once, or export to Safe", body: "History keeps names and amounts as your audit trail. No addresses stored." },
    ],
    foot: "41 names → 337 fresh addresses → 1 transaction",
  },
  {
    tag: "For your team",
    title: "Get paid privately",
    steps: [
      { title: "Create keys, back up twelve words", body: "Your keys never leave your device. The words are the only recovery." },
      { title: "Claim a name", body: "alice.soapay.eth, or link an ENS name you already own. Registered once, on chain." },
      {
        title: "Share the name, spend from the app",
        body: "Each payment arrives on a fresh address. Spend without gas top-ups; exit via pool when the destination knows you.",
      },
    ],
    foot: "alice.soapay.eth → 0x7a3F…9c1E, 0x3b8E…71aD, …",
  },
];

/** Landing section: header, the flow diagram, then one column each for payer and recipient. */
export function HowItWorks() {
  return (
    <section className="land-section how" id="how" aria-labelledby="how-title">
      <div className="land-wrap">
        <div className="land-head">
          <div className="text">
            <span className="eyebrow">How it works</span>
            <h2 className="land-h2" id="how-title">
              Paste names. Sign once. Nobody can read it back.
            </h2>
            <p className="land-body">
              No new chain, no token, no bridge you haven't heard of. A name, a derivation, and a fresh address per payment.
            </p>
          </div>
          <Dots mode="right" className="dots" animate />
        </div>

        <InView amount={0.15}>
          <FlowDiagram />
        </InView>

        <div className="how-steps">
          {COLUMNS.map((col, c) => (
            <div className="how-col" key={col.tag}>
              <div className="how-col-head">
                <span className="how-tag">{col.tag}</span>
                <h3 className="how-col-title">{col.title}</h3>
              </div>
              {col.steps.map((s, i) => (
                <InView key={s.title} className="how-step" delay={0.05 * (i + c * 3)} amount={0.2}>
                  <span className="n">{String(i + 1).padStart(2, "0")}</span>
                  <div>
                    <div className="t">{s.title}</div>
                    <div className="d">{s.body}</div>
                  </div>
                </InView>
              ))}
              <div className="how-col-foot">{col.foot}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
