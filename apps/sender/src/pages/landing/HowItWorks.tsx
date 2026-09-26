import { useRef } from "react";
import { useGSAP } from "@gsap/react";
import { Dots, motionOff } from "@soapay/ui";
import gsap from "gsap";
import { DrawSVGPlugin } from "gsap/DrawSVGPlugin";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { StepArt } from "./StepArt.js";
import "./how.css";

gsap.registerPlugin(ScrollTrigger, DrawSVGPlugin);

const STEPS = [
  {
    title: "One name per person",
    body: "Someone on your team claims alice.soapay.eth once. It publishes a key, not a wallet.",
  },
  {
    title: "A new address per payment",
    body: "From that key, Soapay makes a brand-new address for each payment. No two can be linked.",
  },
  {
    title: "Only its owner can open it",
    body: "Alice's key finds her payments and spends them. To everyone else they are just addresses.",
  },
] as const;

function StepArrow() {
  return (
    <svg className="how-arrow" viewBox="0 0 20 8" aria-hidden="true">
      <path d="M0 4h18M14 1l4 3-4 3" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Plain-language sequence from one public name to privately owned payments. */
export function HowItWorks() {
  const gridRef = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const grid = gridRef.current;
      if (!grid || motionOff()) return;

      // Set payoffs before the reveal timeline so filled marks never flash on screen.
      gsap.set(".how-payoff", { opacity: 0, scale: 0.6, transformOrigin: "50% 50%" });
      const sequence = gsap.timeline({
        scrollTrigger: { trigger: grid, start: "top 75%", once: true },
      });

      gsap.utils.toArray<HTMLElement>(".how-step3", grid).forEach((column, index) => {
        const drawing = gsap.timeline();
        drawing.fromTo(
          column.querySelectorAll(".how-ink"),
          { drawSVG: "0%" },
          { drawSVG: "100%", duration: 0.7, ease: "power2.out", stagger: 0.08 },
        );
        drawing.to(column.querySelectorAll(".how-payoff"), {
          opacity: 1,
          scale: 1,
          transformOrigin: "50% 50%",
          duration: 0.3,
          ease: "back.out(1.6)",
          stagger: 0.12,
        });
        sequence.add(drawing, index * 0.18);
      });
    },
    { scope: gridRef },
  );

  return (
    <section className="land-section how" id="how" aria-labelledby="how-title">
      <div className="land-wrap">
        <div className="land-head">
          <div className="text">
            <span className="eyebrow">How it works</span>
            <h2 className="land-h2" id="how-title">
              A <span className="how-accent">fresh address</span> for every payment.
            </h2>
            <p className="land-body">That is the whole trick. The app is just where you run it.</p>
          </div>
          <Dots mode="right" className="dots" animate />
        </div>

        <div className="how-steps3" ref={gridRef}>
          {STEPS.map((step, index) => (
            <div className="how-step3" key={step.title}>
              <span className="how-n">{String(index + 1).padStart(2, "0")}</span>
              {index < STEPS.length - 1 && <StepArrow />}
              <StepArt step={(index + 1) as 1 | 2 | 3} />
              <h3 className="how-t">{step.title}</h3>
              <p className="how-d">{step.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
