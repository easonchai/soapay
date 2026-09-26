import { motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { CountUp, motionOff, useVisible } from "@soapay/ui";
import "./how.css";

/*
 * Timeline (seconds from the moment the diagram is on screen). Connectors draw one after another;
 * packets set off once a connector is drawn and after the previous connector's packets have crossed,
 * so the same batch appears to travel from roster to chain. Each node reacts when packets reach it.
 */
const DRAW = 0.8;
const DRAW_GAP = 0.25;
const TRAVEL = 1.6;
const REST = 1.2;
const PACKET_GAP = 0.35;
const PACKETS = 3;
const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];
const packetStart = (i: number) => DRAW + DRAW_GAP * i + TRAVEL * i;
const arrive = (i: number) => packetStart(i) + TRAVEL;

const TICK = 0.04; // one typed character
const LINE_GAP = 0.3; // pause between typed lines
const CELL_EVERY = 0.08;
const CELLS = 28;

const ROSTER: [string, string][] = [
  ["alice.soapay.eth", "4,200.00"],
  ["bram.soapay.eth", "3,850.00"],
  ["chen.soapay.eth", "5,100.00"],
];
const DERIVED: [string, string][] = [
  ["ephemeral key", "0x02c1…7e"],
  ["view tag", "0x9a"],
  ["stealth address", "0x7a3F…9c1E"],
];
// Full typed text per line is `${k}  ${v}`; each line starts when the previous one has finished.
const LINE_START = DERIVED.reduce<number[]>((acc, [k, v], i) => {
  const prev = i === 0 ? arrive(0) : acc[i - 1]! + (DERIVED[i - 1]![0].length + 2 + DERIVED[i - 1]![1].length) * TICK + LINE_GAP;
  acc.push(prev);
  return acc;
}, []);
const TYPING_END = LINE_START[2]! + (DERIVED[2]![0].length + 2 + DERIVED[2]![1].length) * TICK;
const GRID_START = arrive(2);
const END = Math.max(TYPING_END, GRID_START + CELLS * CELL_EVERY) + 0.2;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const whole = (n: number) => String(Math.round(n));

/** Width of the connector, so packets travel exactly the gap. 56px until measured. */
function useWidth(ref: React.RefObject<HTMLElement | null>, fallback: number): number {
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => {
      const cw = e?.contentRect.width;
      if (cw) setW(cw);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

/** True under 900px, where the cards stack and connectors become a vertical rule. */
function useNarrow(): boolean {
  const [n, setN] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia?.("(max-width: 900px)");
    if (!mq) return;
    const sync = () => setN(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return n;
}

function Connector({ index, live }: { index: number; live: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const w = useWidth(ref, 56);
  const still = motionOff();
  const span = Math.max(0, w - 6);
  return (
    <div className="how-conn" ref={ref} aria-hidden="true">
      <svg viewBox="0 0 100 8" preserveAspectRatio="none">
        {still ? (
          <path d="M0 4 H100" vectorEffect="non-scaling-stroke" />
        ) : (
          <motion.path
            d="M0 4 H100"
            vectorEffect="non-scaling-stroke"
            initial={{ pathLength: 0 }}
            whileInView={{ pathLength: 1 }}
            viewport={{ once: true, amount: 0.5 }}
            transition={{ duration: DRAW, delay: DRAW_GAP * index, ease: EASE }}
          />
        )}
      </svg>
      {live &&
        Array.from({ length: PACKETS }, (_, k) => (
          <motion.div
            key={k}
            className="how-packet"
            initial={{ x: 0, opacity: 0 }}
            animate={{ x: [0, span], opacity: [0, 1, 1, 0] }}
            transition={{
              duration: TRAVEL,
              delay: packetStart(index) + PACKET_GAP * k,
              ease: [0.45, 0, 0.55, 1],
              repeat: Infinity,
              repeatDelay: REST,
              opacity: { duration: TRAVEL, times: [0, 0.12, 0.88, 1], repeat: Infinity, repeatDelay: REST, delay: packetStart(index) + PACKET_GAP * k },
            }}
          />
        ))}
    </div>
  );
}

function Node({ tag, caption, children }: { tag: string; caption: string; children: React.ReactNode }) {
  return (
    <div className="how-node">
      <div className="how-tag">{tag}</div>
      <div className="how-body">{children}</div>
      <div className="how-cap">{caption}</div>
    </div>
  );
}

/** One derivation line, revealed `chars` characters in; a square caret sits at the end while it types. */
function TypedRow({ k, v, chars }: { k: string; v: string; chars: number }) {
  const full = k.length + 2 + v.length;
  const n = clamp(chars, 0, full);
  const typing = n > 0 && n < full;
  const kk = k.slice(0, Math.min(n, k.length));
  const vv = n > k.length + 2 ? v.slice(0, n - k.length - 2) : "";
  return (
    <div className="how-row">
      <span className="k">
        {kk}
        {typing && n <= k.length + 2 && <span className="how-caret" />}
      </span>
      <span className="v">
        {vv}
        {typing && n > k.length + 2 && <span className="how-caret" />}
      </span>
    </div>
  );
}

/** Roster → derivation → one transaction → fresh addresses, with packets carrying the batch across. */
export function FlowDiagram() {
  const ref = useRef<HTMLDivElement>(null);
  const visible = useVisible(ref, 0.2);
  const narrow = useNarrow();
  const still = motionOff();
  // Seconds of on-screen time so far; pauses off screen, never rewinds. Infinity when motion is off.
  const [clock, setClock] = useState(0);
  const acc = useRef(0);
  const run = visible && !still && clock < END;
  useEffect(() => {
    if (!run) return;
    const id = window.setInterval(() => {
      acc.current += TICK;
      setClock(acc.current);
    }, TICK * 1000);
    return () => window.clearInterval(id);
  }, [run]);
  const t = still ? Infinity : clock;

  const charsAt = (i: number) => (t === Infinity ? Infinity : Math.floor((t - LINE_START[i]!) / TICK));
  const stats = t >= arrive(1) ? 28 : 0;
  const filled = t === Infinity ? CELLS : clamp(Math.floor((t - GRID_START) / CELL_EVERY), 0, CELLS);
  const strip = still || visible;
  const live = visible && !still && !narrow;

  return (
    <div className="how-flow" ref={ref}>
      <div className="how-nodes">
        <Node tag="Roster · in your browser" caption="Names pinned to their registry record.">
          {ROSTER.map(([name, amt]) => (
            <div className="how-row roster" key={name}>
              <span className="k">{name}</span>
              <span className="v">{amt}</span>
            </div>
          ))}
        </Node>
        <Connector index={0} live={live} />
        <Node tag="Derivation · on your device" caption="Fresh key per line, sorted by address, not person.">
          {DERIVED.map(([k, v], i) => (
            <TypedRow key={k} k={k} v={v} chars={charsAt(i)} />
          ))}
        </Node>
        <Connector index={1} live={live} />
        <Node tag="One transaction · StealthDisperse" caption="Every transfer and its announcement, together.">
          <div className="how-stats">
            <div className="how-stat">
              <span className="how-fig">
                <CountUp value={stats} format={whole} duration={1.2} />
              </span>
              <span className="k">transfers</span>
            </div>
            <div className="how-stat">
              <span className="how-fig">
                <CountUp value={stats} format={whole} duration={1.2} />
              </span>
              <span className="k">announcements</span>
            </div>
          </div>
        </Node>
        <Connector index={2} live={live} />
        <Node tag="Fresh addresses · on chain" caption="None carries a name.">
          <div className="how-grid" data-testid="how-grid" aria-label={`${filled} of ${CELLS} fresh addresses funded`}>
            {Array.from({ length: CELLS }, (_, i) => (
              <span key={i} className={i < filled ? "how-cell on" : "how-cell"} />
            ))}
          </div>
          <div className="how-sum">28 × 500.00 USDC</div>
        </Node>
      </div>
      <div className="how-strip">
        <CountUp value={strip ? 41 : 0} format={whole} duration={1.2} /> names → <CountUp value={strip ? 337 : 0} format={whole} duration={1.2} /> fresh
        addresses → <CountUp value={strip ? 1 : 0} format={whole} duration={1.2} /> transaction
      </div>
    </div>
  );
}
