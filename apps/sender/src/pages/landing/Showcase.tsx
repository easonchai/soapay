import { useEffect, useRef, useState } from "react";
import { Fade, Lockup, Presence, motionOff, useInViewLoop } from "@soapay/ui";
import { APP_TABS, COMPANY, WALLET_CHIP } from "./sample.js";
import { PayRunFrame } from "./frames/PayRunFrame.js";
import { ReviewFrame } from "./frames/ReviewFrame.js";
import { HistoryFrame } from "./frames/HistoryFrame.js";
import "./showcase.css";

type TabId = "pay" | "review" | "history";

const TABS: { id: TabId; title: string; copy: string; appTab: (typeof APP_TABS)[number]; url: string }[] = [
  { id: "pay", title: "Pay run", copy: "Names and amounts, denominated by default into identical transfers.", appTab: "Pay run", url: "pay.soapay.eth/#/pay" },
  { id: "review", title: "Review & sign", copy: "Fresh addresses, total, gas. One signature.", appTab: "Pay run", url: "pay.soapay.eth/#/pay/review" },
  { id: "history", title: "History", copy: "Every run and its transaction, in your browser.", appTab: "History", url: "pay.soapay.eth/#/history" },
];

/** How long each tab holds before the showcase moves on. Matches the progress hairline in showcase.css. */
export const SHOWCASE_PERIOD_MS = 5000;
/** The product frame is laid out at this width and scaled down to fit, so it stays crisp at every size. */
const FRAME_W = 960;
/** 32 px title bar + the 640 px stage in showcase.css. */
const FRAME_H = 672;

const FRAMES: Record<TabId, () => React.JSX.Element> = { pay: PayRunFrame, review: ReviewFrame, history: HistoryFrame };

/** Compact app bar for the frames: lockup / company, the four product tabs, the wallet chip. */
function FrameChrome({ active }: { active: (typeof APP_TABS)[number] }) {
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <div className="topbar-left">
          <div className="brand">
            <Lockup height={16} />
            <span className="sep">/</span>
            <span className="org">{COMPANY}</span>
          </div>
          <nav className="topnav" aria-label="App sections">
            {APP_TABS.map((t) => (
              <span key={t} className={t === active ? "active" : undefined}>
                {t}
                {t === active && <span className="tab-line" />}
              </span>
            ))}
          </nav>
        </div>
        <div className="topbar-right">
          <span className="chip">
            <span className="dot" />
            {WALLET_CHIP}
          </span>
        </div>
      </div>
    </header>
  );
}

/** Landing · "The company app": three product screens in a browser frame, cycling every 5 s until a tab is chosen. */
export function Showcase() {
  const still = motionOff();
  const rootRef = useRef<HTMLElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<TabId>("pay");
  const [pinned, setPinned] = useState(false);
  const [scale, setScale] = useState(1);

  const visible = useInViewLoop(
    rootRef,
    SHOWCASE_PERIOD_MS,
    () => setTab((t) => TABS[(TABS.findIndex((x) => x.id === t) + 1) % TABS.length]!.id),
    !pinned,
  );

  // Fit the 960 px frame to whatever width the column gives it.
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      setScale(w > 0 && w < FRAME_W ? w / FRAME_W : 1);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const current = TABS.find((t) => t.id === tab) ?? TABS[0]!;
  const Frame = FRAMES[tab];
  const progress = visible && !pinned && !still;

  return (
    <section className="land-section show" ref={rootRef} aria-labelledby="show-title">
      <div className="land-wrap">
        <div className="land-head">
          <div className="text">
            <span className="eyebrow">The company app</span>
            <h2 className="land-h2" id="show-title">
              A back office, not a crypto app.
            </h2>
            <p className="land-body">
              Roster, review, history. Names and amounts are kept as your audit trail; addresses never are.
            </p>
          </div>
        </div>

        <div className="show-grid">
          <div className="show-tabs" role="tablist" aria-label="Product screens" aria-orientation="vertical">
            {TABS.map((t) => {
              const selected = t.id === tab;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  id={`show-tab-${t.id}`}
                  className="show-tab"
                  aria-selected={selected}
                  aria-controls="show-panel"
                  tabIndex={selected ? 0 : -1}
                  data-tab={t.id}
                  onClick={() => {
                    setPinned(true);
                    setTab(t.id);
                  }}
                >
                  <span className="t">{t.title}</span>
                  <span className="d">{t.copy}</span>
                  {selected && progress && <span key={t.id} className="show-progress" aria-hidden="true" />}
                </button>
              );
            })}
          </div>

          <div className="show-frame" ref={frameRef} style={{ height: FRAME_H * scale }} role="tabpanel" id="show-panel" aria-labelledby={`show-tab-${tab}`}>
            <div className="show-window" style={{ width: FRAME_W, transform: scale === 1 ? undefined : `scale(${scale})` }}>
              <div className="show-titlebar">
                <span className="show-lights" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                <span className="show-url">{current.url}</span>
                <span />
              </div>
              <div className="show-stage" inert>
                <Presence initial={false}>
                  <Fade key={tab} x={12} duration={0.5} className="show-slide">
                    <div className="show-app" data-frame={tab}>
                      <FrameChrome active={current.appTab} />
                      <Frame />
                    </div>
                  </Fade>
                </Presence>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
