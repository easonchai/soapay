import { useRef } from "react";
import { useGSAP } from "@gsap/react";
import { motionOff } from "@soapay/ui";
import gsap from "gsap";
import { EASE_OUT } from "./motion.js";

const ROLL_DURATION = 0.55;

/**
 * Rolls the headline's last word through what Soapay pays out (owner request 2026-09-26): the current
 * word slides up and out while the next slides up in, clipped to the line. The box takes the current
 * word's width, so the centred line glides instead of jumping. Reduced motion keeps the first word.
 */
export function RollWord({ words, hold = 2400 }: { words: readonly string[]; hold?: number }) {
  const key = words.join("|");
  const box = useRef<HTMLSpanElement>(null);
  const first = useRef<HTMLSpanElement>(null);
  const second = useRef<HTMLSpanElement>(null);
  const measure = useRef<(HTMLSpanElement | null)[]>([]);

  useGSAP(
    () => {
      const root = box.current;
      const front = first.current;
      const back = second.current;
      if (!root || !front || !back || motionOff() || words.length < 2) return;

      let index = 0;
      let current = front;
      let incoming = back;
      const readWidth = (at: number) => measure.current[at]?.offsetWidth || undefined;
      const fitCurrent = () => {
        const width = readWidth(index);
        if (width) gsap.set(root, { width });
      };

      // One slot remains in flow to preserve line height while the other rolls behind it.
      gsap.set(root, { transition: "none" });
      gsap.set(current, { position: "relative", yPercent: 0 });
      gsap.set(incoming, { position: "absolute", left: 0, top: 0, yPercent: 130, visibility: "hidden" });
      fitCurrent();

      let nextRoll: gsap.core.Tween;
      const rotate = () => {
        const nextIndex = (index + 1) % words.length;
        incoming.textContent = words[nextIndex] ?? words[0] ?? "";
        incoming.setAttribute("aria-hidden", "true");
        gsap.set(incoming, { position: "absolute", left: 0, top: 0, yPercent: 130, visibility: "visible" });

        const timeline = gsap.timeline({
          onComplete: () => {
            current.setAttribute("aria-hidden", "true");
            incoming.removeAttribute("aria-hidden");
            gsap.set(current, { position: "absolute", left: 0, top: 0, yPercent: 130, visibility: "hidden" });
            gsap.set(incoming, { position: "relative", left: "auto", top: "auto" });
            [current, incoming] = [incoming, current];
            index = nextIndex;
            nextRoll = gsap.delayedCall(hold / 1000, rotate);
          },
        });
        timeline.to(current, { yPercent: -110, duration: ROLL_DURATION, ease: EASE_OUT }, 0);
        timeline.to(incoming, { yPercent: 0, duration: ROLL_DURATION, ease: EASE_OUT }, 0);
        const width = readWidth(nextIndex);
        if (width) timeline.to(root, { width, duration: ROLL_DURATION, ease: EASE_OUT }, 0);
      };

      nextRoll = gsap.delayedCall(hold / 1000, rotate);
      const observer = new ResizeObserver(fitCurrent);
      for (const el of measure.current) if (el) observer.observe(el);
      return () => {
        observer.disconnect();
        nextRoll.kill();
      };
    },
    { scope: box, dependencies: [key, hold], revertOnUpdate: true },
  );

  return (
    <span className="roll-word" ref={box}>
      <span className="roll-item" ref={first}>
        {words[0]}
      </span>
      <span className="roll-item" ref={second} aria-hidden />
      <span className="roll-measure" aria-hidden>
        {words.map((w, i) => (
          <span
            key={w}
            ref={(el) => {
              measure.current[i] = el;
            }}
          >
            {w}
          </span>
        ))}
      </span>
    </span>
  );
}
