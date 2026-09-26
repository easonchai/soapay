import { useEffect, useRef, useState } from "react";
import { FreshMark, InView, motionOff, useVisible } from "@soapay/ui";
import "./trust.css";

const MS_PER_CHAR = 35;
const ROW_GAP_MS = 140;

type Row = { k: string; v: string; mark?: boolean; absent?: boolean };

const ROWS: readonly Row[] = [
  { k: "event", v: "Announcement" },
  { k: "stealth address", v: "0x7a3F4b2c…9c1E", mark: true },
  { k: "ephemeral key", v: "0x02c1…7e" },
  { k: "view tag", v: "0x9a" },
  { k: "recipient", v: "not present", absent: true },
  { k: "amount", v: "500.00 USDC" },
];

/** Start of each row's typing, so rows land one after another. */
const START_MS = ROWS.reduce<number[]>((acc, r, i) => {
  const prev = acc[i - 1] ?? 0;
  const prevLen = i === 0 ? 0 : ROWS[i - 1]!.v.length;
  acc.push(i === 0 ? 0 : prev + prevLen * MS_PER_CHAR + ROW_GAP_MS);
  return acc;
}, []);

const CAN_SEE = [
  "Every stealth address and amount, in address order.",
  "Your company as the payer.",
  "The batch total and, if denominated, chunk size.",
] as const;
const CANNOT_LEARN = [
  "Which address belongs to which colleague.",
  "Any link between one person's payments, across months.",
  "Anyone's main wallet: no ETH ever reaches a stealth address.",
  "If denominated, how many chunks each person received.",
] as const;

/**
 * Character-by-character reveal of `text`, starting `delayMs` after `active` first turns true.
 * Types once; scrolling away and back does not retype. Full text at once when motion is off.
 */
function useTyped(text: string, active: boolean, msPerChar = MS_PER_CHAR, delayMs = 0): string {
  const off = motionOff();
  const [n, setN] = useState(() => (off ? text.length : 0));
  const done = useRef(off);
  useEffect(() => {
    if (done.current) return;
    if (off) {
      done.current = true;
      setN(text.length);
      return;
    }
    if (!active) return;
    let i = 0;
    let iv = 0;
    const t = window.setTimeout(() => {
      iv = window.setInterval(() => {
        i += 1;
        setN(i);
        if (i >= text.length) {
          done.current = true;
          window.clearInterval(iv);
        }
      }, msPerChar);
    }, delayMs);
    return () => {
      window.clearTimeout(t);
      window.clearInterval(iv);
    };
  }, [text, active, msPerChar, delayMs, off]);
  return text.slice(0, n);
}

function TypedRow({ row, active, delayMs }: { row: Row; active: boolean; delayMs: number }) {
  const shown = useTyped(row.v, active, MS_PER_CHAR, delayMs);
  const typing = shown.length > 0 && shown.length < row.v.length;
  return (
    <div className="chain-row">
      <span className="chain-k">{row.k}</span>
      <span className={`chain-v${row.absent ? " chain-absent" : ""}`}>
        {row.mark && shown.length > 0 && <FreshMark />}
        <span>
          {shown}
          {typing && <span className="chain-caret" aria-hidden />}
        </span>
      </span>
    </div>
  );
}

function List({ title, items, cannot }: { title: string; items: readonly string[]; cannot?: boolean }) {
  return (
    <div className={`chain-list${cannot ? " chain-cannot" : ""}`}>
      <h4 className="chain-list-title">{title}</h4>
      <ul>
        {items.map((s, i) => (
          <InView key={s} as="li" delay={i * 0.06} y={8}>
            {s}
          </InView>
        ))}
      </ul>
    </div>
  );
}

/** Landing · "What the chain sees": one announcement, typed in, and what a coworker can and cannot read from it. */
export function ChainView() {
  const cardRef = useRef<HTMLDivElement>(null);
  const visible = useVisible(cardRef, 0.4);
  return (
    <section className="land-section chain" aria-labelledby="chain-title">
      <div className="land-wrap">
        <div className="chain-top">
          <InView className="chain-text" y={10}>
            <span className="eyebrow">What the chain sees</span>
            <h3 id="chain-title" className="land-h3 chain-h3">
              One announcement per payment.
            </h3>
            <p className="land-body">
              Public, yet meaningful only to the recipient. Matching it against your keys is how the app finds your money.
            </p>
          </InView>
          <InView delay={0.1} y={10}>
            <div className="chain-card" ref={cardRef} aria-label="Announcement as recorded on chain">
              {ROWS.map((row, i) => (
                <TypedRow key={row.k} row={row} active={visible} delayMs={START_MS[i] ?? 0} />
              ))}
            </div>
          </InView>
        </div>
        <div className="chain-lists">
          <List title="A coworker can see" items={CAN_SEE} />
          <List title="A coworker cannot learn" items={CANNOT_LEARN} cannot />
        </div>
      </div>
    </section>
  );
}
