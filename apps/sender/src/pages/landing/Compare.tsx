import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { CountUp, Dots, Fade, FreshMark, InView, Presence, motionOff, useInViewLoop } from "@soapay/ui";
import { useScramble } from "./useScramble.js";
import "./compare.css";

type Mode = "before" | "after";

const EASE = [0.16, 1, 0.3, 1] as const;
const NAVY = "#1e3a5f";
const WHITE = "#ffffff";
const DANGER = "#a32d2d";
const ON_NAVY = "#c9daf0";

const BEFORE = [
  { addr: "0x4d2C…88Fa", name: "alice.eth · Meridian", amount: 4200 },
  { addr: "0x9E10…c2B4", name: "bram.eth · Meridian", amount: 3850 },
  { addr: "0x71aD…e0F2", name: "chen.eth · Meridian", amount: 5100 },
  { addr: "0xB33f…1a09", name: "eko.eth · Meridian", amount: 4200 },
  { addr: "0x0e77…f4C1", name: "farah.eth · Meridian", amount: 3600 },
] as const;
const AFTER = ["0x7a3F…9c1E", "0x12e9…b04C", "0xf37a…88e1", "0x0c5D…4e77", "0x9bA2…d1F0"] as const;
const EXTRA = ["0x2b61…0aE3", "0x5cC8…7d12", "0xa90E…3fB7"] as const;
const AFTER_AMOUNT = 500;

const COPY = {
  before: {
    title: "Without Soapay · what any block explorer shows",
    tx: "tx 0x8b1e…c47a",
    foot: "Same address every month, names public, readable forever.",
  },
  after: {
    title: "With Soapay · the same batch",
    tx: "tx 0x2f90…11de",
    foot: "337 fresh addresses, 500 USDC each, no names. Only the recipients know theirs.",
  },
} as const;

const usdc = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt = (n: number) => `${usdc.format(n)} USDC`;

/** One of the five salary rows: address scrambles, name crossfades, amount tweens between the two states. */
function Row({ i, mode, off }: { i: number; mode: Mode; off: boolean }) {
  const b = BEFORE[i]!;
  const after = mode === "after";
  const addr = useScramble(after ? AFTER[i]! : b.addr, !off);
  const amount = after ? AFTER_AMOUNT : b.amount;
  return (
    <div className="cmp-tr" role="row">
      <span className="cmp-addr" role="cell">
        {off ? (
          after && <FreshMark />
        ) : (
          <motion.span
            className="cmp-fresh"
            aria-hidden={!after}
            initial={false}
            animate={{ width: after ? 8 : 0, marginRight: after ? 8 : 0, opacity: after ? 1 : 0 }}
            transition={{ duration: 0.5, ease: EASE }}
          >
            <FreshMark />
          </motion.span>
        )}
        <span>{addr}</span>
      </span>
      <span className="cmp-known" role="cell">
        <span className="cmp-known-in">
          <Presence initial={false}>
            {after ? (
              <Fade key="dash" duration={0.5}>
                <span className="cmp-dash">—</span>
              </Fade>
            ) : (
              <Fade key="name" duration={0.5}>
                <span className="cmp-name">{b.name}</span>
              </Fade>
            )}
          </Presence>
        </span>
      </span>
      <span className="cmp-amt" role="cell">
        {off ? <span>{fmt(amount)}</span> : <CountUp value={amount} format={fmt} duration={0.8} />}
      </span>
    </div>
  );
}

/** Rows that only exist in the Soapay batch: slide in one after another, fold away when it leaves. */
function ExtraRow({ addr, i, off }: { addr: string; i: number; off: boolean }) {
  const inner = (
    <div className="cmp-tr" role="row">
      <span className="cmp-addr" role="cell">
        <FreshMark />
        <span>{addr}</span>
      </span>
      <span className="cmp-known" role="cell">
        <span className="cmp-dash">—</span>
      </span>
      <span className="cmp-amt" role="cell">
        {fmt(AFTER_AMOUNT)}
      </span>
    </div>
  );
  if (off) return <div className="cmp-extra" role="presentation">{inner}</div>;
  return (
    <motion.div
      className="cmp-extra"
      role="presentation"
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 38, opacity: 1, transition: { duration: 0.6, ease: EASE, delay: 0.2 + i * 0.12 } }}
      exit={{ height: 0, opacity: 0, transition: { duration: 0.45, ease: EASE, delay: (EXTRA.length - 1 - i) * 0.06 } }}
    >
      {inner}
    </motion.div>
  );
}

/** Before/after: the same five salaries, once on a plain wallet and once through Soapay. */
export function Compare() {
  const off = motionOff();
  const ref = useRef<HTMLElement>(null);
  const [mode, setMode] = useState<Mode>(() => (motionOff() ? "after" : "before"));
  const [manual, setManual] = useState(false);
  const [started, setStarted] = useState(false);

  // After the first morph, keep flipping every 7 s while on screen, until the user takes over.
  const visible = useInViewLoop(ref, 7000, () => setMode((m) => (m === "before" ? "after" : "before")), started && !manual);

  // First time on screen: hold the plain payroll for a beat, then morph.
  useEffect(() => {
    if (!visible || started || manual || off) return;
    const id = window.setTimeout(() => {
      setMode("after");
      setStarted(true);
    }, 1600);
    return () => window.clearTimeout(id);
  }, [visible, started, manual, off]);

  function pick(m: Mode) {
    setManual(true);
    setMode(m);
  }

  const copy = COPY[mode];
  const after = mode === "after";
  const barStyle = after ? { backgroundColor: NAVY, color: ON_NAVY } : { backgroundColor: WHITE, color: DANGER };

  const bar = off ? (
    <div className="cmp-bar" style={barStyle}>
      <span className="cmp-title">{copy.title}</span>
      <span className="cmp-tx">{copy.tx}</span>
    </div>
  ) : (
    <motion.div className="cmp-bar" initial={false} animate={barStyle} transition={{ duration: 0.6, ease: EASE }}>
      <span className="cmp-title">{copy.title}</span>
      <span className="cmp-tx">{copy.tx}</span>
    </motion.div>
  );

  return (
    <section className="land-section cmp" ref={ref} aria-labelledby="cmp-h2">
      <div className="land-wrap">
        <InView className="land-head">
          <div className="text">
            <span className="eyebrow">The same payroll, twice</span>
            <h2 className="land-h2" id="cmp-h2">One batch. Two ways to read it.</h2>
            <p className="land-body">Plain wallet, then Soapay, as a block explorer shows it.</p>
          </div>
          <Dots mode="field" animate className="dots" />
        </InView>

        <InView delay={0.1}>
          <div className="cmp-tabs">
            <div role="tablist" aria-label="Which payroll to show">
              <button type="button" role="tab" className="cmp-tab" aria-selected={!after} onClick={() => pick("before")}>
                Without Soapay
              </button>
              <button type="button" role="tab" className="cmp-tab" aria-selected={after} onClick={() => pick("after")}>
                With Soapay
              </button>
            </div>
          </div>

          <div className="cmp-card" data-mode={mode}>
            {bar}
            <div className="cmp-table" role="table" aria-label="Payroll as seen on a block explorer">
              <div className="cmp-thead" role="row">
                <span role="columnheader">To</span>
                <span role="columnheader">Known as</span>
                <span className="cmp-amt" role="columnheader">Amount</span>
              </div>
              {BEFORE.map((_, i) => (
                <Row key={i} i={i} mode={mode} off={off} />
              ))}
              <Presence initial={false}>
                {after && EXTRA.map((a, i) => <ExtraRow key={a} addr={a} i={i} off={off} />)}
              </Presence>
            </div>
            <div className="cmp-foot">
              <div className="cmp-foot-in">
                <Presence initial={false}>
                  <Fade key={mode} duration={0.5}>
                    <p style={{ margin: 0 }}>{copy.foot}</p>
                  </Fade>
                </Presence>
              </div>
            </div>
          </div>
        </InView>
      </div>
    </section>
  );
}
