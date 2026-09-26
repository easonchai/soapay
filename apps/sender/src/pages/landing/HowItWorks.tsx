import { Dots, InView } from "@soapay/ui";
import { FlowDiagram } from "./FlowDiagram.js";
import "./how.css";

type Step = { title: string; body: string };
type Column = { tag: string; title: string; steps: Step[]; foot: string };

const COLUMNS: Column[] = [
  {
    tag: "For your company",
    title: "Pay a team",
    steps: [
      { title: "Paste names and amounts", body: "From a spreadsheet; names resolve live, failures show before signing." },
      { title: "Review the batch", body: "Optionally split into equal chunks. Nothing sent yet." },
      { title: "Sign once, or export to Safe", body: "The batch goes out as one transaction." },
    ],
    foot: "41 names → 337 fresh addresses → 1 transaction",
  },
  {
    tag: "For your team",
    title: "Get paid privately",
    steps: [
      { title: "Create keys, back up twelve words", body: "The twelve words are the only recovery." },
      { title: "Claim a name", body: "alice.soapay.eth or your own ENS name, registered once on chain." },
      {
        title: "Share the name, spend from the app",
        body: "No gas top-ups. Exit via pool when the destination knows you.",
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
              One signature. Nobody can read it back.
            </h2>
            <p className="land-body">
              No new chain, token or bridge. A name, a derivation, a fresh address per payment.
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
