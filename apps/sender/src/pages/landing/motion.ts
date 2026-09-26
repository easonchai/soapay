import type { RefObject } from "react";
import { useGSAP } from "@gsap/react";
import { motionOff } from "@soapay/ui";
import gsap from "gsap";
import { DrawSVGPlugin } from "gsap/DrawSVGPlugin";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(useGSAP, ScrollTrigger, DrawSVGPlugin);

/*
 * The landing page's motion system (owner decision 2026-09-26: GSAP for everything on the landing).
 * Every hook renders the final state and creates nothing when motionOff() is true, so ?motion=off
 * and the OS reduced-motion setting give a still page. Shared @soapay/ui motion wrappers (framer)
 * stay for the app screens; the landing does not import them.
 */

// Sections change height after mount (the product frame scales to its column, fonts and dot canvases
// settle), which leaves ScrollTrigger's recorded positions stale and can keep a late section hidden.
// Refresh whenever the document's height settles.
if (typeof window !== "undefined" && typeof ResizeObserver !== "undefined" && !motionOff()) {
  let pending: gsap.core.Tween | null = null;
  new ResizeObserver(() => {
    pending?.kill();
    pending = gsap.delayedCall(0.15, () => ScrollTrigger.refresh());
  }).observe(document.documentElement);
}

export const EASE_OUT = "power3.out";
/** Default ScrollTrigger start for section reveals: the element's top at 82% of the viewport. */
export const REVEAL_START = "top 82%";

type Scope = RefObject<HTMLElement | null>;

type RiseOptions = {
  /** Seconds before the first target moves. */
  delay?: number;
  /** Pixels of rise. */
  y?: number;
  /** Seconds between targets. */
  stagger?: number;
  duration?: number;
  /** ScrollTrigger start (scroll variant only). */
  start?: string;
};

/** Fade + rise on mount for every `targets` match inside `scope`, in DOM order. */
export function useRiseIn(scope: Scope, targets: string, opts: RiseOptions = {}) {
  useGSAP(
    () => {
      if (motionOff() || !scope.current) return;
      gsap.from(targets, {
        opacity: 0,
        y: opts.y ?? 12,
        duration: opts.duration ?? 0.6,
        ease: EASE_OUT,
        delay: opts.delay ?? 0,
        stagger: opts.stagger ?? 0.08,
        clearProps: "opacity,transform",
      });
    },
    { scope },
  );
}

/** The same rise, played once when `scope` scrolls into view. */
export function useRiseOnScroll(scope: Scope, targets: string, opts: RiseOptions = {}) {
  useGSAP(
    () => {
      const root = scope.current;
      if (motionOff() || !root) return;
      gsap.from(targets, {
        opacity: 0,
        y: opts.y ?? 12,
        duration: opts.duration ?? 0.6,
        ease: EASE_OUT,
        delay: opts.delay ?? 0,
        stagger: opts.stagger ?? 0.08,
        clearProps: "opacity,transform",
        scrollTrigger: { trigger: root, start: opts.start ?? REVEAL_START, once: true },
      });
    },
    { scope },
  );
}

type DrawOptions = {
  /** ScrollTrigger start. */
  start?: string;
  /** Seconds between one column's drawing and the next. */
  stagger?: number;
};

/**
 * Line art: inside each `columns` match, `.art-ink` strokes draw in (DrawSVG) and then `.art-payoff`
 * marks pop, columns one after another, once, when `scope` scrolls into view. Give every stroke
 * element (path, line, polyline, circle, rect) the class art-ink and every filled mark art-payoff.
 */
export function useDrawIn(scope: Scope, columns: string, opts: DrawOptions = {}) {
  useGSAP(
    () => {
      const root = scope.current;
      if (motionOff() || !root) return;
      // Set payoffs before the timeline exists so nothing flashes on screen.
      gsap.set(root.querySelectorAll(".art-payoff"), { opacity: 0, scale: 0.6, transformOrigin: "50% 50%" });
      const sequence = gsap.timeline({ scrollTrigger: { trigger: root, start: opts.start ?? "top 75%", once: true } });
      gsap.utils.toArray<HTMLElement>(columns, root).forEach((column, index) => {
        const drawing = gsap.timeline();
        const ink = column.querySelectorAll(".art-ink");
        const payoff = column.querySelectorAll(".art-payoff");
        if (ink.length) drawing.fromTo(ink, { drawSVG: "0%" }, { drawSVG: "100%", duration: 0.7, ease: "power2.out", stagger: 0.08 });
        if (payoff.length) drawing.to(payoff, { opacity: 1, scale: 1, duration: 0.3, ease: "back.out(1.6)", stagger: 0.12 });
        sequence.add(drawing, index * (opts.stagger ?? 0.18));
      });
    },
    { scope },
  );
}

/**
 * Counts `value` up into `ref`'s text the first time `active` is true (or on mount when `active` is
 * omitted). Text is written through `format`; with motion off the final value is set at once.
 */
export function useCountUp(ref: RefObject<HTMLElement | null>, value: number, format: (n: number) => string, opts: { duration?: number; active?: boolean } = {}) {
  const active = opts.active ?? true;
  useGSAP(
    () => {
      const el = ref.current;
      if (!el) return;
      if (motionOff() || !active) {
        el.textContent = format(motionOff() ? value : 0);
        return;
      }
      const counter = { n: 0 };
      gsap.to(counter, {
        n: value,
        duration: opts.duration ?? 1.4,
        ease: "power2.out",
        onUpdate: () => {
          el.textContent = format(counter.n);
        },
      });
    },
    { dependencies: [value, active, opts.duration], revertOnUpdate: true },
  );
}


/**
 * Top bar: full width at the top of the page, a floating island once the page has scrolled 40px.
 * ScrollTrigger toggles `is-island` (the layout switch lives in landing.css); a short drop-in masks
 * the switch. With motion off the class still toggles, since it is layout, not decoration.
 */
export function useIslandBar(bar: RefObject<HTMLElement | null>) {
  useGSAP(
    () => {
      const el = bar.current;
      if (!el) return;
      ScrollTrigger.create({
        start: 40,
        end: "max",
        toggleClass: { targets: el, className: "is-island" },
        onToggle: () => {
          if (motionOff()) return;
          gsap.fromTo(el, { y: -10, opacity: 0.6 }, { y: 0, opacity: 1, duration: 0.3, ease: EASE_OUT, clearProps: "opacity,transform" });
        },
      });
    },
    { scope: bar },
  );
}
